import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearErrors, errorReport, MAX_ENTRIES, readErrors, recordError, withError, type KeyValueStore } from '../services/errorLog';

const memory = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};
const T = (s: number) => new Date(Date.UTC(2026, 10, 28, 10, 0, s));

test('errors are kept newest first, a repeat in a row is counted, and the list is capped', () => {
  const store = memory();
  recordError(store, 'console', new TypeError('Failed to fetch'), '7.26.0', T(1));
  recordError(store, 'console', new TypeError('Failed to fetch'), '7.26.0', T(2));
  recordError(store, 'promise', 'quota exceeded', '7.26.0', T(3));
  const list = readErrors(store);
  assert.equal(list.length, 2);
  assert.equal(list[0].message, 'quota exceeded');
  assert.equal(list[1].message, 'TypeError: Failed to fetch');
  assert.equal(list[1].count, 2);
  assert.equal(list[1].at, T(2).toISOString());

  let many = list;
  for (let i = 0; i < MAX_ENTRIES + 20; i++) many = withError(many, { where: 'console', message: `e${i}` });
  assert.equal(many.length, MAX_ENTRIES);
  assert.equal(many[0].message, `e${MAX_ENTRIES + 19}`);

  clearErrors(store);
  assert.deepEqual(readErrors(store), []);
});

test('a broken or blocked store never throws, and the report reads as plain text', () => {
  const broken: KeyValueStore = { getItem: () => '{not json', setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(readErrors(broken), []);
  assert.doesNotThrow(() => recordError(broken, 'window', new Error('x')));
  assert.doesNotThrow(() => clearErrors(broken));

  const list = withError(withError([], { where: 'console', message: 'Sync failed: TypeError: Failed to fetch', stack: 'TypeError: Failed to fetch\n at a\n at b', version: '7.25.0' }, T(1)), { where: 'promise', message: 'boom' }, T(2));
  const report = errorReport(list, { version: '7.26.0', userAgent: 'TestPhone', now: T(3) });
  assert.match(report, /^Lingua Cards 7\.26\.0/);
  assert.match(report, /Browser: TestPhone/);
  assert.match(report, /\(console, in 7\.25\.0\) Sync failed: TypeError: Failed to fetch/);
  assert.match(report, /\n {4}at a/);
});
