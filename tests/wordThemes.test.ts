import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContrastPrompt,
  buildMicroStoryPrompt,
  cardHasTheme,
  hasUncoveredContrastPairs,
  hasUncoveredStoryWords,
  localContrastUnit,
  makeSavedContrastExercise,
  makeSavedStoryExercise,
  markThemeExercisePlayed,
  normalizeThemes,
  offlineMicroStory,
  parseBatchThemeReply,
  parseMicroStory,
  pickContrastPairs,
  pickStoryCards,
  rehydrateContrastUnits,
  removeThemeFromCards,
  renameThemeInCards,
  renameThemeInExercises,
  savedExercisesForTheme,
  setThemeMembership,
  themeSummaries,
  wordRoleOf,
} from '../services/wordThemes';
import type { Flashcard, PracticeAnswer } from '../types';
import type { CardPlace } from '../services/library';

const T0 = '2026-11-20T10:00:00.000Z';
const T1 = '2026-11-26T12:00:00.000Z';

const makeCard = (id: string, front: string, back: string, extra: Partial<Flashcard> = {}): Flashcard => ({
  id,
  deckId: 'book-1',
  front,
  back,
  createdAt: T0,
  updatedAt: T0,
  repetition: 1,
  easinessFactor: 2.5,
  interval: 3,
  dueDate: T0,
  ...extra,
});

test('normalizeThemes trims, strips leading hashes, and removes duplicates without losing Persian text', () => {
  assert.deepEqual(
    normalizeThemes(['  #جنگل و طبیعت  ', 'جنگل   و طبیعت', 'حیوانات', '', 'Animals', 'animals']),
    ['جنگل و طبیعت', 'حیوانات', 'Animals'],
  );
});

test('themeSummaries counts cards, due reviews, and scene roles while keeping empty saved themes', () => {
  const cards = [
    makeCard('c1', 'canopy', 'سایه‌بان درختان', { partOfSpeech: 'noun', themes: ['جنگل'] }),
    makeCard('c2', 'rustle', 'خش‌خش کردن', { partOfSpeech: 'verb', themes: ['جنگل'] }),
    makeCard('c3', 'damp', 'نمناک', { partOfSpeech: 'adjective', themes: ['جنگل'], dueDate: '2027-01-01T00:00:00.000Z' }),
    makeCard('c4', 'out of the woods', 'رها از خطر', { kind: 'idiom', themes: ['جنگل'] }),
  ];
  const summaries = themeSummaries(cards, ['جنگل', 'تاریخی'], new Date(T1));
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].name, 'جنگل');
  assert.equal(summaries[0].cardCount, 4);
  assert.equal(summaries[0].dueCount, 3);
  assert.deepEqual(summaries[0].roles, { nouns: 1, verbs: 1, modifiers: 1, phrases: 1 });
  assert.equal(summaries[1].name, 'تاریخی');
  assert.equal(summaries[1].cardCount, 0);
  assert.equal(wordRoleOf(cards[1]), 'verbs');
});

test('renaming, removing, and updating membership of a bundle leaves deckId intact and stamps only changed cards', () => {
  const cards = [
    makeCard('c1', 'brook', 'جویبار', { deckId: 'novel-1', themes: ['جنگل', 'آب'] }),
    makeCard('c2', 'owl', 'جغد', { deckId: 'novel-2', themes: ['حیوانات'] }),
  ];

  const renamed = renameThemeInCards(cards, 'جنگل', 'طبیعت', T1);
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].deckId, 'novel-1', 'book deck stays untouched');
  assert.deepEqual(renamed[0].themes, ['طبیعت', 'آب']);
  assert.equal(renamed[0].updatedAt, T1);

  const membership = setThemeMembership(cards, 'جنگل', new Set(['c2']), T1);
  assert.equal(membership.length, 2, 'removed from c1 and added to c2');
  assert.equal(cardHasTheme(membership.find(c => c.id === 'c1')!, 'جنگل'), false);
  assert.equal(cardHasTheme(membership.find(c => c.id === 'c2')!, 'جنگل'), true);

  const removed = removeThemeFromCards(cards, 'حیوانات', T1);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].themes, undefined);
  assert.equal(removed[0].isDeleted, undefined, 'card itself is never deleted when removing a bundle');
});

