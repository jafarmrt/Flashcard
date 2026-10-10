import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyProposal, buildCardRefreshPrompt, parseCardRefresh, parseCollocations, proposalChanges, refreshErrorText,
  refreshSources, refreshWithAi, shownValue, withEditedContent, type CardContent, type CardProposal,
} from '../services/cardRefresh';
import { originText } from '../services/library';
import type { Flashcard, Settings } from '../types';

const T0 = new Date('2026-10-10T10:00:00Z');

const card = (over: Partial<Flashcard> = {}): Flashcard => ({
  id: 'c1', deckId: 'd', front: 'bank', back: 'بانک', repetition: 0, easinessFactor: 2.5, interval: 0,
  dueDate: T0.toISOString(), createdAt: T0.toISOString(), updatedAt: T0.toISOString(), ...over,
} as Flashcard);

const settings = (over: Partial<Settings> = {}): Settings => ({ theme: 'light', ...over } as Settings);

// --- Which services a card can be asked of ---

test('every AI service set up on the device is offered on its own, then the dictionaries', () => {
  const sources = refreshSources(settings({
    aiProviders: [{ id: 'groq', enabled: true }, { id: 'gemini', enabled: true }, { id: 'deepseek', enabled: false }, { id: 'openrouter', enabled: true }],
    aiKeys: { groq: 'gk', deepseek: 'dk' },
  }));
  // OpenRouter is on but has no key: it cannot answer. DeepSeek is off but has a key: the user can still ask it.
  assert.deepEqual(sources.map(s => s.id), ['ai:groq', 'ai:gemini', 'ai:deepseek', 'dict:all', 'dict:free-dictionary', 'dict:wiktionary', 'dict:mw-learners', 'dict:mw-collegiate', 'dict:datamuse']);
  const groq = sources[0];
  assert.equal(groq.options?.customApiKey, 'gk');
  assert.equal(groq.options?.fallbacks, undefined);
  assert.match(groq.name, /^Groq · /);
});

test('a Gemini the user switched off is not offered, unless nothing else is set up', () => {
  const off = refreshSources(settings({ aiProviders: [{ id: 'gemini', enabled: false }, { id: 'groq', enabled: true }], aiKeys: { groq: 'k' } }));
  assert.deepEqual(off.filter(s => s.kind === 'ai').map(s => s.id), ['ai:groq']);
  const none = refreshSources(settings({ aiProviders: [{ id: 'gemini', enabled: false }] }));
  assert.deepEqual(none.filter(s => s.kind === 'ai').map(s => s.id), ['ai:gemini']);
});

// --- Asking an AI ---

test('the prompt carries the sentence the word was met in and asks for its meaning there', () => {
  const prompt = buildCardRefreshPrompt(card({ sourceSentence: 'We sat on the bank of the river.' }));
  assert.match(prompt, /"bank"/);
  assert.match(prompt, /We sat on the bank of the river\./);
  assert.match(prompt, /IN THIS SENTENCE/);
  assert.match(prompt, /JSON/);
  assert.doesNotMatch(buildCardRefreshPrompt(card()), /IN THIS SENTENCE/);
});

test('grammar cards ask for the pattern and a practice task, not IPA', () => {
  const prompt = buildCardRefreshPrompt(card({ kind: 'grammar', front: 'Past perfect', grammarPattern: 'had + V3' }));
  assert.match(prompt, /"pattern"/);
  assert.match(prompt, /"practice"/);
  assert.doesNotMatch(prompt, /IPA/);
  const parsed = parseCardRefresh({ translation: 'گذشتهٔ کامل', pattern: 'had + past participle', practice: 'یک جمله بساز', pronunciation: '/x/' }, { kind: 'grammar' });
  assert.equal(parsed.grammarPattern, 'had + past participle');
  assert.equal(parsed.practicePrompt, 'یک جمله بساز');
  assert.equal(parsed.pronunciation, undefined);
});

test('an AI reply becomes card fields; junk and empty values are dropped', () => {
  const parsed = parseCardRefresh({
    translation: ' ساحل رود ', notes: '', pronunciation: '/bæŋk/', partOfSpeech: 'noun', level: 'b1',
    definitions: ['the land beside a river', '', 7], examples: 'They walked along the bank.',
    collocations: [{ phrase: 'river bank', meaning: 'کنارهٔ رود' }, 'west bank', { meaning: 'no phrase' }],
  }, {});
  assert.equal(parsed.back, 'ساحل رود');
  assert.equal(parsed.notes, undefined);
  assert.equal(parsed.level, 'B1');
  assert.deepEqual(parsed.definition, ['the land beside a river']);
  assert.deepEqual(parsed.exampleSentenceTarget, ['They walked along the bank.']);
  assert.deepEqual(parsed.collocations, [{ phrase: 'river bank', meaning: 'کنارهٔ رود' }, { phrase: 'west bank' }]);
  assert.equal(parseCardRefresh({ level: 'Z9' }, {}).level, undefined);
  assert.deepEqual(parseCardRefresh(null, {}), {});
});

