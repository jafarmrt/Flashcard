import { test } from 'node:test';
import assert from 'node:assert/strict';
import { belongsToAnother, localOwner } from '../services/localOwner';
import { confirmSent, freshSyncState, hasUnsentChanges, LocalData, markAllSynced, nextOutgoing } from '../services/syncClient';
import type { Flashcard } from '../types';

const card = (over: Partial<Flashcard> = {}): Flashcard => ({
  id: 'c1', deckId: 'default', front: 'decide', back: 'تصمیم گرفتن', createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z', dueDate: '2026-10-02T00:00:00Z', repetition: 0, easinessFactor: 2.5, interval: 0,
  ...over,
} as Flashcard);

const local = (over: Partial<LocalData> = {}): LocalData => ({
  decks: [{ id: 'default', name: 'Default Deck' }], cards: [], sources: [], chapters: [], occurrences: [],
  knownWords: [], speechAttempts: [], logs: [], achievements: [], ...over,
});

test('the owner is the recorded account, else the one the data last synced with', () => {
  assert.equal(localOwner('ann', { user: 'bob' }), 'ann');
  assert.equal(localOwner(undefined, { user: 'bob' }), 'bob');
  assert.equal(localOwner(undefined, undefined), undefined, 'made before signing in');
  assert.equal(localOwner('', null), undefined);
});

test("another account's data is cleared; the same account in other letters, or nobody's, is kept", () => {
  assert.equal(belongsToAnother('ann', 'bob'), true);
  assert.equal(belongsToAnother('Ann', 'ann'), false);
  assert.equal(belongsToAnother(undefined, 'ann'), false);
});

test('unsent changes: an edit after the last sync counts, a synced browser has none', () => {
  const data = local({ cards: [card()] });
  const synced = markAllSynced(freshSyncState('ann'), data);
  assert.equal(hasUnsentChanges(data, synced), false);

  const edited = local({ cards: [card({ back: 'تصمیم', updatedAt: '2026-10-03T00:00:00Z' })] });
  assert.equal(hasUnsentChanges(edited, synced), true);
  assert.equal(hasUnsentChanges(edited, confirmSent(synced, nextOutgoing(edited, synced))), false, 'confirmed by the server');

  const withLog = local({ cards: [card()], logs: [{ id: 99, cardId: 'c1', date: '2026-10-03', rating: 3 } as any] });
  assert.equal(hasUnsentChanges(withLog, synced), true, 'a review not sent yet');
});

test('a browser that never synced: only its own cards, texts and reviews count, not the default deck', () => {
  assert.equal(hasUnsentChanges(local(), undefined), false);
  assert.equal(hasUnsentChanges(local({ cards: [card()] }), undefined), true);
});
