import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekSummary } from '../services/weekSummary';
import type { Flashcard, Source } from '../types';

const NOW = new Date('2026-11-21T10:00:00');
const MIN = 60_000;
const source = (reading: Source['reading']): Source => ({ id: 's', kind: 'book', title: 'B', deckId: 'd', createdAt: '', updatedAt: '', reading } as Source);
const card = (id: string, createdAt: string): Flashcard => ({ id, deckId: 'd', front: id, back: 'م', createdAt, repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: createdAt });

test("the week's numbers, next to the week before", () => {
  const s = weekSummary({
    sources: [source({
      '2026-11-20': { ms: 30 * MIN, words: 3000, sections: 3 },
      '2026-11-15': { ms: 10 * MIN, words: 900, sections: 1 },
      '2026-11-12': { ms: 20 * MIN, words: 2000, sections: 2 }, // the week before
    })],
    cards: [card('a', '2026-11-19T09:00:00'), card('b', '2026-11-01T09:00:00')],
    logs: [{ cardId: 'b', date: '2026-11-02', rating: 'GOOD' }, { cardId: 'b', date: '2026-11-20', rating: 'GOOD' }, { cardId: 'a', date: '2026-11-19', rating: 'AGAIN' }],
    knownWords: [{ id: 'k', term: 'the', createdAt: '2026-11-18T08:00:00', updatedAt: '' }],
  }, NOW);
  assert.equal(s.minutes, 40);
  assert.equal(s.previousMinutes, 20);
  assert.equal(s.sections, 4);
  assert.equal(s.words, 3900);
  assert.equal(s.newCards, 1);
  assert.equal(s.knownAdded, 1);
  assert.equal(s.reviews, 2);
  assert.equal(s.remembered, 100);
  assert.match(s.advice, /بیشتر خواندی/);
});

test('an empty week says where to start', () => {
  const s = weekSummary({ sources: [], cards: [], logs: [], knownWords: [] }, NOW);
  assert.equal(s.minutes, 0);
  assert.equal(s.remembered, null);
  assert.match(s.advice, /یک بخش کوتاه/);
});
