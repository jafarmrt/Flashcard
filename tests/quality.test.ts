import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiGenerate, AiChainError, chainOf, isPermanentAiError } from '../services/aiClient';
import { ProxyError } from '../services/apiService';
import {
  aiChain, aiRequestOptions, providerKey, providerList, providerName, providerProblem, withPrimaryProvider,
} from '../services/aiSettings';
import { learnerStep, levelOfFrequency, isAboveLevel, isBelowLevel } from '../services/wordLevel';
import { checkReasons, meaningCheckCandidates, needsCheck } from '../services/cardCheck';
import { buildMeaningCheckPrompt, MEANING_CHECK_BATCH, parseMeaningVerdicts } from '../services/meaningCheck';
import { parsePracticeFeedback, ruleCheck, suggestRating } from '../services/practiceCheck';
import { cardsByMaker, recentErrors, totalsByService, translationCharsOn, usageByDay, type UsageRow } from '../services/usageLog';
import { ruleCard, ruleCardsInText, ruleIdOfCard, ruleIdsWithCards } from '../services/grammarCards';
import { ruleById } from '../services/grammarPatterns';
import { extractFromLongText } from '../services/extractionPipeline';
import { enrichmentToCard } from '../services/freeExtractionService';
import type { Flashcard, Settings } from '../types';

const T0 = new Date('2026-10-09T10:00:00Z');

const card = (over: Partial<Flashcard> = {}): Flashcard => ({
  id: over.id || 'c1', deckId: 'd', front: 'reluctant', back: 'بی‌میل', repetition: 0, easinessFactor: 2.5, interval: 0,
  dueDate: T0.toISOString(), createdAt: T0.toISOString(), updatedAt: T0.toISOString(), ...over,
} as Flashcard);

const settings = (over: Partial<Settings> = {}): Settings => ({ theme: 'light', ...over } as Settings);

// --- The chain of AI services ---

test('settings from before the list become: the old service first, then Gemini', () => {
  const old = settings({ aiProvider: 'openai-compatible', aiBaseUrl: 'https://api.groq.com/openai/v1', customApiKey: 'gsk_1', aiModel: 'llama-3.3-70b-versatile' });
  const list = providerList(old);
  assert.deepEqual(list.slice(0, 2).map(p => [p.id, p.enabled]), [['groq', true], ['gemini', true]]);
  assert.ok(list.slice(2).every(p => !p.enabled), 'the rest are listed but off');
  assert.equal(providerKey(old, 'groq'), 'gsk_1', 'the old key belongs to the old service');
  assert.equal(providerKey(old, 'openrouter'), undefined, 'and never to another');
  const chain = aiChain(old);
  assert.deepEqual(chain.map(providerName), ['Groq', 'Gemini']);
  assert.equal(chain[1].customApiKey, undefined, 'a Groq key is never sent to Google');
  const local = settings({ aiProvider: 'openai-compatible', aiBaseUrl: 'http://localhost:11434/v1' });
  assert.deepEqual(providerList(local).slice(0, 2).map(p => [p.id, p.enabled]), [['ollama', true], ['gemini', false]], 'texts for a local service never go to Google');
});

test('a switched-on service without its key is skipped; with none usable, Gemini on the server key', () => {
  const s = settings({ aiProviders: [{ id: 'openrouter', enabled: true }, { id: 'groq', enabled: true }, { id: 'gemini', enabled: false }], aiKeys: { groq: 'g' } });
  assert.equal(providerProblem(s, { id: 'openrouter', enabled: true }), 'کلید ندارد');
  assert.deepEqual(aiChain(s).map(providerName), ['Groq']);
  const options = aiRequestOptions(s);
  assert.equal(options.fallbacks, undefined, 'one service: no fallbacks');
  const none = settings({ aiProviders: [{ id: 'groq', enabled: true }, { id: 'gemini', enabled: false }] });
  assert.deepEqual(aiChain(none).map(providerName), ['Gemini']);
  const custom = settings({ aiProviders: [{ id: 'custom', enabled: true, baseUrl: 'https://x.example/v1' }] });
  assert.equal(providerProblem(custom, custom.aiProviders![0]), 'نام مدل ندارد');
});

