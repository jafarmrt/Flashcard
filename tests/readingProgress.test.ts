import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingSummary, yearGrid } from '../services/readingStats';
import type { Chapter, Occurrence, Source } from '../types';

const src = (id: string, over: Partial<Source> = {}): Source => ({ id, kind: 'book', title: id, deckId: 'd', createdAt: 'x', updatedAt: 'x', ...over });
const ch = (id: string, sourceId: string, chunkCount: number, completed: number[]): Chapter =>
  ({ id, sourceId, order: 1, title: id, chunkCount, wordCount: 900, completed, createdAt: 'x', updatedAt: 'x' });

test('progress is what was read: minutes, books and chapters finished, words met in books', () => {
  const sources = [
    src('a', { reading: { '2026-10-26': { ms: 30 * 60_000, words: 1200, sections: 4 }, '2026-10-27': { ms: 15 * 60_000, words: 600, sections: 2 } } }),
    src('b'),
    src('gone', { isDeleted: true, reading: { '2026-10-27': { ms: 99 * 60_000, words: 1, sections: 1 } } }),
  ];
  const chapters = [ch('a1', 'a', 2, [0, 1]), ch('a2', 'a', 3, [0, 1, 2]), ch('b1', 'b', 3, [0, 1, 2]), ch('b2', 'b', 2, [0])];
  const occ = [{ id: '1', cardId: 'c1', sourceId: 'a' }, { id: '2', cardId: 'c1', sourceId: 'b' }, { id: '3', cardId: 'c2', sourceId: 'b' }, { id: '4', cardId: 'c3', sourceId: 'gone' }] as Occurrence[];
  assert.deepEqual(readingSummary(sources, chapters, occ), { minutes: 45, words: 1800, booksFinished: 1, chaptersFinished: 3, wordsMet: 2 });
});

test('the year as weeks starting on Saturday, ending today', () => {
  const today = new Date(2026, 9, 27); // a Tuesday
  const grid = yearGrid(new Map([['2026-10-27', 20], ['2026-10-24', 5]]), today, 2);
  assert.equal(grid.length, 2);
  const last = grid[1];
  assert.deepEqual(last[0], { day: '2026-10-24', minutes: 5 }, 'Saturday first');
  assert.deepEqual(last[3], { day: '2026-10-27', minutes: 20 });
  assert.equal(last[4], null, 'no days after today');
  assert.equal(grid[0][0]!.day, '2026-10-17');
});
