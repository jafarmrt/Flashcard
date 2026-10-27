import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActiveClock, addReading, IDLE_MS, lastDays, mergeReading, minutesFor, readingByDay, totalOf, wordsPerMinute } from '../services/readingTime';
import { mergeRow } from '../server/syncStore';
import type { Source } from '../types';

const source = (over: Partial<Source> = {}): Source => ({ id: 's', kind: 'book', title: 'B', deckId: 'd', createdAt: 'x', updatedAt: '2026-10-01T00:00:00Z', ...over });

test('only active time counts: a hidden page or a reader idle for long adds nothing', () => {
  const c = new ActiveClock(0);
  c.tick(5_000, true);
  c.tick(10_000, true);
  assert.equal(c.take(10_000), 10_000);
  c.tick(15_000, false); // page hidden
  assert.equal(c.take(15_000, false), 0);
  c.touch(20_000); // back in view: the 5 s since the page showed again count
  c.tick(20_000 + IDLE_MS + 60_000, true); // then left on the table
  assert.equal(c.take(20_000 + IDLE_MS + 60_000), 5_000);
  c.touch(300_000);
  c.tick(330_000, true);
  assert.equal(c.take(330_000), 30_000);
});

test("a book's log adds up per day, and two devices' logs merge without losing minutes", () => {
  let s = addReading(source(), '2026-10-27', 6 * 60_000, 300);
  s = addReading(s, '2026-10-27', 2 * 60_000, 0, 0);
  s = addReading(s, '2026-10-28', 99 * 60_000, 280); // a forgotten tab is capped
  assert.deepEqual(s.reading!['2026-10-27'], { ms: 8 * 60_000, words: 300, sections: 1 });
  assert.equal(s.reading!['2026-10-28'].ms, 45 * 60_000);
  assert.deepEqual(totalOf(s.reading), { ms: 53 * 60_000, words: 580, sections: 2 });

  const other = { '2026-10-27': { ms: 1, words: 1, sections: 1 }, '2026-10-26': { ms: 60_000, words: 100, sections: 1 } };
  const merged = mergeReading(s.reading, other)!;
  assert.equal(merged['2026-10-27'].ms, 8 * 60_000);
  assert.equal(merged['2026-10-26'].words, 100);
  const row = mergeRow('sources', { ...s, updatedAt: '2026-10-29T00:00:00Z' } as any, { ...source({ reading: other }), updatedAt: '2026-10-30T00:00:00Z' } as any);
  assert.equal(row.reading['2026-10-28'].words, 280, 'the newer edit does not drop the older device\'s days');
});

test('pace, time left, and days across books', () => {
  assert.equal(wordsPerMinute({ ms: 60_000, words: 500, sections: 1 }), null, 'too little to measure');
  assert.equal(wordsPerMinute({ ms: 10 * 60_000, words: 1500, sections: 5 }), 150);
  assert.equal(minutesFor(1200, null), 10);
  assert.equal(minutesFor(1200, 150), 8);
  const days = readingByDay([source({ reading: { a: { ms: 1, words: 2, sections: 1 } } }), source({ reading: { a: { ms: 3, words: 4, sections: 1 } } })]);
  assert.deepEqual(days.get('a'), { ms: 4, words: 6, sections: 2 });
  assert.deepEqual(lastDays(3, new Date(2026, 0, 2)), ['2025-12-31', '2026-01-01', '2026-01-02']);
});
