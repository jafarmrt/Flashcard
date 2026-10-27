import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutesLeft, SECTION_MINUTES, todayPlan } from '../services/todayPlan';

const base = { hasBook: true, readToday: false, dueCards: 0, reviewedToday: 0, dueSpeech: 0, speechToday: 0 };

test('reading comes first, then the due cards, then pronunciation', () => {
  const plan = todayPlan({ ...base, dueCards: 30, dueSpeech: 9 });
  assert.deepEqual(plan.map(s => s.id), ['read', 'review', 'speak']);
  assert.equal(plan[1].minutes, 4); // 30 cards × 8 s
  assert.equal(plan[2].count, 6, 'one session of sentences, not all of them');
  assert.equal(minutesLeft(plan), SECTION_MINUTES + 4 + 6);
});

test('steps done today stay on the list, ticked; nothing to do means no step', () => {
  const plan = todayPlan({ ...base, readToday: true, reviewedToday: 12 });
  assert.deepEqual(plan.map(s => [s.id, s.done]), [['read', true], ['review', true]]);
  assert.equal(minutesLeft(plan), 0);
  assert.deepEqual(todayPlan({ ...base, hasBook: false }), []);
});
