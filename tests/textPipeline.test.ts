import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSentence, splitIntoChunks, wordCount } from '../services/textChunker';
import { existingTermsInText, markExisting, mergeExtracted, normalizeTerm } from '../services/vocabMerge';
import { candidatePhrasalVerbs, candidateWords, pickHardWords } from '../services/freeCandidates';
import { extractFromLongText } from '../services/extractionPipeline';
import { parseExtractedItems } from '../services/geminiService';
import { ExtractedWordCard } from '../types';

const sentence = (n: number, i: number) => `Sentence ${i} ` + Array.from({ length: n - 3 }, () => 'word').join(' ') + ' ends.';

test('splitIntoChunks keeps every section within the word limit and loses no words', () => {
  const text = Array.from({ length: 40 }, (_, i) => sentence(23, i)).join(' ');
  const chunks = splitIntoChunks(text, 300);
  assert.ok(chunks.length >= 4);
  for (const c of chunks) assert.ok(wordCount(c) <= 300, `chunk has ${wordCount(c)} words`);
  assert.equal(chunks.reduce((n, c) => n + wordCount(c), 0), wordCount(text));
});

test('splitIntoChunks splits on sentence boundaries', () => {
  const text = Array.from({ length: 30 }, (_, i) => sentence(23, i)).join(' ');
  for (const c of splitIntoChunks(text, 300)) {
    assert.match(c, /^Sentence \d+/);
    assert.match(c, /ends\.$/);
  }
});

test('splitIntoChunks cuts a sentence longer than the limit and keeps paragraph breaks', () => {
  const long = Array.from({ length: 650 }, () => 'word').join(' ') + '.';
  const chunks = splitIntoChunks(long, 300);
  assert.deepEqual(chunks.map(wordCount), [300, 300, 50]);
  assert.deepEqual(splitIntoChunks('First one.\n\nSecond one.', 300), ['First one.\n\nSecond one.']);
  assert.deepEqual(splitIntoChunks('   ', 300), []);
});

test('findSentence finds inflected words and separated phrasal verbs', () => {
  const text = 'He was tired. She reluctantly agreed to the plan.\n\nThey gave it up after a week.';
  assert.equal(findSentence(text, 'reluctant'), 'She reluctantly agreed to the plan.');
  assert.equal(findSentence(text, 'give up'), undefined); // "gave" is irregular
  assert.equal(findSentence(text, 'agree'), 'She reluctantly agreed to the plan.');
  assert.equal(findSentence('We had to carry it out quickly.', 'carry out'), 'We had to carry it out quickly.');
});

test('normalizeTerm ignores case, punctuation, articles and "to"', () => {
  assert.equal(normalizeTerm('  To Take Into Account. '), 'take into account');
  assert.equal(normalizeTerm('The Resilience'), 'resilience');
});

const card = (front: string, extra: Partial<ExtractedWordCard> = {}): ExtractedWordCard => ({ front, back: '', selected: true, ...extra });

test('mergeExtracted removes repeats and fills empty fields from later sections', () => {
  const merged = mergeExtracted([
    card('Resilient', { back: 'مقاوم', collocations: [{ phrase: 'resilient economy' }] }),
    card('resilient', { pronunciation: '/rɪˈzɪl.i.ənt/', collocations: [{ phrase: 'Resilient economy', meaning: 'اقتصاد مقاوم' }, { phrase: 'remain resilient' }] }),
    card('cope'),
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].back, 'مقاوم');
  assert.equal(merged[0].pronunciation, '/rɪˈzɪl.i.ənt/');
  assert.deepEqual(merged[0].collocations, [{ phrase: 'resilient economy', meaning: 'اقتصاد مقاوم' }, { phrase: 'remain resilient' }]);
});

test('markExisting flags and unselects terms that already have a card', () => {
  const out = markExisting([card('cope'), card('Thrive')], ['thrive ']);
  assert.equal(out[0].alreadyInDeck, undefined);
  assert.equal(out[1].alreadyInDeck, true);
  assert.equal(out[1].selected, false);
});

test('existingTermsInText lists only cards that occur in the section', () => {
  assert.deepEqual(existingTermsInText('We must take into account the cost.', ['take into account', 'cost', 'thrive']), ['take into account', 'cost']);
});

test('candidateWords skips stop words, short words and names', () => {
  const words = candidateWords('Yesterday Maria visited the ancient monastery. Ancient walls surround it.').map(c => c.word);
  assert.deepEqual(words, ['yesterday', 'visited', 'ancient', 'monastery', 'walls', 'surround']);
});

