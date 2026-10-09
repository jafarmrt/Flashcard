import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfile, countWords, coverageOf, CoverageError, knownByFrom, sampleWords, textLevelOf, HEAD_SIZE, TAIL_SIZE, type BookProfile } from '../services/coverage';
import { blankOf, checkCloze, clozeFor, makeCloze } from '../services/cloze';
import { bookGrowth, cardsOfSource, hardestWords, pickBookReview, reviewsPerDay } from '../services/readingStats';
import { readingCounts } from '../services/gamificationService';
import { sectionReward } from '../services/library';
import { BOOK_COMPLETE_XP, CHAPTER_COMPLETE_XP, CHUNK_COMPLETE_XP } from '../services/xpRules';
import { newKnownWord } from '../services/knownWords';
import type { Chapter, Flashcard, Occurrence, Source, StudyLog } from '../types';

// Noon on the device's own calendar, so day strings are the same in every time zone.
const T0 = new Date(2026, 9, 9, 12);
const DAY = 24 * 60 * 60 * 1000;

const card = (over: Partial<Flashcard> = {}): Flashcard => ({
  id: over.id || 'c1', deckId: 'd', front: 'reluctant', back: 'بی‌میل', repetition: 0, easinessFactor: 2.5, interval: 0,
  dueDate: T0.toISOString(), createdAt: T0.toISOString(), updatedAt: T0.toISOString(), ...over,
} as Flashcard);

// A card that has grown to a stage: stability in days.
const grown = (id: string, front: string, stability: number, due = new Date(T0.getTime() + 5 * DAY)): Flashcard =>
  card({ id, front, stability, difficulty: 5, repetition: 3, interval: Math.round(stability), dueDate: due.toISOString() });

const occ = (cardId: string, sourceId: string, chapterId: string, at: Date, over: Partial<Occurrence> = {}): Occurrence => ({
  id: `${cardId}@${chapterId}`, cardId, sourceId, chapterId, chunk: 0, createdAt: at.toISOString(), updatedAt: at.toISOString(), ...over,
});

const source = (id: string, title: string, kind: Source['kind'] = 'book'): Source =>
  ({ id, title, kind, deckId: 'd', createdAt: T0.toISOString(), updatedAt: T0.toISOString() } as Source);

const chapter = (id: string, sourceId: string, order: number, chunkCount: number, completed: number[]): Chapter =>
  ({ id, sourceId, order, title: `Chapter ${order}`, chunkCount, wordCount: 300 * chunkCount, completed, createdAt: T0.toISOString(), updatedAt: T0.toISOString() } as Chapter);

// --- Vocabulary coverage ---

test('word counts leave out names and count stop words and short forms as common', () => {
  const { tokens, common, counts } = countWords(['Emma smiled. "I don\'t know," Emma said; her mother\'s garden was well-kept. Garden walls smiled.']);
  assert.equal(counts.has('emma'), false, 'a name');
  assert.equal(counts.get('garden'), 2, 'capitalised at the start of a sentence, lower-case elsewhere: one word');
  assert.equal(counts.get('mother'), 1, '"mother\'s" counts as "mother"');
  assert.equal(counts.get('smiled'), 2);
  assert.ok(counts.has('kept') && counts.has('well') === false, 'a hyphenated word is its parts; "well" is a stop word');
  // I, don't, know, said, her, was, well: common.
  assert.equal(common, 7);
  assert.equal(tokens, common + [...counts.values()].reduce((a, b) => a + b, 0));
});

test('the sample is the most used words plus an even spread of the rest', () => {
  const counts = new Map(Array.from({ length: 1000 }, (_, i) => [`w${String(i).padStart(4, '0')}`, 1000 - i] as [string, number]));
  const { head, tail, tailTokens } = sampleWords(counts);
  assert.equal(head.length, HEAD_SIZE);
  assert.equal(tail.length, TAIL_SIZE);
  assert.equal(head[0][0], 'w0000');
  assert.equal(tailTokens, Array.from({ length: 750 }, (_, i) => 750 - i).reduce((a, b) => a + b, 0));
  assert.equal(new Set(tail.map(([w]) => w)).size, TAIL_SIZE, 'no word twice');
});