test('putting a service first keeps the others behind it with their keys, and clears the old fields', () => {
  const old = settings({ aiProvider: 'openai-compatible', aiBaseUrl: 'https://api.groq.com/openai/v1', customApiKey: 'gsk_1' });
  const change = withPrimaryProvider(old, { id: 'openrouter', enabled: true }, 'or_2');
  assert.equal(change.aiProviders![0].id, 'openrouter');
  assert.deepEqual(change.aiKeys, { groq: 'gsk_1', openrouter: 'or_2' });
  assert.equal(change.customApiKey, undefined);
  const next = settings({ ...old, ...change });
  assert.deepEqual(aiChain(next).map(providerName), ['OpenRouter', 'Groq', 'Gemini']);
  const options = aiRequestOptions(next);
  assert.equal(options.fallbacks?.length, 2);
  assert.deepEqual(chainOf(options).map(providerName), ['OpenRouter', 'Groq', 'Gemini']);
});

test('aiGenerate asks the next service when one fails, and says which answered', async () => {
  const options = aiRequestOptions(settings({ aiProviders: [{ id: 'groq', enabled: true }, { id: 'gemini', enabled: true }], aiKeys: { groq: 'g' } }));
  const asked: string[] = [];
  const reply = await aiGenerate(options, { contents: 'hi' }, 'other', async fields => {
    asked.push(String(fields.aiProvider));
    if (fields.aiProvider === 'openai-compatible') throw new ProxyError('rate limited', 429);
    return { text: 'ok' };
  });
  assert.deepEqual(asked, ['openai-compatible', 'gemini']);
  assert.equal(reply.text, 'ok');
  assert.equal(providerName(reply.used), 'Gemini');
});

test('aiGenerate: all failing is one error naming each; a lost connection stops at once', async () => {
  const options = aiRequestOptions(settings({ aiProviders: [{ id: 'groq', enabled: true }, { id: 'gemini', enabled: true }], aiKeys: { groq: 'g' } }));
  await assert.rejects(
    aiGenerate(options, { contents: 'x' }, 'other', async fields => { throw new ProxyError(`bad key ${fields.aiProvider}`, 401); }),
    (e: unknown) => e instanceof AiChainError && e.permanent && /bad key openai-compatible \| bad key gemini/.test(e.message),
  );
  let calls = 0;
  await assert.rejects(aiGenerate(options, { contents: 'x' }, 'other', async () => { calls++; throw new TypeError('Failed to fetch'); }), TypeError);
  assert.equal(calls, 1, 'no point asking the next service without a connection');
  // One service: its own error, unchanged.
  const single = aiRequestOptions(settings({ aiProviders: [{ id: 'gemini', enabled: true }] }));
  await assert.rejects(aiGenerate(single, { contents: 'x' }, 'other', async () => { throw new ProxyError('quota', 429); }),
    (e: unknown) => e instanceof ProxyError && !(e instanceof AiChainError) && !isPermanentAiError(e));
});

// --- Word level ---

test('a word\'s level comes from how often it is used', () => {
  assert.equal(levelOfFrequency(500), 'A1');
  assert.equal(levelOfFrequency(50), 'B1');
  assert.equal(levelOfFrequency(20), 'B2');
  assert.equal(levelOfFrequency(8), 'C1');
  assert.equal(levelOfFrequency(0.4), 'C2');
  assert.equal(levelOfFrequency(null), undefined);
  assert.equal(levelOfFrequency(0), undefined, 'no data is not C2');
  assert.equal(learnerStep('IELTS'), 'B2');
  assert.equal(isAboveLevel('C1', 'B2'), true);
  assert.equal(isAboveLevel('B2', 'B2'), false);
  assert.equal(isAboveLevel(undefined, 'B2'), false);
  assert.equal(isBelowLevel('B1', 'B2'), true);
  assert.equal(isBelowLevel('B2', 'B2'), false);
  // A C2 learner still gets C2 words picked.
  assert.equal(isBelowLevel('C2', 'C2'), false);
  assert.equal(isBelowLevel('B2', 'IELTS'), false);
  assert.equal(isBelowLevel(undefined, 'C2'), false);
});

