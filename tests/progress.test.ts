import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masteryStage, stageCounts, stageChanges } from '../services/masteryService';
import { computeStreak, daysToFreeze, weekStrip, weeklyReviewCounts, availableFreezes, addDays } from '../services/streakService';
import { reviewXp, nextCombo, comboBonus, isChestSection } from '../services/xpRules';
import type { Flashcard } from '../types';

const card = (over: Partial<Flashcard> = {}): Flashcard => ({
  id: 'c', deckId: 'd', front: 'abate', back: 'کاهش', createdAt: '2026-10-01T00:00:00Z',
  repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: '2026-10-01T00:00:00Z', ...over,
});

test('mastery stage follows FSRS stability, with SM-2 interval as fallback', () => {
  assert.equal(masteryStage(card()), 0);
  assert.equal(masteryStage(card({ repetition: 1, interval: 1, stability: 1.2 })), 1);
  assert.equal(masteryStage(card({ repetition: 2, interval: 6, stability: 6 })), 2);
  assert.equal(masteryStage(card({ repetition: 3, interval: 20, stability: 20 })), 3);
  assert.equal(masteryStage(card({ repetition: 5, interval: 90, stability: 90 })), 4);
  assert.equal(masteryStage(card({ repetition: 4, interval: 45 })), 4); // old SM-2 card
});

test('stage counts skip deleted cards and stage changes list only promotions', () => {
  const a = card({ id: 'a' });
  const b = card({ id: 'b', repetition: 2, interval: 6, stability: 6 });
  const deleted = card({ id: 'x', isDeleted: true });
  assert.deepEqual(stageCounts([a, b, deleted]), { 0: 1, 1: 0, 2: 1, 3: 0, 4: 0 });
  const after = [card({ id: 'a', repetition: 1, interval: 3, stability: 3.1 }), card({ id: 'b', repetition: 3, interval: 2, stability: 2 })];
  const changes = stageChanges([a, b], after);
  assert.equal(changes.length, 1);
  assert.deepEqual([changes[0].card.id, changes[0].from, changes[0].to], ['a', 0, 2]);
});

const set = (...d: string[]) => new Set(d);
const TODAY = '2026-10-08';

test('streak counts studied days ending today or yesterday; frozen days bridge without counting', () => {
  assert.equal(computeStreak(set('2026-10-06', '2026-10-07', TODAY), set(), TODAY), 3);
  assert.equal(computeStreak(set('2026-10-06', '2026-10-07'), set(), TODAY), 2);
  assert.equal(computeStreak(set('2026-10-05', '2026-10-06'), set(), TODAY), 0);
  assert.equal(computeStreak(set('2026-10-05', '2026-10-07'), set('2026-10-06'), TODAY), 2);
});

test('freezes cover a short gap when enough are held, never a broken streak', () => {
  const studied = set('2026-10-04', '2026-10-05');
  assert.deepEqual(daysToFreeze(studied, set(), 2, TODAY), ['2026-10-06', '2026-10-07']);
  assert.deepEqual(daysToFreeze(studied, set(), 1, TODAY), []); // gap of 2, only 1 freeze
  assert.deepEqual(daysToFreeze(set('2026-10-07'), set(), 2, TODAY), []); // nothing missed
  assert.deepEqual(daysToFreeze(set(), set(), 2, TODAY), []); // no streak at all
  const frozenAfter = set('2026-10-06', '2026-10-07');
  assert.equal(computeStreak(studied, frozenAfter, TODAY), 2);
  assert.equal(availableFreezes(3, ['2026-10-06', '2026-10-07']), 1);
});

test('week strip runs Saturday to Friday and marks each day', () => {
  // 2026-10-08 is a Thursday, so the week starts on Saturday 2026-10-03.
  const strip = weekStrip(set('2026-10-03', '2026-10-05'), set('2026-10-06'), TODAY);
  assert.equal(strip[0].day, '2026-10-03');
  assert.deepEqual(strip.map(s => s.status), ['studied', 'missed', 'studied', 'frozen', 'missed', 'today', 'future']);
});

test('weekly review counts compare the last 7 days with the 7 before', () => {
  const logs = [TODAY, TODAY, addDays(TODAY, -6), addDays(TODAY, -7), addDays(TODAY, -13), addDays(TODAY, -14)];
  assert.deepEqual(weeklyReviewCounts(logs, TODAY), { thisWeek: 3, lastWeek: 2 });
});

test('review XP rewards correct answers and grows with a combo', () => {
  assert.equal(reviewXp('AGAIN', 9), 1);
  assert.equal(reviewXp('GOOD', 0), 6);
  assert.equal(reviewXp('GOOD', 4), 7); // 5th in a row
  assert.equal(comboBonus(40), 3);
  assert.equal(nextCombo('AGAIN', 7), 0);
  assert.equal(nextCombo('HARD', 7), 8);
  assert.deepEqual([0, 1, 2, 5].map(isChestSection), [false, false, true, true]);
});
