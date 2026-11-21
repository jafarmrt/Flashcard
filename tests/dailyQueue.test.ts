import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comeBackAt, dailyQueue, newCardsStartedToday } from '../services/dailyQueue';
import { answerCard, calculateSrs, previewIntervals } from '../services/srsService';
import { meaningMatches } from '../services/stringSimilarity';
import type { Flashcard, StudyLog } from '../types';

const NOW = new Date('2026-11-21T10:00:00');
const TODAY = '2026-11-21';
const DAY = 24 * 60 * 60 * 1000;

const card = (id: string, extra: Partial<Flashcard> = {}): Flashcard => ({
  id, deckId: 'd', front: id, back: 'معنی', createdAt: new Date(NOW.getTime() - DAY).toISOString(),
  repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: NOW.toISOString(), ...extra,
});
const learned = (id: string, dueInDays: number): Flashcard =>
  ({ ...calculateSrs(card(id), 'GOOD', new Date(NOW.getTime() - 3 * DAY)), dueDate: new Date(NOW.getTime() + dueInDays * DAY).toISOString() });
const log = (cardId: string, date: string): StudyLog => ({ cardId, date, rating: 'GOOD' });

test('new cards started today are those first reviewed today', () => {
  const logs = [log('a', '2026-11-20'), log('a', TODAY), log('b', TODAY), log('b', TODAY), log('c', TODAY)];
  assert.equal(newCardsStartedToday(logs, TODAY), 2);
});

test("today's queue: cards being learned first, then new cards up to the day's allowance, the oldest first", () => {
  const reviews = [learned('r1', 0), learned('r2', -2)];
  const fresh = Array.from({ length: 6 }, (_, i) => card(`n${i}`, { createdAt: new Date(NOW.getTime() - (10 - i) * DAY).toISOString() }));
  const later = learned('later', 5);
  const q = dailyQueue([...fresh, ...reviews, later], [], TODAY, 4, NOW, () => 0);
  assert.deepEqual(q.cards.slice(2).map(c => c.id), ['n0', 'n1', 'n2', 'n3']);
  assert.deepEqual(new Set(q.cards.slice(0, 2).map(c => c.id)), new Set(['r1', 'r2']));
  assert.equal(q.reviews, 2);
  assert.equal(q.fresh, 4);
  assert.equal(q.heldBack, 2);
});

test('new cards already started today count against the allowance; 0 means no cap', () => {
  const fresh = Array.from({ length: 5 }, (_, i) => card(`n${i}`));
  const logs = [log('old1', TODAY), log('old2', TODAY), log('old3', TODAY)];
  assert.equal(dailyQueue(fresh, logs, TODAY, 4, NOW).fresh, 1);
  assert.equal(dailyQueue(fresh, logs, TODAY, 2, NOW).fresh, 0);
  assert.equal(dailyQueue(fresh, logs, TODAY, 0, NOW).fresh, 5);
  assert.equal(dailyQueue([card('x', { isDeleted: true })], [], TODAY, 0, NOW).cards.length, 0);
});

test('a card comes back after ten other cards, or at the end of a short queue', () => {
  assert.equal(comeBackAt(0, 30), 11);
  assert.equal(comeBackAt(5, 8), 8);
});

test('an answer to a card not due yet: forgetting counts, knowing it keeps the schedule', () => {
  const early = learned('e', 6);
  assert.equal(answerCard(early, 'GOOD', NOW), early);
  assert.equal(answerCard(early, 'EASY', NOW), early);
  assert.equal(answerCard(early, 'AGAIN', NOW).interval, 0);
  assert.equal(previewIntervals(early, NOW).GOOD, early.interval);
  const due = learned('d', 0);
  assert.notEqual(answerCard(due, 'GOOD', NOW).dueDate, due.dueDate, 'a due card is scheduled as before');
});

test('a typed meaning is right when it is one of the meanings on the card', () => {
  assert.ok(meaningMatches('قصد کردن', 'تصمیم گرفتن، قصد کردن'));
  assert.ok(meaningMatches('تصميم گرفتن', 'تصمیم گرفتن، قصد کردن'), 'Arabic yeh is the Persian one');
  assert.ok(meaningMatches('میخواهم', 'می‌خواهم'), 'with or without the half space');
  assert.ok(meaningMatches('کاهش یافتن', 'کاهش یافتن'));
  assert.ok(meaningMatches('کاهش یافتم', 'کاهش یافتن'), 'a small typo');
  assert.ok(!meaningMatches('افزایش', 'کاهش یافتن؛ فروکش کردن'));
  assert.ok(!meaningMatches('', 'کاهش'));
  assert.ok(meaningMatches('فروکش کردن', 'کاهش یافتن؛ فروکش کردن'));
});