const profile = (over: Partial<BookProfile> = {}): BookProfile => ({
  tokens: 1000, common: 500,
  head: [
    { word: 'garden', count: 300, frequency: 60 }, // B1
    { word: 'reluctant', count: 100, frequency: 10 }, // C1
    { word: 'zephyr', count: 50, frequency: null }, // unknown
  ],
  tail: [{ word: 'brisk', count: 10, frequency: 5 }, { word: 'meadow', count: 10, frequency: 20 }], // C2, B2
  tailTokens: 50, types: 400, at: T0.toISOString(), ...over,
});

test('coverage counts level, cards and the "I know it" list, and estimates the text level', () => {
  const nobody = () => null;
  const b2 = coverageOf(profile(), 'B2', nobody);
  // 500 common + 300 garden + half of the tail's 50 = 825 of 1000.
  assert.equal(b2.percent, 82.5);
  assert.equal(b2.byLevel, 82.5);
  assert.equal(b2.personal, 0);
  assert.equal(b2.unknownPer300, 53);
  assert.equal(b2.verdict, 'hard');
  assert.equal(coverageOf(profile(), 'C1', nobody).percent, 92.5, 'a C1 reader knows "reluctant" too');
  const mine = coverageOf(profile(), 'B2', w => (w === 'reluctant' ? 'card' : w === 'zephyr' ? 'list' : null));
  assert.equal(mine.percent, 97.5);
  assert.equal(mine.personal, 15);
  assert.equal(mine.verdict, 'fits');
  assert.equal(textLevelOf(profile()), 'C2', 'at C2 only the unknown word is missing: 95%');
  assert.equal(textLevelOf(profile({ head: [{ word: 'garden', count: 300, frequency: 60 }, { word: 'reluctant', count: 50, frequency: 10 }, { word: 'zephyr', count: 100, frequency: null }] })), 'C2+', 'unknown words keep even C2 below 95%');
  assert.equal(textLevelOf(profile({ head: [{ word: 'garden', count: 480, frequency: 60 }, { word: 'reluctant', count: 20, frequency: 10 }], tail: [], tailTokens: 0 })), 'B1');
});

test('a profile is built with one frequency lookup of the sample', async () => {
  const asked: string[][] = [];
  const p = await buildProfile(['The reluctant gardener walked to the garden. The garden was quiet.'], async words => {
    asked.push(words);
    return Object.fromEntries(words.map(w => [w, w === 'reluctant' ? 10 : 100]));
  }, T0);
  assert.equal(asked.length, 1);
  assert.deepEqual(p.head.map(s => s.word).sort(), ['garden', 'gardener', 'quiet', 'reluctant', 'walked']);
  assert.equal(p.head.find(s => s.word === 'reluctant')!.frequency, 10);
  assert.equal(p.at, T0.toISOString());
});

test('failed lookups are tried once more, and too many failures give no profile', async () => {
  const text = ['The reluctant gardener walked to the garden. The garden was quiet.'];
  let calls = 0;
  // The first answer leaves out two words (a timeout); the second has them.
  const flaky = async (words: string[]) => {
    calls++;
    return Object.fromEntries(words.filter(w => calls > 1 || (w !== 'quiet' && w !== 'walked')).map(w => [w, 100]));
  };
  const p = await buildProfile(text, flaky, T0);
  assert.equal(calls, 2);
  assert.equal(p.head.find(s => s.word === 'quiet')!.frequency, 100);
  // Offline or rate-limited throughout: no result rather than "hard".
  await assert.rejects(buildProfile(text, async () => ({}), T0), (e: unknown) => e instanceof CoverageError && e.reason === 'lookup-failed');
  // Not English: nothing to measure.
  await assert.rejects(buildProfile(['Emma! I, the, and.'], async () => ({}), T0), (e: unknown) => e instanceof CoverageError && e.reason === 'no-words');
});

test('a word is the learner\'s own once its card has grown, or when it is on the list, in any form', () => {
  const knownBy = knownByFrom([grown('a', 'decide', 12), grown('b', 'garden', 2), card({ id: 'c', front: 'take into account', stability: 40, repetition: 3, interval: 40 })], [newKnownWord('walk', T0, 'k1')]);
  assert.equal(knownBy('decided'), 'card');
  assert.equal(knownBy('garden'), null, 'a young card does not count yet');
  assert.equal(knownBy('walked'), 'list');
  assert.equal(knownBy('account'), null, 'phrases are not single words of the text');
});

