import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { forgetRows, isKnownTerm, knownFormsInText, knownList, knownTermSet, newKnownWord } from '../services/knownWords';
import { extractFromLongText } from '../services/extractionPipeline';
import { phraseRanges, rangeText, readerSection, sentenceOf } from '../services/readerText';
import {
  buildSensePrompt, buildSentencePrompt, grammarCards, parseSenses, parseSentenceAnalysis, SenseBatcher, SenseRequest,
} from '../services/senseService';
import { cachedEnrich, fileLookupStore, lookupCacheKey } from '../server/lookupCache';
import { LOOKUP_KEEP_MS, lookupKeepMs, PARTIAL_LOOKUP_KEEP_MS } from '../services/lookupLifetime';
import type { FreeEnrichment } from '../server/freeLookup';
import type { ExtractedWordCard, KnownWord } from '../types';

const T0 = new Date('2026-10-09T10:00:00Z');
const T1 = new Date('2026-10-09T11:00:00Z');

// --- The "I know it" list ---

test('a known word is never suggested again, in any of its forms', () => {
  const rows: KnownWord[] = [newKnownWord('Decide', T0, 'k1'), newKnownWord('take into account', T0, 'k2'), { ...newKnownWord('gone', T0, 'k3'), isDeleted: true }];
  assert.equal(rows[0].term, 'decide');
  const known = knownTermSet(rows);
  assert.deepEqual([...known].sort(), ['decide', 'take into account']);
  assert.equal(isKnownTerm('decided', known), true);
  assert.equal(isKnownTerm('Deciding', known), true);
  assert.equal(isKnownTerm('took into account', known), true);
  assert.equal(isKnownTerm('gone', known), false, 'a removed word is suggested again');
  assert.equal(isKnownTerm('decision', known), false);
  assert.deepEqual(
    knownFormsInText('She decided to take into account what he decides.', known).sort(),
    ['decided', 'decides', 'take into account'],
  );
});

test('removing a term deletes every row for it, and the list shows each term once, newest first', () => {
  const rows: KnownWord[] = [newKnownWord('ample', T0, 'a1'), newKnownWord('ample', T1, 'a2'), newKnownWord('bleak', T1, 'b1')];
  assert.deepEqual(knownList(rows).map(r => r.id), ['a2', 'b1']);
  const gone = forgetRows(rows, 'Ample', T1);
  assert.deepEqual(gone.map(r => [r.id, r.isDeleted, r.updatedAt]), [['a1', true, T1.toISOString()], ['a2', true, T1.toISOString()]]);
  assert.deepEqual(knownList([...gone, rows[2]]).map(r => r.term), ['bleak']);
});

const sectionText = Array.from({ length: 8 }, (_, i) => `Sentence ${i} says she decided to remain resilient and ${'calm '.repeat(20).trim()}.`).join(' ');
const item = (front: string): ExtractedWordCard => ({ front, back: 'معنی', selected: true });

test('extraction tells the AI to skip known words and drops any it still sends', async () => {
  let excluded: string[] = [];
  const result = await extractFromLongText({
    text: sectionText,
    level: 'B2',
    perSection: 5,
    source: 'ai',
    existingFronts: [],
    knownTerms: ['decide', 'Resilient'],
    extractAi: async ({ exclude = [] }) => { excluded = exclude; return [item('decide'), item('resilient'), item('remain'), { ...item('Past simple'), kind: 'grammar' }]; },
    extractFree: async () => { throw new Error('not used'); },
  });
  assert.ok(excluded.includes('decided') && excluded.includes('resilient'));
  assert.deepEqual(result.cards.map(c => c.front), ['remain', 'Past simple']);
});

// --- A section as numbered words ---

const text = 'Mr. Knightley took it into account. She smiled.\n\nThe next day, they set off early! Nobody knew why';

test('a section knows its words, sentences and paragraphs', () => {
  const s = readerSection(text);
  assert.equal(s.paragraphs.length, 2);
  assert.deepEqual(s.sentences.map(x => text.slice(x.start, x.end)), [
    'Mr. Knightley took it into account.', 'She smiled.', 'The next day, they set off early!', 'Nobody knew why',
  ]);
  assert.equal(s.words.length, 18);
  assert.equal(s.words[8].text, 'The');
  assert.equal(s.words[8].sentence, 2);
  assert.equal(rangeText(s, 5, 2), 'took it into account');
  assert.equal(rangeText(s, 6, 8), 'She smiled. The', 'a pick across a paragraph break reads as one line');
  assert.deepEqual(sentenceOf(s, 12), { text: 'The next day, they set off early!', first: 8, last: 14 });
});

