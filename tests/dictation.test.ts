import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDictation, pickDictation } from '../services/dictation';
import { calculateSrs } from '../services/srsService';
import type { Flashcard, Occurrence } from '../types';

const NOW = new Date('2026-11-21T10:00:00');
const card = (id: string, front: string, extra: Partial<Flashcard> = {}): Flashcard => ({
  id, deckId: 'd', front, back: 'معنی', createdAt: NOW.toISOString(), repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: NOW.toISOString(), ...extra,
});
const learning = (id: string, front: string) => calculateSrs(card(id, front), 'GOOD', new Date(NOW.getTime() - 4 * 86_400_000));
const met = (cardId: string, sentence: string): Occurrence => ({ id: `o-${cardId}`, cardId, sourceId: 's', chapterId: 'c', chunk: 0, sentence, createdAt: '', updatedAt: '2026-11-01' } as Occurrence);

test('listening takes words being learned, each in a book sentence of a fair length', () => {
  const cards = [learning('a', 'harbor'), learning('b', 'pier'), card('n', 'gull'), learning('c', 'tide')];
  const occ = [
    met('a', 'He walked slowly to the harbor every morning.'),
    met('b', 'The pier.'), // too short
    met('n', 'A gull cried above the grey water all day.'), // a new card
  ];
  const items = pickDictation(cards, occ, 6, () => 0);
  assert.deepEqual(items.map(i => i.cardId), ['a']);
  assert.equal(items[0].sentence, 'He walked slowly to the harbor every morning.');
});

test('a written sentence is checked word by word; the card word is checked apart', () => {
  const item = { sentence: 'He walked slowly to the harbor every morning.', front: 'harbor' };
  const right = checkDictation(item, 'he walked slowly to the harbor every morning');
  assert.equal(right.score, 100);
  assert.ok(right.focusOk);
  const close = checkDictation(item, 'He walk slowly to the harbour every morning');
  assert.ok(close.score >= 70 && close.score < 100);
  assert.ok(close.focusOk, '"harbour" is near enough');
  const missed = checkDictation(item, 'He walked slowly to the every morning');
  assert.equal(missed.focusOk, false);
  assert.equal(missed.words.find(w => w.i === 5)?.status, 'missed');
  assert.equal(checkDictation(item, 'banana').score, 0);
});