// --- Cloze ---

test('a gap is made in the book\'s sentence, in the form written there', () => {
  const c = makeCloze('She decided to stay at home.', 'decide')!;
  assert.deepEqual([c.before, c.answer, c.after], ['She ', 'decided', ' to stay at home.']);
  const phrase = makeCloze('They took the cost into account at last.', 'take something into account')!;
  assert.equal(phrase.answer, 'took the cost into account');
  assert.equal(makeCloze('Decided.', 'decide'), null, 'too short to hint at anything');
  assert.equal(makeCloze('He went home.', 'decide'), null);
  assert.equal(makeCloze('He decided, then decided again, to go.', 'decide'), null, 'the second one would give the answer away');
  assert.equal(blankOf('took into account'), 't___ i___ a______');
});

test('the gap sentence comes from where the word was met first, then the card', () => {
  const c = card({ front: 'reluctant', sourceSentence: 'He was reluctant to go out.', exampleSentenceTarget: ['A reluctant hero.'] });
  assert.equal(clozeFor(c, ['The reluctant boy stayed in his room.'])!.sentence, 'The reluctant boy stayed in his room.');
  assert.equal(clozeFor(c, ['Nothing here matches.'])!.sentence, 'He was reluctant to go out.');
  assert.equal(clozeFor(c, ['The reluctant boy met a reluctant girl.', 'A reluctant smile came at last.'])!.sentence, 'A reluctant smile came at last.');
  assert.equal(clozeFor(card({ kind: 'grammar', front: 'Passive voice', sourceSentence: 'It was built.' })), null);
  assert.equal(clozeFor(card({ front: 'zorp' })), null);
});

test('an answer is right as written, close with a typo or another form, else wrong', () => {
  const c = makeCloze('She decided to stay at home.', 'decide')!;
  assert.equal(checkCloze('decided', c, 'decide'), 'correct');
  assert.equal(checkCloze(' Decided ', c, 'decide'), 'correct');
  assert.equal(checkCloze('decidd', c, 'decide'), 'close');
  assert.equal(checkCloze('decide', c, 'decide'), 'close');
  assert.equal(checkCloze('chose', c, 'decide'), 'wrong');
  assert.equal(checkCloze('', c, 'decide'), 'wrong');
});

// --- Review by book ---

test('a book review takes the due cards of the book or chapter, else its weakest', () => {
  const cards = [
    grown('a', 'alpha', 20, new Date(T0.getTime() - DAY)), // due
    grown('b', 'beta', 2), // weak, not due
    grown('c', 'gamma', 40), // strong
    grown('d', 'delta', 2, new Date(T0.getTime() - DAY)), // other book
    grown('e', 'epsilon', 2, new Date(T0.getTime() - DAY)), // taken out of this book
  ];
  const occurrences = [occ('a', 's1', 'c1', T0), occ('b', 's1', 'c2', T0), occ('c', 's1', 'c2', T0), occ('d', 's2', 'x1', T0), occ('e', 's1', 'c3', T0, { isDeleted: true })];
  assert.deepEqual(cardsOfSource(occurrences, cards, 's1').map(c => c.id), ['a', 'b', 'c']);
  assert.deepEqual(cardsOfSource(occurrences, cards, 's1', 'c2').map(c => c.id), ['b', 'c']);
  const book = pickBookReview(cardsOfSource(occurrences, cards, 's1'), T0);
  assert.deepEqual([book.due, book.cards.map(c => c.id)], [true, ['a']]);
  const chapterTwo = pickBookReview(cardsOfSource(occurrences, cards, 's1', 'c2'), T0, 1);
  assert.deepEqual([chapterTwo.due, chapterTwo.cards.map(c => c.id)], [false, ['b']], 'the weakest first');
});

// --- Stats ---

test('each book\'s cards grow week by week, counted where they were first met', () => {
  const cards = [grown('a', 'alpha', 20), grown('b', 'beta', 2), grown('c', 'gamma', 40)];
  const sources = [source('s1', 'Emma'), source('s2', 'Dune'), { ...source('s3', 'Gone'), isDeleted: true }];
  const occurrences = [
    occ('a', 's1', 'c1', new Date(T0.getTime() - 20 * DAY)),
    occ('b', 's1', 'c1', new Date(T0.getTime() - 2 * DAY)),
    occ('a', 's2', 'x1', new Date(T0.getTime() - 1 * DAY)),
    occ('c', 's3', 'y1', T0),
  ];
  const growth = bookGrowth(occurrences, cards, sources, 4, T0);
  assert.deepEqual(growth.map(g => [g.title, g.points, g.total, g.learned]), [
    ['Emma', [0, 1, 1, 2], 2, 1],
    ['Dune', [0, 0, 0, 1], 1, 1],
  ]);
});

