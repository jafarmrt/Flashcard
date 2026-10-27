import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardForTerm, indexCards } from '../services/cardLookup';
import type { Flashcard } from '../types';

const card = (id: string, front: string, over: Partial<Flashcard> = {}): Flashcard => ({
  id, deckId: 'd', front, back: `meaning of ${front}`, repetition: 0, easinessFactor: 2.5, interval: 0,
  dueDate: '2026-10-27T00:00:00Z', createdAt: '2026-10-27T00:00:00Z', ...over,
} as Flashcard);

const index = indexCards([
  card('1', 'decide'),
  card('2', 'To Take Into Account'),
  card('3', 'present perfect', { kind: 'grammar' }),
  card('4', 'gone', { isDeleted: true }),
  card('5', 'run'),
]);

test('a word in the text finds its card as written or through a base form', () => {
  assert.equal(cardForTerm(index, 'decide')?.id, '1');
  assert.equal(cardForTerm(index, 'Decided,')?.id, '1');
  assert.equal(cardForTerm(index, 'running')?.id, '5');
  assert.equal(cardForTerm(index, 'apple'), undefined);
});

test('a phrase is matched whole, and grammar or deleted cards are not words', () => {
  assert.equal(cardForTerm(index, 'take into account')?.id, '2');
  assert.equal(cardForTerm(index, 'take into'), undefined);
  assert.equal(cardForTerm(index, 'present perfect'), undefined);
  assert.equal(cardForTerm(index, 'gone'), undefined);
  assert.equal(cardForTerm(index, ''), undefined);
});
