import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSrs, previewIntervals, memoryState, intervalForStability, retrievability, formatInterval } from '../services/srsService';
import type { Flashcard } from '../types';

const NOW = new Date('2026-10-08T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const newCard = (): Flashcard => ({
  id: 'c1', deckId: 'd1', front: 'abate', back: 'کاهش یافتن', createdAt: NOW.toISOString(),
  repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: NOW.toISOString(),
});

const days = (card: Flashcard) => card.interval;

test('a new card gets the FSRS starting intervals, longer for easier answers', () => {
  const p = previewIntervals(newCard(), NOW);
  assert.deepEqual(p, { AGAIN: 1, HARD: 1, GOOD: 3, EASY: 16 });
  const good = calculateSrs(newCard(), 'GOOD', NOW);
  assert.ok(good.stability! > 3 && good.stability! < 3.3);
  assert.ok(good.difficulty! >= 1 && good.difficulty! <= 10);
  assert.equal(good.repetition, 1);
  assert.equal(good.lastReviewed, NOW.toISOString());
});

test('reviewing on time with Good grows the interval; Hard grows it less', () => {
  const first = calculateSrs(newCard(), 'GOOD', NOW);
  const due = new Date(NOW.getTime() + first.interval * DAY);
  const good = calculateSrs(first, 'GOOD', due);
  const hard = calculateSrs(first, 'HARD', due);
  const easy = calculateSrs(first, 'EASY', due);
  assert.ok(days(good) > first.interval, `${days(good)} > ${first.interval}`);
  assert.ok(days(hard) < days(good));
  assert.ok(days(easy) > days(good));
  assert.ok(hard.difficulty! > good.difficulty! && easy.difficulty! < good.difficulty!);
});

test('forgetting a learned card lowers stability, counts a lapse and resets repetition', () => {
  let card = calculateSrs(newCard(), 'GOOD', NOW);
  let t = NOW.getTime();
  for (let i = 0; i < 3; i++) {
    t += card.interval * DAY;
    card = calculateSrs(card, 'GOOD', new Date(t));
  }
  t += card.interval * DAY;
  const forgot = calculateSrs(card, 'AGAIN', new Date(t));
  assert.ok(forgot.stability! < card.stability!);
  assert.equal(forgot.lapses, 1);
  assert.equal(forgot.repetition, 0);
  assert.ok(forgot.interval >= 1);
});

test('a same-day repeat after Again uses the short-term rule and stays small', () => {
  const again = calculateSrs(newCard(), 'AGAIN', NOW);
  const later = new Date(NOW.getTime() + 10 * 60 * 1000);
  const good = calculateSrs(again, 'GOOD', later);
  assert.ok(good.stability! > again.stability!);
  assert.ok(good.interval <= 2);
});

test('old SM-2 cards are converted from interval and easiness', () => {
  const old: Flashcard = { ...newCard(), repetition: 4, interval: 20, easinessFactor: 2.5, dueDate: NOW.toISOString() };
  const state = memoryState(old)!;
  assert.equal(state.stability, 20);
  assert.ok(state.difficulty > 3 && state.difficulty < 4.5);
  assert.equal(state.lastReviewed, NOW.getTime() - 20 * DAY);
  const next = calculateSrs(old, 'GOOD', NOW);
  assert.ok(next.interval > 20, `${next.interval}`);
  assert.equal(memoryState(newCard()), null);
});

test('at the 90% target the interval equals stability, and retrievability is 0.9 then', () => {
  assert.equal(intervalForStability(10), 10);
  assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-9);
  assert.equal(intervalForStability(0.01), 1);
});

test('due dates fall on local midnight', () => {
  const card = calculateSrs(newCard(), 'GOOD', NOW);
  const due = new Date(card.dueDate);
  assert.equal(due.getHours() + due.getMinutes() + due.getSeconds(), 0);
});

test('intervals are labelled compactly', () => {
  assert.equal(formatInterval(3), '3d');
  assert.equal(formatInterval(60), '2mo');
  assert.equal(formatInterval(365), '1y');
  assert.equal(formatInterval(548), '1.5y');
});