test('parseBatchThemeReply maps 1-based and 0-based AI replies cleanly onto cards', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const parsed = parseBatchThemeReply({
    items: [
      { index: 1, themes: ['جنگل', 'جنگل'] },
      { index: 3, themes: ['تاریخی', 'سفر'] },
    ],
  }, cards);
  assert.deepEqual(parsed, [
    { cardId: 'a', themes: ['جنگل'] },
    { cardId: 'c', themes: ['تاریخی', 'سفر'] },
  ]);
});

test('parseMicroStory extracts marked blanks AND unmarked target words, and offlineMicroStory builds from book sentences', () => {
  const cards = [
    makeCard('c1', 'canopy', 'سایه‌بان'),
    makeCard('c2', 'rustle', 'خش‌خش کردن'),
    makeCard('c3', 'damp', 'نمناک'),
  ];
  const story = parseMicroStory({
    titleFa: 'سپیده‌دم در جنگل',
    story: 'Light filtered through the [[canopy|canopy]] while dry leaves [[rustle|rustled]] on the damp earth.',
    translationFa: 'نور از میان سایه‌بان درختان می‌گذشت و برگ‌های خشک روی خاک نمناک خش‌خش می‌کردند.',
  }, 'جنگل', cards);

  assert.ok(story);
  assert.equal(story!.blanks.length, 3, 'both [[...]] markers and plain "damp" were turned into blanks');
  assert.deepEqual(story!.blanks.map(b => b.targetWord), ['canopy', 'rustle', 'damp']);
  assert.equal(story!.blanks[1].surface, 'rustled');

  const places = new Map<string, CardPlace[]>([
    ['c1', [{ sourceId: 's1', sourceTitle: 'Book', sentence: 'Birds hid high in the green canopy above us.' }]],
    ['c2', [{ sourceId: 's1', sourceTitle: 'Book', sentence: 'Dry leaves began to rustle behind the tent.' }]],
  ]);
  const offline = offlineMicroStory('جنگل', cards.slice(0, 2), places);
  assert.ok(offline);
  assert.equal(offline!.byAi, false);
  assert.equal(offline!.blanks.length, 2);
});

test('pickContrastPairs prioritizes confused or synonymous words and localContrastUnit builds two-sentence contrast drills', () => {
  const brook = makeCard('c1', 'brook', 'جویبار کوچک', {
    partOfSpeech: 'noun',
    synonyms: [{ word: 'stream', note: 'brook کوچک‌تر و شاعرانه‌تر از stream است' }],
    exampleSentenceTarget: ['A clear brook ran past the mossy stones.'],
  });
  const stream = makeCard('c2', 'stream', 'نهر و جریان آب', {
    partOfSpeech: 'noun',
    exampleSentenceTarget: ['A steady mountain stream fed the valley.'],
  });
  const rustle = makeCard('c3', 'rustle', 'خش‌خش کردن', { partOfSpeech: 'verb' });

  const practice: PracticeAnswer[] = [{
    id: 'p1', cardId: 'c1', kind: 'quiz', right: false, chose: 'stream', day: '2026-11-25', createdAt: T0, updatedAt: T0,
  }];

  const pairs = pickContrastPairs([rustle, brook, stream], practice, 2);
  assert.equal(pairs[0][0].id, 'c1');
  assert.equal(pairs[0][1].id, 'c2');

  const unit = localContrastUnit(brook, stream);
  assert.match(unit.differenceFa, /کوچک‌تر/);
  assert.equal(unit.sentence1.answerWord, 'brook');
  assert.equal(unit.sentence2.answerWord, 'stream');
});