test('a free dictionary card carries its level and whether the dictionary knew it', () => {
  const base = { headword: 'blurt', pronunciation: '', partOfSpeech: 'verb', definitions: [], examples: [], translation: 'از دهان پراندن', collocations: [] };
  const known = enrichmentToCard('blurt', 'He blurted it out.', { ...base, found: true, frequency: 2 }, 'word');
  assert.equal(known.level, 'C2');
  assert.equal(known.notInDictionary, undefined);
  const unknown = enrichmentToCard('zorp', 'A zorp.', { ...base, headword: 'zorp', found: false }, 'word');
  assert.equal(unknown.notInDictionary, true);
  assert.equal(unknown.level, undefined);
});

// --- Cards that need a look ---

test('flags: not in the dictionary, no Persian meaning, not in its sentence; a checked card is never flagged', () => {
  assert.deepEqual(checkReasons(card({ sourceSentence: 'She was reluctant to go.' })), []);
  assert.deepEqual(checkReasons(card({ notInDictionary: true, back: '' })), ['not-in-dictionary', 'no-persian']);
  assert.deepEqual(checkReasons(card({ back: '…' })), ['no-persian']);
  assert.deepEqual(checkReasons(card({ sourceSentence: 'He went home.' })), ['not-in-sentence']);
  assert.deepEqual(checkReasons(card({ front: 'take into account', sourceSentence: 'They took it into account.' })), [], 'inflected phrases count');
  assert.deepEqual(checkReasons(card({ front: 'decide', sourceSentence: 'She decided to stay.' })), [], 'inflected words count');
  assert.deepEqual(checkReasons(card({ front: 'take something into account', sourceSentence: 'They took the cost into account.' })), [], 'placeholders are not looked for');
  assert.deepEqual(checkReasons(card({ front: 'be fond of sb', sourceSentence: 'He grew fond of her.' })), [], 'a leading "be" is not looked for');
  assert.deepEqual(checkReasons(card({ front: 'child', sourceSentence: 'The children played.' })), [], 'irregular plurals count');
  assert.equal(needsCheck(card({ back: '', checkedAt: T0.toISOString() })), false);
  assert.deepEqual(checkReasons(card({ kind: 'grammar', front: 'Passive voice', notInDictionary: true, sourceSentence: 'It was built.' })), [], 'grammar is not a dictionary term');
});

test('cards for the AI meaning check: flagged ones and unchecked dictionary-made ones', () => {
  const list = [
    card({ id: 'a', origin: { by: 'dictionary' } }),
    card({ id: 'b', origin: { by: 'ai', provider: 'Gemini' } }),
    card({ id: 'c', origin: { by: 'ai', provider: 'Gemini' }, back: '' }),
    card({ id: 'd', origin: { by: 'dictionary' }, checkedAt: T0.toISOString() }),
    card({ id: 'e', kind: 'grammar', back: '' }),
    card({ id: 'f', origin: { by: 'dictionary' }, isDeleted: true }),
  ];
  assert.deepEqual(meaningCheckCandidates(list).map(c => c.id), ['a', 'c']);
});

test('meaning check: one verdict per card, a suggestion only when it differs', () => {
  const cards = [card({ id: 'a', front: 'bank', back: 'بانک', sourceSentence: 'We sat on the bank of the river.' }), card({ id: 'b', front: 'run', back: 'دویدن' }), card({ id: 'c', front: 'odd', back: 'عجیب' })];
  const prompt = buildMeaningCheckPrompt(cards);
  assert.match(prompt, /1\. term: "bank"/);
  assert.match(prompt, /sentence: "We sat on the bank of the river\."/);
  const verdicts = parseMeaningVerdicts({ results: [
    { index: 1, ok: false, suggestion: 'کنارهٔ رود', note: 'در این جمله کنارهٔ رود است' },
    { index: 2, ok: true },
    { index: 3, ok: false, suggestion: 'عجیب' },
    { index: 1, ok: true },
  ] }, cards);
  assert.deepEqual(verdicts, [
    { cardId: 'a', ok: false, suggestion: 'کنارهٔ رود', note: 'در این جمله کنارهٔ رود است' },
    { cardId: 'b', ok: true },
    { cardId: 'c', ok: false },
  ]);
  assert.equal(MEANING_CHECK_BATCH, 20);
  assert.throws(() => parseMeaningVerdicts('nonsense', cards));
});

