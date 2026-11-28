import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowStamp, takeIncoming } from '../services/syncClient';
import type { Flashcard } from '../types';

const card = (id: string, updatedAt: string, extra: Partial<Flashcard> = {}): Flashcard => ({
  id, deckId: 'd', front: id, back: 'b', createdAt: '2026-11-01T00:00:00Z', repetition: 0, easinessFactor: 2.5,
  interval: 0, dueDate: '2026-11-01T00:00:00Z', updatedAt, ...extra,
});
const stamps = (rows: Flashcard[]) => new Map(rows.map(r => [r.id, rowStamp('cards', r)]));

test('a row the server changed and this browser did not is taken and confirmed', () => {
  const mine = card('a', '2026-11-10T00:00:00Z');
  const theirs = card('a', '2026-11-12T00:00:00Z', { back: 'new' });
  const r = takeIncoming('cards', [theirs], [mine], stamps([mine]), { a: rowStamp('cards', mine) });
  assert.deepEqual(r.write, [theirs]);
  assert.deepEqual(r.confirm, [theirs]);
});

test('a row edited here while the request was out is left for the next round', () => {
  const before = card('a', '2026-11-10T00:00:00Z');
  const now = card('a', '2026-11-13T00:00:00Z');
  const r = takeIncoming('cards', [card('a', '2026-11-12T00:00:00Z')], [now], stamps([before]), { a: rowStamp('cards', before) });
  assert.equal(r.write.length, 0);
  assert.equal(r.skipped, 1);
});

test('a newer local edit not sent yet survives the server copy and stays to be sent', () => {
  // Deleted here (not yet sent: the round was full), reviewed earlier on the phone.
  const deleted = card('a', '2026-11-14T00:00:00Z', { isDeleted: true });
  const phone = card('a', '2026-11-12T00:00:00Z', { repetition: 1 });
  const known = { a: rowStamp('cards', card('a', '2026-11-01T00:00:00Z')) };
  const r = takeIncoming('cards', [phone], [deleted], stamps([deleted]), known);
  assert.equal(r.write.length, 1);
  assert.equal(r.write[0].isDeleted, true, 'the deletion is kept');
  assert.equal(r.confirm.length, 0, 'not confirmed: the next round sends it');
});

test('an older local edit not sent yet gives way to the newer server copy', () => {
  const mine = card('a', '2026-11-11T00:00:00Z', { back: 'mine' });
  const theirs = card('a', '2026-11-12T00:00:00Z', { back: 'theirs' });
  const r = takeIncoming('cards', [theirs], [mine], stamps([mine]), { a: 'old' });
  assert.equal(r.write[0].back, 'theirs');
  assert.equal(r.confirm.length, 1);
});

test('a deletion from the server wins over an older or newer local edit', () => {
  const mine = card('a', '2026-11-15T00:00:00Z', { back: 'mine' });
  const theirs = card('a', '2026-11-12T00:00:00Z', { isDeleted: true });
  const r = takeIncoming('cards', [theirs], [mine], stamps([mine]), { a: 'old' });
  assert.equal(r.write[0].isDeleted, true);
  assert.equal(r.write[0].back, 'mine');
});

test('a row new to this browser is taken', () => {
  const theirs = card('b', '2026-11-12T00:00:00Z');
  const r = takeIncoming('cards', [theirs], [], new Map(), {});
  assert.deepEqual(r.confirm, [theirs]);
});

test('a local row merged with a newer server copy is not confirmed when the merge kept something of its own', () => {
  // Sections 1 and 2 finished here, not sent yet; the server copy is newer and has only section 0.
  const mine = { id: 'c', sourceId: 's', index: 0, title: 't', completed: [0, 1, 2], updatedAt: '2026-11-10T00:00:00Z' } as any;
  const theirs = { id: 'c', sourceId: 's', index: 0, title: 't', completed: [0], updatedAt: '2026-11-12T00:00:00Z' } as any;
  const known = { c: rowStamp('chapters', { ...mine, updatedAt: '2026-11-01T00:00:00Z' }) };
  const r = takeIncoming('chapters', [theirs], [mine], new Map([['c', rowStamp('chapters', mine)]]), known);
  assert.deepEqual(r.write[0].completed, [0, 1, 2], 'finished sections are kept');
  assert.equal(r.confirm.length, 0, 'not confirmed: the next round sends the merged row');
});