test('a phrase is found in any form, with one word between its parts, never across sentences', () => {
  const s = readerSection(text);
  assert.deepEqual(phraseRanges(s, 'take into account'), [[2, 5]]);
  assert.deepEqual(phraseRanges(s, 'set off'), [[12, 13]]);
  assert.deepEqual(phraseRanges(s, 'smile'), [[7, 7]]);
  assert.deepEqual(phraseRanges(s, 'account she'), [], 'not across a sentence end');
  assert.deepEqual(phraseRanges(readerSection(''), 'x'), []);
});

// --- Meaning in this sentence, and a sentence's grammar ---

test('the sense prompt carries each term with its sentence', () => {
  const prompt = buildSensePrompt([{ term: 'bank', sentence: 'They sat on the bank of the river.' }, { term: 'took it into account', sentence: 'He took it into account.' }], 'B1');
  assert.match(prompt, /1\. term: "bank"\n {3}sentence: "They sat on the bank of the river\."/);
  assert.match(prompt, /2\. term: "took it into account"/);
  assert.match(prompt, /level "B1"/);
  assert.match(buildSentencePrompt('Had I known, I would have come.', 'C1'), /"Had I known, I would have come\."/);
});

test('meanings are matched to their items by number, and items without one stay empty', () => {
  const senses = parseSenses({ senses: [
    { index: 2, front: 'take into account', back: 'در نظر گرفتن', kind: 'phrase', partOfSpeech: 'phrasal verb' },
    { index: 1, front: 'bank', back: 'ساحل رود', definition: 'the land beside a river', notes: 'نه «بانک»' },
    { index: 1, front: 'bank', back: 'duplicate' },
    { index: 9, front: 'x', back: 'out of range goes by order' },
    { front: 'y', back: '' },
  ] }, 3);
  assert.equal(senses[0]!.back, 'ساحل رود');
  assert.equal(senses[0]!.notes, 'نه «بانک»');
  assert.equal(senses[1]!.front, 'take into account');
  assert.equal(senses[1]!.kind, 'phrase');
  assert.equal(senses[2], null);
  assert.deepEqual(parseSenses([{ front: 'a', back: 'ب', kind: 'verb' }], 1)[0]!.kind, undefined, 'an unknown kind is dropped');
  assert.throws(() => parseSenses('nothing', 1));
});

test('a sentence analysis becomes grammar items with the explanation, form and exercise', () => {
  const analysis = parseSentenceAnalysis({
    translation: 'اگر می‌دانستم، می‌آمدم.',
    structures: [
      { name: 'Inverted conditional', pattern: 'Had + subject + past participle', explanation: 'شرطی سوم بدون if', practicePrompt: 'با این ساختار یک جمله بنویس.', example: 'Had she called, I would have answered.' },
      { name: '', explanation: 'no name' },
    ],
  });
  assert.equal(analysis.structures.length, 1);
  const [card] = grammarCards(analysis, 'Had I known, I would have come.');
  assert.equal(card.kind, 'grammar');
  assert.equal(card.back, 'شرطی سوم بدون if');
  assert.equal(card.grammarPattern, 'Had + subject + past participle');
  assert.equal(card.practicePrompt, 'با این ساختار یک جمله بنویس.');
  assert.deepEqual(card.exampleSentenceTarget, ['Had she called, I would have answered.']);
  assert.equal(card.sourceSentence, 'Had I known, I would have come.');
});

test('taps close together go to the AI as one request', async () => {
  const sent: SenseRequest[][] = [];
  const batcher = new SenseBatcher(async items => {
    sent.push(items);
    return items.map(it => ({ front: it.term, back: `«${it.term}»` }));
  }, 20, 3);
  const a = batcher.request({ term: 'a', sentence: 's' });
  const b = batcher.request({ term: 'b', sentence: 's' });
  assert.deepEqual((await Promise.all([a, b])).map(s => s!.back), ['«a»', '«b»']);
  assert.deepEqual(sent.map(batch => batch.map(i => i.term)), [['a', 'b']]);

  // A full batch goes at once; the rest waits for the next.
  const four = ['c', 'd', 'e', 'f'].map(term => batcher.request({ term, sentence: 's' }));
  await Promise.all(four);
  assert.deepEqual(sent.slice(1).map(batch => batch.map(i => i.term)), [['c', 'd', 'e'], ['f']]);

  // A failed request fails every tap in it; leaving drops waiting ones.
  const failing = new SenseBatcher(async () => { throw new Error('quota'); }, 5);
  await assert.rejects(failing.request({ term: 'x', sentence: 's' }), /quota/);
  const left = new SenseBatcher(async () => { throw new Error('not sent'); }, 1000);
  const waiting = left.request({ term: 'y', sentence: 's' });
  left.cancel();
  assert.equal(await waiting, null);
});