// --- Sentence building ---

test('practice: the rule sees the structure; the AI result suggests the rating', () => {
  const passive = card({ kind: 'grammar', front: 'Passive voice', grammarId: 'passive' });
  assert.equal(ruleCheck(passive, 'The cake was eaten by the kids.'), true);
  assert.equal(ruleCheck(passive, 'The kids ate the cake.'), false);
  assert.equal(ruleCheck(card({ kind: 'grammar', front: 'Some odd structure' }), 'Anything.'), undefined, 'no rule, no verdict');
  assert.equal(ruleCheck(card({ kind: 'grammar', front: 'Past Perfect Tense' }), 'I had left before he came.'), true, 'an AI card is matched to the rule by its name');

  assert.equal(suggestRating(true, null), 'GOOD');
  assert.equal(suggestRating(false, null), undefined, 'the rules alone never fail a sentence');
  assert.equal(suggestRating(undefined, null), undefined);
  const ai = parsePracticeFeedback({ usesStructure: true, correct: false, corrected: 'The cake was eaten.', feedback: 'خوب بود', mistakes: [{ wrong: 'was eat', right: 'was eaten', why: 'اسم مفعول لازم است' }] }, 'The cake was eat.');
  assert.equal(ai.mistakes.length, 1);
  assert.equal(suggestRating(false, ai), 'HARD', 'the AI reads more than the rule');
  assert.equal(suggestRating(true, { ...ai, correct: true, mistakes: [] }), 'GOOD');
  assert.equal(suggestRating(true, { ...ai, usesStructure: false }), 'AGAIN');
  assert.equal(parsePracticeFeedback({ usesStructure: 'true', correct: true }, ' Hi. ').corrected, 'Hi.');
});

// --- Grammar cards from the rules ---

test('rule cards: a full grammar card with no AI, each structure once', () => {
  const rule = ruleById('passive')!;
  const c = ruleCard(rule, 'The house was built in 1890.', T0);
  assert.equal(c.kind, 'grammar');
  assert.equal(c.front, rule.name);
  assert.equal(c.back, rule.explanation);
  assert.equal(c.grammarId, 'passive');
  assert.deepEqual(c.origin, { by: 'rules', at: T0.toISOString() });
  const found = ruleCardsInText('The house was built in 1890. The roof was repaired later. If it rains, we will stay home.', 5);
  assert.deepEqual(found.map(f => f.grammarId), ['passive', 'first-conditional']);
  assert.equal(found[0].sourceSentence, 'The house was built in 1890.');
  assert.deepEqual(ruleCardsInText('The house was built in 1890. If it rains, we will stay home.', 5, new Set(['passive'])).map(f => f.grammarId), ['first-conditional']);
  assert.equal(ruleCardsInText('The house was built. If it rains, we will stay.', 1).length, 1);
  assert.equal(ruleIdOfCard({ front: 'Past Perfect Tense', kind: 'grammar' }), 'past-perfect');
  assert.equal(ruleIdOfCard({ front: 'past', kind: 'word' }), undefined, 'a word card is not a structure');
  assert.deepEqual([...ruleIdsWithCards([card({ kind: 'grammar', front: 'x', grammarId: 'wish' }), card({ kind: 'grammar', front: 'Passive Voice' })])].sort(), ['passive', 'wish']);
});

