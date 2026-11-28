import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLessonClozeItems,
  completeLessonStage,
  createStudyLesson,
  lessonsByDay,
  pickLessonCards,
  todayOpenLesson,
  withLessonRating,
} from '../services/studyLesson';
import type { Flashcard, PracticeAnswer } from '../types';

const NOW = new Date('2026-11-27T10:00:00.000Z');
const TODAY = '2026-11-27';
const DAY = 24 * 60 * 60 * 1000;

const makeCard = (id: string, word: string, meaning: string, extra: Partial<Flashcard> = {}): Flashcard => ({
  id,
  deckId: 'd1',
  front: word,
  back: meaning,
  sourceSentence: `They noticed the ${word} right away.`,
  createdAt: new Date(NOW.getTime() - 5 * DAY).toISOString(),
  updatedAt: NOW.toISOString(),
  repetition: 1,
  easinessFactor: 2.5,
  interval: 3,
  stability: 3,
  dueDate: new Date(NOW.getTime() - DAY).toISOString(),
  ...extra,
});

test('pickLessonCards prioritizes unresolved mistakes first, then due reviews, then new cards up to maxNewShare', () => {
  const dueReview = makeCard('r1', 'harbor', 'بندر', { stability: 2 });
  const mistakeFuture = makeCard('m1', 'beacon', 'چراغ راهنما', {
    dueDate: new Date(NOW.getTime() + 10 * DAY).toISOString(),
    stability: 12,
  });
  const fresh = Array.from({ length: 5 }, (_, i) =>
    makeCard(`n${i}`, `word${i}`, `معنی${i}`, {
      repetition: 0,
      interval: 0,
      stability: undefined,
      createdAt: new Date(NOW.getTime() - (10 - i) * DAY).toISOString(),
    }),
  );

  const practice: PracticeAnswer[] = [
    {
      id: 'p1',
      cardId: 'm1',
      kind: 'quiz',
      right: false,
      chose: 'harbor',
      day: TODAY,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    },
  ];

  const picked = pickLessonCards([ ...fresh, dueReview, mistakeFuture ], practice, 5, 3, NOW);
  assert.equal(picked.length, 5);
  assert.equal(picked[0].id, 'm1', 'unresolved mistake comes first even if not due');
  assert.equal(picked[1].id, 'r1', 'due review comes next');
  assert.deepEqual(picked.slice(2).map(c => c.id), ['n0', 'n1', 'n2'], 'new cards capped by maxNewShare');
});

test('createStudyLesson builds 30, 45, and 60 minute lessons (splitting 60-min review into two blocks) and completes stages', () => {
  const pool = Array.from({ length: 34 }, (_, i) =>
    makeCard(`c${i}`, `term${i}`, `معنی ${i}`, { stability: (i % 7) + 1 }),
  );

  const l30 = createStudyLesson({
    id: 'les-30',
    durationMinutes: 30,
    cards: pool,
    practice: [],
    today: TODAY,
    now: NOW,
  });
  assert.ok(l30);
  assert.equal(l30.cardIds.length, 15);
  assert.deepEqual(l30.stages.map(s => s.kind), ['review', 'quiz', 'cloze']);

  const l60 = createStudyLesson({
    id: 'les-60',
    durationMinutes: 60,
    cards: pool,
    practice: [],
    today: TODAY,
    now: NOW,
  });
  assert.ok(l60);
  assert.equal(l60.cardIds.length, 30);
  assert.deepEqual(l60.stages.map(s => s.kind), ['review', 'review', 'quiz', 'cloze']);

  // Step through all stages of the 30-min lesson and verify daily recording state.
  const [h1, h2, h3] = [l30.cardIds[2], l30.cardIds[5], l30.cardIds[9]];
  let cur = completeLessonStage(l30, 0, { rightCount: 13, totalCount: 15, hardIds: [h1, h2], addedSeconds: 600 });
  assert.equal(cur.status, 'in_progress');
  assert.equal(cur.currentStageIndex, 1);
  assert.equal(cur.reviewedCount, 15);

  cur = completeLessonStage(cur, 1, { rightCount: 8, totalCount: 10, hardIds: [h2, h3], addedSeconds: 500 });
  assert.equal(cur.status, 'in_progress');
  assert.equal(cur.currentStageIndex, 2);
  assert.equal(cur.quizRight, 8);
  assert.equal(cur.quizTotal, 10);
  assert.deepEqual(cur.hardCardIds, [h1, h2, h3]);

  const clozeItems = buildLessonClozeItems(cur, pool, new Map(), () => 0.3);
  assert.equal(clozeItems.length, 6);
  assert.deepEqual(clozeItems.slice(0, 3).map(i => i.cardId), [h1, h2, h3], 'hard words lead the consolidation stage');
  assert.ok(clozeItems[0].cloze, 'sentence gap built from card sentence');

  cur = completeLessonStage(cur, 2, { rightCount: 5, totalCount: 6, hardIds: [h2], addedSeconds: 400 });
  assert.equal(cur.status, 'completed');
  assert.equal(cur.clozeRight, 5);
  assert.equal(cur.clozeTotal, 6);
  assert.equal(cur.elapsedSeconds, 1500);
  assert.ok(cur.completedAt);

  // Grouping by day and finding open lessons.
  assert.equal(todayOpenLesson([cur], TODAY), undefined);
  assert.equal(todayOpenLesson([l60, cur], TODAY)?.id, 'les-60');
  const groups = lessonsByDay([cur, { ...l60, day: '2026-11-26' }]);
  assert.deepEqual(groups.map(g => g.day), ['2026-11-27', '2026-11-26']);
});

test('a lesson starts new cards only within the day\'s cap, and leaves grammar cards out', () => {
  const fresh = Array.from({ length: 6 }, (_, i) =>
    makeCard(`n${i}`, `word${i}`, `معنی${i}`, { repetition: 0, interval: 0, stability: undefined, dueDate: NOW.toISOString() }),
  );
  const grammar = makeCard('g', 'past perfect', 'ماضی بعید', { kind: 'grammar' } as Partial<Flashcard>);
  const picked = pickLessonCards([...fresh, grammar], [], 20, 10, NOW, 2);
  assert.deepEqual(picked.map(c => c.id).filter(id => id.startsWith('n')).length, 2);
  assert.ok(!picked.some(c => c.id === 'g'), 'no grammar card');
});

test('a card is rated once per lesson', () => {
  const lesson = createStudyLesson({ durationMinutes: 30, cards: [makeCard('a', 'harbor', 'بندر')], practice: [], today: TODAY, now: NOW })!;
  const rated = withLessonRating(lesson, 'a', 'GOOD', NOW.toISOString());
  assert.equal(rated?.ratings?.a, 'GOOD');
  assert.equal(withLessonRating(rated!, 'a', 'AGAIN'), null, 'a second rating of the same card is refused');
});
