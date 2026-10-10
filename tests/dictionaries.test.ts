import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMwText, lookupChain, lookupSingle, parseMerriamWebster, parseUrban, parseWiktionary } from '../server/dictionaries';
import { freeEnrich } from '../server/freeLookup';
import { cleanDictionaryRequest, dictionarySignature } from '../services/dictionaryCatalog';
import { dictionaryList, dictionaryRequest } from '../services/dictSettings';
import { toSyncedSettings, applyIncomingSettings } from '../services/settingsSync';
import { buildExtractionPrompt, parseExtractedItems } from '../services/geminiService';
import { extractKinds } from '../services/cardKinds';
import { buildSensePrompt } from '../services/senseService';
import type { Settings } from '../types';

type Routes = Record<string, unknown>;
const fakeFetch = (routes: Routes, calls: string[] = []) => async (url: string) => {
  calls.push(url);
  const key = Object.keys(routes).find(k => url.includes(k));
  if (!key) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => routes[key] };
};

// --- Wiktionary ---

const wiktionaryBeans = {
  en: [{
    partOfSpeech: 'Verb',
    language: 'English',
    definitions: [
      { definition: '<span class="ib-brac">(</span><span class="ib-content">idiomatic</span><span class="ib-brac">)</span> To reveal a <a href="/wiki/secret">secret</a>.', parsedExamples: [{ example: 'Come on, <b>spill the beans</b>!' }] },
      { definition: '' },
    ],
  }],
};

test('Wiktionary entries lose their markup and carry the idiom label', () => {
  const e = parseWiktionary(wiktionaryBeans, 'Spill the beans')!;
  assert.equal(e.headword, 'spill the beans');
  assert.equal(e.partOfSpeech, 'verb');
  assert.deepEqual(e.definitions, ['(idiomatic) To reveal a secret.']);
  assert.deepEqual(e.examples, ['Come on, spill the beans!']);
  assert.equal(e.kindHint, 'idiom');
});

test('a Wiktionary entry that only points to another form is not an answer', () => {
  const data = { en: [{ partOfSpeech: 'Verb', definitions: [{ definition: '<span class="form-of-definition">simple past tense and past participle of <a>carry</a></span>' }] }] };
  assert.equal(parseWiktionary(data, 'carried'), null);
});

// --- Merriam-Webster ---

test('Merriam-Webster markup is cleaned', () => {
  assert.equal(cleanMwText('{bc}a {sx|large||} amount {it}of{/it} money'), 'a large amount of money');
});

test('a Merriam-Webster phrase is read from its run-on entry, never from the word it lives under', () => {
  const data = [{
    meta: { id: 'bucket:1', stems: ['bucket', 'kick the bucket'] },
    hwi: { hw: 'buck*et', prs: [{ ipa: 'ˈbʌkət', sound: { audio: 'bucket01' } }] },
    fl: 'noun',
    shortdef: ['a round open container'],
    dros: [{ drp: 'kick the bucket', def: [{ sseq: [[['sense', { dt: [['text', '{bc}to die'], ['vis', [{ t: 'The old man finally {it}kicked the bucket{/it}.' }]]] }]]] }] }],
  }];
  const e = parseMerriamWebster(data, 'kick the bucket', "Merriam-Webster Learner's")!;
  assert.deepEqual(e.definitions, ['to die']);
  assert.deepEqual(e.examples, ['The old man finally kicked the bucket.']);
  assert.equal(e.kindHint, 'idiom');
  const word = parseMerriamWebster(data, 'bucket', 'MW')!;
  assert.deepEqual(word.definitions, ['a round open container']);
  assert.equal(word.pronunciation, '/ˈbʌkət/');
  assert.match(word.audioUrl || '', /\/b\/bucket01\.mp3$/);
  assert.equal(parseMerriamWebster(data, 'bucket list', 'MW'), null);
  assert.equal(parseMerriamWebster(['bucket', 'buckle'] as any, 'buckett', 'MW'), null, 'suggestions are not an entry');
});