// --- Lookups kept on the server ---

const enrichment = (translation: string, extra: Partial<FreeEnrichment> = {}): FreeEnrichment => ({
  found: true, headword: 'ample', pronunciation: '', partOfSpeech: 'adj.', definitions: [], examples: [], translation,
  collocations: [{ phrase: 'ample time' }], ...extra,
});

test('a full lookup is kept for 90 days, a partial one for a day, one without a translation not at all', () => {
  assert.equal(lookupKeepMs(enrichment('فراوان')), LOOKUP_KEEP_MS);
  assert.equal(lookupKeepMs(enrichment('فراوان', { found: false })), PARTIAL_LOOKUP_KEEP_MS, 'the dictionary may have timed out');
  assert.equal(lookupKeepMs(enrichment('فراوان', { collocations: [] })), PARTIAL_LOOKUP_KEEP_MS, 'the expressions service may have failed');
  assert.equal(lookupKeepMs(enrichment('')), 0);
  assert.equal(lookupKeepMs(null), 0);
});

test('the server keeps lookups by their lifetime, and the cache never breaks a lookup', async () => {
  const saved = new Map<string, { v: FreeEnrichment; keepMs: number }>();
  const store = { get: async (k: string) => saved.get(k)?.v || null, set: async (k: string, v: FreeEnrichment, keepMs: number) => { saved.set(k, { v, keepMs }); } };
  let loads = 0;
  const load = (t: string, extra: Partial<FreeEnrichment> = {}) => async () => { loads++; return enrichment(t, extra); };

  assert.equal((await cachedEnrich('  Ample ', store, load(''))).translation, '');
  assert.equal(saved.size, 0, 'no translation: asked again next time');
  await cachedEnrich('ample', store, load('فراوان'));
  assert.deepEqual([...saved.keys()], [lookupCacheKey('AMPLE')]);
  assert.equal(saved.get(lookupCacheKey('ample'))!.keepMs, LOOKUP_KEEP_MS);
  assert.equal((await cachedEnrich('Ample', store, load('other'))).translation, 'فراوان');
  assert.equal(loads, 2);
  await cachedEnrich('take stock', store, load('ارزیابی', { found: false, collocations: [] }));
  assert.equal(saved.get(lookupCacheKey('take stock'))!.keepMs, PARTIAL_LOOKUP_KEEP_MS);

  const broken = { get: async () => { throw new Error('down'); }, set: async () => { throw new Error('down'); } };
  assert.equal((await cachedEnrich('ample', broken, load('فراوان'))).translation, 'فراوان');
  assert.equal((await cachedEnrich('ample', null, load('x'))).translation, 'x');
});

test('the lookup file keeps each lookup until its time is up', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lc-lookups-')), '.lookup_cache.json');
  let now = T0.getTime();
  const store = fileLookupStore(file, () => now);
  await store.set('lookup:v1:ample', enrichment('فراوان'), LOOKUP_KEEP_MS);
  await store.set('lookup:v1:brief', enrichment('کوتاه'), PARTIAL_LOOKUP_KEEP_MS);
  store.flush();
  const again = fileLookupStore(file, () => now);
  assert.equal((await again.get('lookup:v1:ample'))?.translation, 'فراوان');
  now += PARTIAL_LOOKUP_KEEP_MS;
  assert.equal(await again.get('lookup:v1:brief'), null);
  assert.equal((await again.get('lookup:v1:ample'))?.translation, 'فراوان');
  now += LOOKUP_KEEP_MS;
  assert.equal(await again.get('lookup:v1:ample'), null);
  assert.equal(await fileLookupStore(file, () => now).get('lookup:v1:ample'), null, 'old entries are dropped on load');
  fs.writeFileSync(file, 'not json');
  assert.equal(await fileLookupStore(file, () => now).get('x'), null, 'a damaged file starts over');
});
