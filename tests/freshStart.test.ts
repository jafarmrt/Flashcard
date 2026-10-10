import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
const { startFresh, DATA_EPOCH } = await import('../services/freshStart');

test('a browser from before the epoch deletes its database once', async () => {
  store.clear();
  let deletes = 0;
  assert.equal(await startFresh(async () => { deletes++; }), true);
  assert.equal(store.get('dataEpoch'), DATA_EPOCH);
  assert.equal(await startFresh(async () => { deletes++; }), false);
  assert.equal(deletes, 1);
});

test('a failed or stuck delete is tried again at the next start', async () => {
  store.clear();
  assert.equal(await startFresh(async () => { throw new Error('blocked'); }), false);
  assert.equal(store.get('dataEpoch'), undefined);
  assert.equal(await startFresh(() => new Promise<void>(() => {}), 20), false);
  assert.equal(store.get('dataEpoch'), undefined);
  assert.equal(await startFresh(async () => {}), true);
});