test('a keyed dictionary uses the key typed on the device, and is skipped without one', async () => {
  const before = process.env.MW_API_KEY;
  delete process.env.MW_API_KEY;
  try {
    const calls: string[] = [];
    const f = fakeFetch({
      'collegiate/json/serendipity': [{ meta: { id: 'serendipity', stems: ['serendipity'] }, hwi: { hw: 'ser*en*dip*i*ty' }, fl: 'noun', shortdef: ['luck in finding valuable things'] }],
      'entries/en/serendipity': [{ word: 'serendipity', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'free dictionary meaning' }] }] }],
    }, calls);
    const without = await lookupChain('serendipity', { request: { order: ['mw-collegiate', 'free-dictionary'] }, fetchImpl: f });
    assert.equal(without?.source, 'Free Dictionary');
    assert.ok(!calls.some(u => u.includes('dictionaryapi.com')), 'no request without a key');
    const withKey = await lookupChain('serendipity', { request: { order: ['mw-collegiate', 'free-dictionary'], keys: { 'mw-collegiate': 'abc' } }, fetchImpl: f });
    assert.equal(withKey?.source, 'Merriam-Webster Collegiate');
    assert.ok(calls.some(u => u.includes('key=abc')));
    await assert.rejects(lookupSingle('mw-learners', 'serendipity', { fetchImpl: f }), /needs an API key/);
  } finally {
    if (before !== undefined) process.env.MW_API_KEY = before;
  }
});

// --- Urban Dictionary ---

test('Urban Dictionary gives the best-rated definitions of the exact term, marked as slang', () => {
  const e = parseUrban({ list: [
    { word: 'ghosting', definition: 'low [rated]', thumbs_up: 1, thumbs_down: 5, example: '' },
    { word: 'Ghosting', definition: 'Ending a relationship by [ignoring] someone.', thumbs_up: 900, thumbs_down: 10, example: 'He is [ghosting] me.' },
    { word: 'ghost', definition: 'other word', thumbs_up: 5000, thumbs_down: 0 },
  ] }, 'ghosting')!;
  assert.deepEqual(e.definitions, ['Ending a relationship by ignoring someone.', 'low rated']);
  assert.equal(e.kindHint, 'slang');
  assert.equal(e.partOfSpeech, 'slang');
});

// --- The chain ---

test('dictionaries are asked in the chosen order, each for every form, and Wiktionary covers phrases', async () => {
  const calls: string[] = [];
  const f = fakeFetch({
    'definition/spill_the_beans': wiktionaryBeans,
    mymemory: { responseStatus: 200, responseData: { translatedText: 'لو دادن راز' } },
  }, calls);
  const e = await freeEnrich('spill the beans', f, false, { order: ['free-dictionary', 'wiktionary'] });
  assert.equal(e.found, true);
  assert.equal(e.source, 'Wiktionary');
  assert.equal(e.kindHint, 'idiom');
  assert.equal(e.translation, 'لو دادن راز');
  const fd = calls.findIndex(u => u.includes('entries/en/'));
  const wk = calls.findIndex(u => u.includes('wiktionary'));
  assert.ok(fd >= 0 && wk > fd, 'Free Dictionary first, then Wiktionary');
});

test('a Wiktionary word without pronunciation takes it from a later dictionary', async () => {
  const f = fakeFetch({
    'definition/gist': { en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'The core idea.' }] }] },
    'sp=gist&md=dp': [{ word: 'gist', defs: ['n\tthe central meaning'], tags: ['ipa:dʒɪst'] }],
  });
  const e = await lookupChain('gist', { request: { order: ['wiktionary', 'datamuse'] }, fetchImpl: f });
  assert.deepEqual(e?.definitions, ['The core idea.']);
  assert.equal(e?.pronunciation, 'dʒɪst');
});

test('the translation uses the email typed on the device', async () => {
  const calls: string[] = [];
  await freeEnrich('gist', fakeFetch({}, calls), false, { order: [], keys: { mymemory: 'me@example.com' } });
  assert.ok(calls.some(u => u.includes('mymemory') && u.includes('de=me%40example.com')));
});

test('a request from the browser keeps only known dictionaries and short keys', () => {
  assert.deepEqual(cleanDictionaryRequest({ order: ['wiktionary', 'evil', 'wiktionary', 'urban'], keys: { 'mw-learners': ' k ', other: 'x', mymemory: 5 } }),
    { order: ['wiktionary', 'urban'], keys: { 'mw-learners': 'k' } });
  assert.deepEqual(cleanDictionaryRequest(null), { keys: {} });
});

test('the cache signature changes with the order and with keys', () => {
  const none = () => false;
  assert.equal(dictionarySignature(['wiktionary', 'mw-learners', 'free-dictionary'], none), 'wiktionary,free-dictionary');
  assert.equal(dictionarySignature(['wiktionary', 'mw-learners'], id => id === 'mw-learners'), 'wiktionary,mw-learners+k');
});