test('without AI, extraction adds a couple of structures per section from the rules', async () => {
  const text = 'The letter was written by my aunt. If it rains, we will stay home. I wish I had more time.';
  const result = await extractFromLongText({
    text, level: 'B2', perSection: 5, source: 'free', existingFronts: [],
    extractFree: async () => [],
  });
  const grammar = result.cards.filter(c => c.kind === 'grammar');
  assert.equal(grammar.length, 2);
  assert.ok(grammar.every(c => c.origin?.by === 'rules'));
  const again = await extractFromLongText({
    text, level: 'B2', perSection: 5, source: 'free', existingFronts: [grammar[0].front, 'Passive Voice'], extractFree: async () => [],
  });
  assert.ok(!again.cards.some(c => c.grammarId === grammar[0].grammarId), 'a structure with a card is not suggested again');
  const word = await extractFromLongText({
    text: 'I wish I had more time.', level: 'B2', perSection: 5, source: 'free', existingFronts: ['wish'], extractFree: async () => [],
  });
  assert.deepEqual(word.cards.map(c => c.grammarId), ['wish'], 'a word card named like a structure does not hide it');
  const byId = await extractFromLongText({
    text: 'I wish I had more time.', level: 'B2', perSection: 5, source: 'free', existingFronts: [], knownRuleIds: ['wish'], extractFree: async () => [],
  });
  assert.equal(byId.cards.length, 0, 'the caller\'s list of structures with cards is used');
  const off = await extractFromLongText({ text, level: 'B2', perSection: 5, source: 'free', existingFronts: [], includeGrammar: false, extractFree: async () => [] });
  assert.equal(off.cards.length, 0);
});

// --- The usage page ---

const row = (over: Partial<UsageRow>): UsageRow => ({ day: '2026-10-09', at: '2026-10-09T10:00:00.000Z', service: 'Gemini', task: 'sense', ok: true, ...over });

test('usage: requests per service and day, errors newest first, translated characters', () => {
  const rows = [
    row({ service: 'Gemini' }), row({ service: 'Gemini', ok: false, error: 'quota', at: '2026-10-09T11:00:00.000Z' }),
    row({ service: 'Groq', day: '2026-10-08', at: '2026-10-08T09:00:00.000Z' }),
    row({ service: 'dictionary', task: 'lookup', chars: 7 }), row({ service: 'translation', task: 'translate', chars: 120 }),
    row({ service: 'translation', task: 'translate', chars: 50, ok: false, error: 'down', at: '2026-10-09T09:00:00.000Z' }),
  ];
  assert.deepEqual(totalsByService(rows, '2026-10-09'), [
    { service: 'Gemini', ok: 1, failed: 1 }, { service: 'translation', ok: 1, failed: 1 }, { service: 'dictionary', ok: 1, failed: 0 },
  ]);
  const days = usageByDay(rows, '2026-10-09', 3);
  assert.deepEqual(days.map(d => d.day), ['2026-10-09', '2026-10-08', '2026-10-07']);
  assert.deepEqual(days[1].services, [{ service: 'Groq', ok: 1, failed: 0 }]);
  assert.deepEqual(recentErrors(rows).map(r => r.error), ['quota', 'down']);
  assert.equal(translationCharsOn(rows, '2026-10-09'), 127, 'failed requests do not use the quota');
});

test('usage: cards made by each service', () => {
  const cards = [
    card({ id: 'a', origin: { by: 'ai', provider: 'Groq', at: '2026-10-09T08:00:00Z' } }),
    card({ id: 'b', origin: { by: 'ai', provider: 'Groq', at: '2026-10-09T08:00:00Z' } }),
    card({ id: 'c', origin: { by: 'dictionary', at: '2026-10-09T08:00:00Z' } }),
    card({ id: 'd', origin: { by: 'rules', at: '2026-10-09T08:00:00Z' } }),
    card({ id: 'e', createdAt: '2026-08-01T08:00:00Z' }),
    card({ id: 'f', origin: { by: 'manual', at: '2026-10-09T08:00:00Z' }, isDeleted: true }),
  ];
  assert.deepEqual(cardsByMaker(cards, '2026-09-10'), [{ maker: 'Groq', count: 2 }, { maker: 'dictionary', count: 1 }, { maker: 'rules', count: 1 }]);
});