test('only the chosen service is asked, and the answer says which one it was', async () => {
  const asked: unknown[] = [];
  const proposal = await refreshWithAi(card(), {
    aiProvider: 'openai-compatible', aiBaseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', customApiKey: 'k',
    fallbacks: [{ aiProvider: 'gemini', model: 'gemini-2.5-flash' }],
  }, T0, async fields => {
    asked.push(fields.aiBaseUrl);
    return { text: '```json\n{"translation":"ساحل","notes":"مثل ساحل دریا"}\n```' };
  });
  assert.deepEqual(asked, ['https://api.groq.com/openai/v1']);
  assert.equal(proposal.back, 'ساحل');
  assert.deepEqual(proposal.origin, { by: 'ai', provider: 'Groq', model: 'llama-3.3-70b-versatile', at: T0.toISOString() });
  await assert.rejects(refreshWithAi(card(), { aiProvider: 'gemini' }, T0, async () => ({ text: '{}' })));
});

test('errors are told in words the user can act on', () => {
  const mw = { id: 'dict:mw-collegiate', kind: 'dictionary' as const, name: 'Merriam-Webster Collegiate' };
  assert.match(refreshErrorText(new Error('Merriam-Webster Collegiate needs an API key.'), mw), /کلید می‌خواهد/);
  assert.match(refreshErrorText(new Error('not found'), { id: 'dict:all', kind: 'dictionary', name: 'دیکشنری' }), /پیدا نکرد/);
  assert.match(refreshErrorText(new Error('429 quota'), { id: 'ai:groq', kind: 'ai', name: 'Groq' }), /سهمیهٔ Groq/);
});

// --- Comparing and taking ---

const proposal: CardProposal = {
  back: 'ساحل رود', notes: 'یادداشت', pronunciation: '/bæŋk/', collocations: [{ phrase: 'river bank', meaning: 'کنارهٔ رود' }],
  definition: ['money place'], origin: { by: 'ai', provider: 'Groq', at: T0.toISOString() },
};

test('only fields where the source says something new are shown, meaning first', () => {
  const changes = proposalChanges({ front: 'bank', back: 'بانک', notes: 'یادداشت', definition: ['money place'] }, proposal);
  assert.deepEqual(changes.map(c => c.field), ['back', 'pronunciation', 'collocations']);
  assert.deepEqual(changes[0], { field: 'back', current: 'بانک', proposed: 'ساحل رود' });
  assert.equal(changes[2].proposed, 'river bank = کنارهٔ رود');
});

test('taking fields changes only those; taking the meaning makes the card the source\'s', () => {
  const before: CardContent = { front: 'bank', back: 'بانک', notes: 'old', origin: { by: 'dictionary' } };
  const some = applyProposal(before, proposal, ['pronunciation', 'collocations']);
  assert.equal(some.back, 'بانک');
  assert.equal(some.notes, 'old');
  assert.equal(some.pronunciation, '/bæŋk/');
  assert.deepEqual(some.origin, { by: 'dictionary' });
  const meaning = applyProposal(before, proposal, ['back']);
  assert.equal(meaning.back, 'ساحل رود');
  assert.equal(meaning.origin?.provider, 'Groq');
  assert.equal(before.back, 'بانک'); // the original is not changed
});

test('collocations are typed one per line, the meaning after =', () => {
  assert.deepEqual(parseCollocations('make a decision = تصمیم گرفتن\n\n  take a break  \nx = '), [
    { phrase: 'make a decision', meaning: 'تصمیم گرفتن' }, { phrase: 'take a break' }, { phrase: 'x' },
  ]);
  const list = [{ phrase: 'a', meaning: 'ب' }, { phrase: 'c' }];
  assert.deepEqual(parseCollocations(shownValue('collocations', list)), list);
});

// --- Editing during a review ---

test('an edit made during a review keeps each copy\'s own schedule', () => {
  const before = card({ interval: 0, repetition: 0 });
  const answered = card({ interval: 3, repetition: 1, stability: 3.2 });
  const saved = card({ back: 'ساحل', interval: 3, repetition: 1, stability: 3.2, checkedAt: T0.toISOString() });
  const undoCopy = withEditedContent(before, saved);
  assert.equal(undoCopy.back, 'ساحل');
  assert.equal(undoCopy.interval, 0);
  assert.equal(undoCopy.stability, undefined);
  assert.equal(withEditedContent(answered, saved).interval, 3);
  const other = card({ id: 'c2' });
  assert.equal(withEditedContent(other, saved), other);
});

test('a card filled from Merriam-Webster says so', () => {
  assert.equal(originText({ by: 'dictionary', provider: 'Merriam-Webster' }), 'Merriam-Webster');
  assert.equal(originText({ by: 'dictionary' }), 'دیکشنری رایگان');
});