test('the hardest words have the most "again" answers', () => {
  const cards = [card({ id: 'a', front: 'alpha' }), card({ id: 'b', front: 'beta' }), card({ id: 'c', front: 'gamma', isDeleted: true })];
  const log = (cardId: string, rating: StudyLog['rating'], date = '2026-10-08'): StudyLog => ({ cardId, rating, date });
  const logs = [log('a', 'AGAIN'), log('a', 'GOOD'), log('b', 'AGAIN'), log('b', 'AGAIN'), log('c', 'AGAIN'), log('c', 'AGAIN'), log('c', 'AGAIN')];
  assert.deepEqual(hardestWords(logs, cards).map(h => [h.card.id, h.again, h.reviews]), [['b', 2, 2], ['a', 1, 2]]);
  const days = reviewsPerDay([log('a', 'GOOD', '2026-10-09'), log('b', 'GOOD', '2026-10-09'), log('a', 'GOOD', '2026-10-01')], 10, T0);
  assert.equal(days.length, 10);
  assert.deepEqual(days[9], { day: '2026-10-09', count: 2 });
  assert.equal(days.reduce((n, d) => n + d.count, 0), 3);
});

test('reading milestones: chapters and books finished, words carded from texts', () => {
  const sources = [source('s1', 'Emma'), source('s2', 'Note', 'article'), { ...source('s3', 'Gone'), isDeleted: true }];
  const chapters = [
    chapter('c1', 's1', 1, 2, [0, 1]), chapter('c2', 's1', 2, 1, [0]),
    chapter('a1', 's2', 1, 1, [0]),
    chapter('g1', 's3', 1, 1, [0]),
  ];
  const cards = [card({ id: 'a' }), card({ id: 'b', isDeleted: true })];
  const counts = readingCounts(sources, chapters, [occ('a', 's1', 'c1', T0), occ('b', 's1', 'c1', T0)], cards);
  assert.deepEqual(counts, { chaptersDone: 3, booksDone: 1, wordsFromTexts: 1 });
});

test('the last section of a chapter, and of a book, earns a bonus; the badge and the bonus agree', () => {
  const book = source('s1', 'Emma');
  const article = source('s2', 'Note', 'article');
  const one = source('s3', 'Short', 'book');
  const chapters = [chapter('c1', 's1', 1, 2, [0, 1]), chapter('c2', 's1', 2, 2, [0]), chapter('a1', 's2', 1, 1, []), chapter('a2', 's2', 2, 1, [0]), chapter('o1', 's3', 1, 1, [])];
  const finish = (id: string, index: number) => {
    const c = chapters.find(x => x.id === id)!;
    return { ...c, completed: [...new Set([...c.completed, index])] };
  };
  assert.deepEqual(sectionReward(chapter('c2', 's1', 2, 3, [0]), book, chapters), { chapterDone: false, bookDone: false, xp: CHUNK_COMPLETE_XP });
  assert.deepEqual(sectionReward(finish('c2', 1), book, chapters), { chapterDone: true, bookDone: true, xp: CHUNK_COMPLETE_XP + CHAPTER_COMPLETE_XP + BOOK_COMPLETE_XP });
  assert.deepEqual(sectionReward(finish('a1', 0), article, chapters), { chapterDone: true, bookDone: false, xp: CHUNK_COMPLETE_XP + CHAPTER_COMPLETE_XP }, 'an article is not a book');
  assert.equal(sectionReward(finish('o1', 0), one, chapters).bookDone, true, 'a book of one chapter is a book');
  const after = chapters.map(c => (c.id === 'c2' ? finish('c2', 1) : c.id === 'a1' ? finish('a1', 0) : c.id === 'o1' ? finish('o1', 0) : c));
  assert.equal(readingCounts([book, article, one], after, [], []).booksDone, 2, 'the same two books earn the badge');
});