// --- Settings ---

test('the dictionary list keeps the saved order and adds new dictionaries at the end', () => {
  const list = dictionaryList({ dictionaries: [{ id: 'wiktionary', enabled: true }, { id: 'free-dictionary', enabled: false }] } as Partial<Settings>);
  assert.deepEqual(list.slice(0, 2), [{ id: 'wiktionary', enabled: true }, { id: 'free-dictionary', enabled: false }]);
  assert.equal(list.length, 6);
  assert.equal(list.find(d => d.id === 'urban')?.enabled, false, 'Urban Dictionary is off unless switched on');
  const request = dictionaryRequest({ dictionaries: list, dictKeys: { 'mw-learners': ' key ' } } as Partial<Settings>);
  assert.deepEqual(request.order, ['wiktionary', 'mw-learners', 'mw-collegiate', 'datamuse']);
  assert.deepEqual(request.keys, { 'mw-learners': 'key' });
});

test('dictionary keys never leave the device', () => {
  const local = { theme: 'light', dictKeys: { 'mw-collegiate': 'secret' }, updatedAt: '2026-01-01T00:00:00Z' } as Partial<Settings>;
  assert.equal(toSyncedSettings(local)?.dictKeys, undefined);
  const merged = applyIncomingSettings(local, { theme: 'dark', dictionaries: [{ id: 'wiktionary', enabled: true }], updatedAt: '2026-02-01T00:00:00Z' } as Partial<Settings>)!;
  assert.deepEqual(merged.dictKeys, { 'mw-collegiate': 'secret' });
  assert.deepEqual(merged.dictionaries, [{ id: 'wiktionary', enabled: true }]);
});

// --- Extraction of expressions ---

test('the extraction prompt asks for every kind of multi-word item, at least half when the text has them', () => {
  const prompt = buildExtractionPrompt({ text: 'He finally spilled the beans.', level: 'B2' });
  for (const kind of ['phrase', 'collocation', 'idiom', 'expression', 'slang', 'grammar']) assert.match(prompt, new RegExp(`"${kind}"`));
  assert.match(prompt, /at least half of the items should be multi-word/);
  assert.match(prompt, /even when every word in it is easy/);
});

test('the extraction prompt only asks for the kinds chosen, always with single words', () => {
  const prompt = buildExtractionPrompt({ text: 'x', level: 'B2', kinds: ['idiom'], includeGrammar: true });
  assert.match(prompt, /"kind": one of \["word","idiom"\]/);
  assert.doesNotMatch(prompt, /"slang":/);
  const wordsOnly = buildExtractionPrompt({ text: 'x', level: 'B2', kinds: ['word'] });
  assert.doesNotMatch(wordsOnly, /multi-word items/);
  const noGrammar = buildExtractionPrompt({ text: 'x', level: 'B2', includeGrammar: false });
  assert.doesNotMatch(noGrammar, /"grammar": a hard/);
});

test('extracted collocations, expressions and slang keep their kind', () => {
  const cards = parseExtractedItems({ words: [
    { kind: 'collocation', front: 'make a decision', back: 'تصمیم گرفتن' },
    { kind: 'Expression', front: 'no wonder', back: 'عجیب نیست' },
    { kind: 'slang', front: 'broke', back: 'بی‌پول' },
    { kind: 'nonsense', front: 'put up with', back: 'تحمل کردن' },
  ] });
  assert.deepEqual(cards.map(c => c.kind), ['collocation', 'expression', 'slang', 'phrase']);
});

test('the kinds to look for: all by default, single words always', () => {
  assert.equal(extractKinds({}).length, 7);
  assert.deepEqual(extractKinds({ extractKinds: ['idiom', 'slang'] } as Partial<Settings>), ['word', 'idiom', 'slang']);
});

test('a tapped word that is part of an expression is answered with the whole expression', () => {
  const prompt = buildSensePrompt([{ term: 'beans', sentence: 'She spilled the beans.' }], 'B2');
  assert.match(prompt, /give the whole one/);
  assert.match(prompt, /"slang"/);
});

test('a wrong Merriam-Webster key is reported as such, not as an unknown word', async () => {
  const f = async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); }, text: async () => 'Invalid API key. Not subscribed for this reference.' });
  await assert.rejects(lookupSingle('mw-learners', 'hello', { request: { keys: { 'mw-learners': 'wrong' } }, fetchImpl: f as any }), /refused the key/);
});
