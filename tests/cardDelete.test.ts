import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardsToDelete, deletionPreview, markDeleted } from '../services/cardDelete';
import type { Flashcard } from '../types';

const card = (id: string, front = id, over: Partial<Flashcard> = {}): Flashcard => ({
  id, front, back: '', deckId: 'd', repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: '', createdAt: '', ...over,
} as Flashcard);

test('only live cards that were asked for are deleted, each once', () => {
  const cards = [card('a'), card('b', 'b', { isDeleted: true }), card('c')];
  assert.deepEqual(cardsToDelete(cards, ['c', 'b', 'x', 'c', 'a']).map(c => c.id), ['a', 'c']);
  assert.deepEqual(cardsToDelete(cards, []), []);
});

test('a deleted card keeps its content and gets a new time, so the sync carries it', () => {
  const [row] = markDeleted([card('a', 'apple', { back: 'سیب', updatedAt: '2026-01-01T00:00:00Z' })], '2026-10-31T10:00:00Z');
  assert.equal(row.isDeleted, true);
  assert.equal(row.updatedAt, '2026-10-31T10:00:00Z');
  assert.equal(row.back, 'سیب');
});

test('the confirmation names a few words and counts the rest', () => {
  const many = ['one', 'two', ' three ', 'four'].map(w => card(w, w));
  assert.deepEqual(deletionPreview(many, 3), { words: ['one', 'two', 'three'], more: 1 });
  assert.deepEqual(deletionPreview(many.slice(0, 1)), { words: ['one'], more: 0 });
  assert.deepEqual(deletionPreview([card('x', '  ')]), { words: ['—'], more: 0 });
});