test('candidatePhrasalVerbs finds verb + particle pairs', () => {
  const phrases = candidatePhrasalVerbs('They had to carry out the test and then give up. The cat sat on the mat.').map(c => c.word);
  assert.ok(phrases.includes('carry out'));
  assert.ok(phrases.includes('give up'));
  assert.ok(phrases.includes('sat on'));
  assert.ok(!phrases.includes('the mat'));
});

test('pickHardWords keeps words below the level threshold, most frequent first', () => {
  const candidates = ['house', 'ancient', 'monastery', 'zxqv', 'surround'].map(word => ({ word, sentence: '' }));
  const freq = { house: 300, ancient: 30, monastery: 4, zxqv: 0.01, surround: 12 };
  assert.deepEqual(pickHardWords(candidates, freq, 'B2', 10).map(c => c.word), ['surround', 'monastery']);
  assert.deepEqual(pickHardWords(candidates, freq, 'A2', 2).map(c => c.word), ['ancient', 'surround']);
  assert.deepEqual(pickHardWords(candidates, freq, 'B2', 10, ['surround']).map(c => c.word), ['monastery']);
});

test('parseExtractedItems normalises AI output', () => {
  const items = parseExtractedItems({
    words: [
      { kind: 'phrase', front: ' take into account ', back: 'در نظر گرفتن', collocations: ['take sth into account', { phrase: 'fully take into account', meaning: 'کاملاً' }], definition: 'consider' },
      { front: 'give up', back: 'دست کشیدن' },
      { kind: 'grammar', front: 'Past perfect', back: 'ماضی بعید', grammarPattern: 'had + past participle', practicePrompt: 'یک جمله بنویس' },
      { front: '' },
    ],
  });
  assert.equal(items.length, 3);
  assert.equal(items[0].front, 'take into account');
  assert.deepEqual(items[0].definition, ['consider']);
  assert.deepEqual(items[0].collocations, [{ phrase: 'take sth into account' }, { phrase: 'fully take into account', meaning: 'کاملاً' }]);
  assert.equal(items[1].kind, 'phrase');
  assert.equal(items[2].grammarPattern, 'had + past participle');
});

const longText = Array.from({ length: 3 }, (_, s) =>
  Array.from({ length: 12 }, (_, i) => `Section${s} sentence ${i} mentions resilient people and ${'filler '.repeat(18).trim()}.`).join(' ')
).join('\n\n');

test('extractFromLongText analyses each section, merges repeats and flags existing cards', async () => {
  const seen: { words: number; exclude: string[] }[] = [];
  const progress: number[] = [];
  const result = await extractFromLongText({
    text: longText,
    level: 'B2',
    perSection: 5,
    source: 'ai',
    existingFronts: ['filler'],
    extractAi: async ({ text, exclude = [] }) => {
      seen.push({ words: wordCount(text), exclude });
      return [card('resilient'), card('filler'), card(`term${seen.length}`)];
    },
    extractFree: async () => { throw new Error('should not be used'); },
    onProgress: p => progress.push(p.done),
  });
  assert.ok(seen.length >= 2);
  for (const s of seen) assert.ok(s.words <= 300);
  assert.ok(seen[0].exclude.includes('filler'));
  assert.ok(seen[1].exclude.includes('resilient'), 'terms of earlier sections are excluded later');
  assert.deepEqual(progress, seen.map((_, i) => i + 1));
  const fronts = result.cards.map(c => c.front);
  assert.equal(fronts.filter(f => f === 'resilient').length, 1);
  assert.equal(result.cards.find(c => c.front === 'filler')?.alreadyInDeck, true);
  assert.match(result.cards.find(c => c.front === 'resilient')!.sourceSentence!, /resilient people/);
});

test('extractFromLongText falls back to free dictionaries when AI fails', async () => {
  let freeCalls = 0;
  const result = await extractFromLongText({
    text: longText,
    level: 'B2',
    perSection: 3,
    source: 'ai',
    existingFronts: [],
    extractAi: async () => { throw new Error('quota exceeded'); },
    extractFree: async () => { freeCalls++; return [card(`free${freeCalls}`)]; },
  });
  assert.equal(result.fallbackSections, result.sections);
  assert.equal(freeCalls, result.sections);
  assert.equal(result.cards.length, result.sections);
});

test('extractFromLongText stops when aborted', async () => {
  const controller = new AbortController();
  const result = await extractFromLongText({
    text: longText,
    level: 'B2',
    perSection: 3,
    source: 'free',
    existingFronts: [],
    signal: controller.signal,
    extractFree: async () => { controller.abort(); return [card('first')]; },
  });
  assert.equal(result.stopped, true);
  assert.deepEqual(result.cards.map(c => c.front), ['first']);
});