test('saved story exercises persist for replay, track uncovered words, prioritize fresh words, and inject anti-repetition prompts', () => {
  const cards = [
    makeCard('c1', 'canopy', 'سایه‌بان'),
    makeCard('c2', 'rustle', 'خش‌خش کردن'),
    makeCard('c3', 'damp', 'نمناک'),
    makeCard('c4', 'fern', 'سرخس'),
    makeCard('c5', 'glade', 'گشودگی جنگل'),
  ];
  const story1 = parseMicroStory({
    titleFa: 'سپیده‌دم در جنگل',
    story: 'Light filtered through the [[canopy|canopy]] while leaves [[rustle|rustled]] on the [[damp|damp]] trail.',
  }, 'جنگل', cards.slice(0, 3))!;
  const saved1 = makeSavedStoryExercise('جنگل', story1, T0, 'ex-story-1');

  assert.equal(hasUncoveredStoryWords(cards, [saved1]), true);
  assert.equal(hasUncoveredStoryWords(cards.slice(0, 3), [saved1]), false);

  // Next story picks unseen words (`fern`, `glade`) first before reusing earlier words.
  const nextPicked = pickStoryCards(cards, 3, new Date(T1), new Set(), [saved1]);
  assert.deepEqual(nextPicked.slice(0, 2).map(c => c.front), ['fern', 'glade']);

  // Prompt explicitly lists saved story title and excerpt so AI avoids repeating plots.
  const prompt = buildMicroStoryPrompt('جنگل', nextPicked, 'B1-B2', [saved1]);
  assert.match(prompt, /سپیده‌دم در جنگل/);
  assert.match(prompt, /Light filtered through the canopy/);

  const replayed = markThemeExercisePlayed(saved1, T1);
  assert.equal(replayed.playCount, 2);
  assert.equal(replayed.lastPlayedAt, T1);

  const renamed = renameThemeInExercises([replayed], 'جنگل', 'جنگل و طبیعت', T1);
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].themeName, 'جنگل و طبیعت');
  assert.equal(savedExercisesForTheme(renamed, 'جنگل و طبیعت', 'story').length, 1);
});

test('saved contrast exercises rehydrate cleanly, prioritize unseen word pairs, and exclude prior sentences in prompts', () => {
  const brook = makeCard('c1', 'brook', 'جویبار کوچک', {
    partOfSpeech: 'noun',
    exampleSentenceTarget: ['A clear brook ran past the mossy stones.'],
  });
  const stream = makeCard('c2', 'stream', 'نهر و جریان آب', {
    partOfSpeech: 'noun',
    exampleSentenceTarget: ['A steady mountain stream fed the valley.'],
  });
  const ridge = makeCard('c3', 'ridge', 'خط‌الراس کوه', {
    partOfSpeech: 'noun',
    exampleSentenceTarget: ['Wind swept across the rocky ridge.'],
  });
  const cliff = makeCard('c4', 'cliff', 'پرتگاه سنگی', {
    partOfSpeech: 'noun',
    exampleSentenceTarget: ['Waves crashed against the steep cliff.'],
  });

  const firstUnit = localContrastUnit(brook, stream);
  const savedContrast = makeSavedContrastExercise('جنگل', [firstUnit], T0, 'ex-con-1');

  // Rehydration restores live Flashcard objects (and gracefully falls back if a card is deleted).
  const rehydrated = rehydrateContrastUnits(savedContrast.contrastUnits, [brook]);
  assert.equal(rehydrated.length, 1);
  assert.equal(rehydrated[0].cardA.id, 'c1');
  assert.equal(rehydrated[0].cardB.front, 'stream');
  assert.equal(rehydrated[0].cardB.back, 'نهر و جریان آب');

  assert.equal(hasUncoveredContrastPairs([brook, stream, ridge, cliff], [savedContrast]), true);
  assert.equal(hasUncoveredContrastPairs([brook, stream], [savedContrast]), false);

  // When picking just 1 pair next time, `brook/stream` is deprioritized in favor of unseen `ridge/cliff` (or another unseen pair).
  const nextPairs = pickContrastPairs([brook, stream, ridge, cliff], [], 1, [savedContrast]);
  assert.equal(nextPairs.length, 1);
  const pairWords = [nextPairs[0][0].front, nextPairs[0][1].front].sort().join('|');
  assert.notEqual(pairWords, 'brook|stream', 'already saved contrast pair is not repeated while unseen pairs remain');

  // When generating new sentences for a previously seen word, the prompt lists prior sentences so AI writes fresh contexts.
  const prompt = buildContrastPrompt('جنگل', [[brook, stream]], [savedContrast]);
  assert.match(prompt, /Previously used example sentences/);
  assert.match(prompt, /clear brook ran past the mossy stones/);
});
