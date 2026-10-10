import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { handleProxy, ProxyResponse } from '../server/api';
import { createSessionToken } from '../server/auth';
import { openKeys, sealKeys } from '../server/keyVault';
import { applyServerKeys, cleanSentKeys, localKeyEntries, markKeyChanges, mergeKeyEntries, withoutKeys } from '../services/keySync';
import { providerKey } from '../services/aiSettings';
import { dictionaryKey } from '../services/dictSettings';
import { toSyncedSettings } from '../services/settingsSync';
import type { Settings } from '../types';

const SECRET = 's'.repeat(40);

test('keys are sealed with the server secret and open only with it, for their own account', () => {
  const entries = { 'ai:groq': { v: 'gsk_123', at: 5 } };
  const sealed = sealKeys(entries, 'jafar', SECRET);
  assert.ok(!JSON.stringify(sealed).includes('gsk_123'), 'the key is not readable in the record');
  assert.deepEqual(openKeys(sealed, 'Jafar', SECRET), entries);
  assert.equal(openKeys(sealed, 'jafar', 'x'.repeat(40)), null, 'another secret opens nothing');
  assert.equal(openKeys(sealed, 'someone', SECRET), null, 'another account opens nothing');
  assert.equal(openKeys({ ...sealed, data: sealed.data.slice(2) }, 'jafar', SECRET), null, 'a damaged record opens nothing');
  assert.deepEqual(openKeys(null, 'jafar', SECRET), {}, 'no record yet');
});

test('a key typed or removed on this device is marked as changed; other settings are not', () => {
  const before: Partial<Settings> = { aiKeys: { groq: 'a' }, dictKeys: { 'mw-learners': 'm' } };
  assert.equal(markKeyChanges(before, { ...before, theme: 'dark' }), undefined);
  assert.deepEqual(markKeyChanges(before, { ...before, aiKeys: { groq: 'b' } }), ['ai:groq']);
  assert.deepEqual(markKeyChanges({ ...before, keysChanged: ['ai:groq'] }, { ...before, keysChanged: ['ai:groq'], dictKeys: {} }), ['ai:groq', 'dict:mw-learners']);
  // The key from before the list moving into aiKeys is not a change.
  const legacy: Partial<Settings> = { aiProvider: 'openai-compatible', aiBaseUrl: 'https://api.groq.com/openai/v1', customApiKey: 'k' };
  assert.equal(markKeyChanges(legacy, { ...legacy, customApiKey: undefined, aiKeys: { groq: 'k' } }), undefined);
});

test('a device sends its keys, and the ones it changed or removed as changed', () => {
  const s: Partial<Settings> = { aiKeys: { openrouter: 'or' }, dictKeys: { mymemory: 'me@x' }, keysChanged: ['ai:openrouter', 'ai:groq'] };
  assert.deepEqual(localKeyEntries(s), {
    'ai:openrouter': { v: 'or', changed: true }, 'ai:groq': { v: '', changed: true }, 'dict:mymemory': { v: 'me@x' },
  });
});

test('the server takes changes in the order they arrive, whatever the device clock', () => {
  const stored = { 'ai:groq': { v: 'old', at: 5000 }, 'ai:gemini': { v: 'g', at: 10 } };
  const { merged, changed } = mergeKeyEntries(stored, {
    'ai:groq': { v: 'new', changed: true }, // typed on a device whose clock is behind
    'ai:gemini': { v: 'other' }, // an old key not changed there: the server's copy stays
    'ai:deepseek': { v: '', changed: true }, // removing a key the server never had
    'dict:mw-learners': { v: 'mw' }, // an old key the server does not have yet
  }, 1000);
  assert.equal(changed, true);
  assert.deepEqual(merged, { 'ai:groq': { v: 'new', at: 5001 }, 'ai:gemini': { v: 'g', at: 10 }, 'dict:mw-learners': { v: 'mw', at: 1000 } });
  assert.equal(mergeKeyEntries(merged, { 'ai:groq': { v: 'stale' } }, 9000).changed, false);
  assert.equal(mergeKeyEntries(merged, { 'ai:groq': { v: 'new', changed: true } }, 9000).changed, false, 'the same value again');
  // Removing a key is kept as an empty value, so the removal reaches other devices.
  assert.deepEqual(mergeKeyEntries(merged, { 'ai:groq': { v: '', changed: true } }, 9000).merged['ai:groq'], { v: '', at: 9000 });
});

test('keys from a device are checked: known ids, strings, sane length', () => {
  assert.deepEqual(cleanSentKeys({
    'ai:groq': { v: ' k ', changed: true }, 'ai:nope': { v: 'x' }, 'dict:mymemory': { v: 3 },
    'ai:openrouter': { v: 'y'.repeat(501) }, 'ai:deepseek': { v: 'd', changed: 'yes' },
  }), { 'ai:groq': { v: 'k', changed: true }, 'ai:deepseek': { v: 'd' } });
  assert.deepEqual(cleanSentKeys('nonsense'), {});
});

test('a device takes the account\'s keys, but keeps one typed while the request was out', () => {
  const local: Partial<Settings> = {
    aiProvider: 'openai-compatible', aiBaseUrl: 'https://api.groq.com/openai/v1', customApiKey: 'legacy',
    dictKeys: { mymemory: 'me@x', 'mw-collegiate': 'c2' }, keysChanged: ['dict:mymemory', 'dict:mw-collegiate'],
  };
  const sent = { 'ai:groq': { v: 'legacy' }, 'dict:mymemory': { v: 'me@x', changed: true }, 'dict:mw-collegiate': { v: 'c1', changed: true } };
  const change = applyServerKeys(local, sent, {
    'ai:groq': { v: '', at: 20 }, 'ai:openrouter': { v: 'or', at: 30 }, 'dict:mymemory': { v: 'me@x', at: 40 },
    'dict:mw-collegiate': { v: 'c1', at: 41 }, 'dict:mw-learners': { v: 'mw', at: 1 },
  })!;
  const after = { ...local, ...change };
  assert.equal(providerKey(after, 'groq'), undefined, 'removed on another device, and the old key does not come back');
  assert.equal(providerKey(after, 'openrouter'), 'or');
  assert.equal(dictionaryKey(after, 'mymemory'), 'me@x');
  assert.equal(dictionaryKey(after, 'mw-collegiate'), 'c2', 'typed again here after it was sent');
  assert.equal(dictionaryKey(after, 'mw-learners'), 'mw');
  assert.deepEqual(after.keysChanged, ['dict:mw-collegiate'], 'still to be sent');
  assert.equal(applyServerKeys(after, {}, { 'ai:openrouter': { v: 'or', at: 30 } }), null, 'nothing new');
  assert.equal(applyServerKeys(after, {}, undefined), null);
  // A key the server refused (too long) stays marked as changed here.
  const long: Partial<Settings> = { aiKeys: { groq: 'x'.repeat(600) }, keysChanged: ['ai:groq'] };
  const refused = applyServerKeys(long, { 'ai:groq': { v: 'x'.repeat(600), changed: true } }, { 'ai:groq': { v: 'old', at: 1 } });
  assert.equal(refused, null);
});

test('keys never ride in the synced settings, and leave the browser on sign-out', () => {
  const s: Partial<Settings> = { theme: 'dark', aiKeys: { groq: 'k' }, dictKeys: { mymemory: 'm' }, customApiKey: 'c', keysChanged: ['ai:groq'] };
  assert.deepEqual(toSyncedSettings(s), { theme: 'dark' });
  assert.deepEqual(withoutKeys(s), { theme: 'dark' });
});

// --- Through the API, as two devices would ---

const call = async (body: object, user?: string) => {
  const out: { status: number; body: any; headers: Record<string, unknown> } = { status: 0, body: null, headers: {} };
  const res: ProxyResponse = {
    status(code) { out.status = code; return res; },
    json(b) { out.body = b; return b; },
    send(b) { out.body = b; return b; },
    setHeader(name, value) { out.headers[name] = value; return undefined; },
  };
  const headers: Record<string, string> = {};
  if (user) headers.cookie = `lc_session=${createSessionToken(user, SECRET)}`;
  await handleProxy({ body, headers }, res);
  return out;
};

test('a key typed on the laptop reaches the phone, encrypted on the server', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-keys-'));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = SECRET;
  delete process.env.KV_REST_API_URL;
  process.env.ALLOW_REGISTRATION = 'true';
  assert.equal((await call({ action: 'auth-register', username: 'jafar', password: 'long-enough-password' })).status, 201);

  assert.equal((await call({ action: 'keys-sync', keys: {} })).status, 401, 'signed-out devices get nothing');

  const laptop = await call({ action: 'keys-sync', keys: { 'ai:groq': { v: 'gsk_secret_1', changed: true } } }, 'jafar');
  assert.equal(laptop.status, 200);
  assert.equal(laptop.headers['Cache-Control'], 'no-store');
  const file = fs.readFileSync(path.join(dir, '.data_store.json'), 'utf-8');
  assert.ok(!file.includes('gsk_secret_1'), 'the key is not stored in plain text');
  assert.ok(JSON.parse(file)['keys:jafar'], 'kept under its own record');

  const phone = await call({ action: 'keys-sync', keys: {} }, 'jafar');
  assert.equal(phone.body.keys['ai:groq'].v, 'gsk_secret_1');

  // The phone removes it; the laptop, still holding it unchanged, hears about it.
  await call({ action: 'keys-sync', keys: { 'ai:groq': { v: '', changed: true } } }, 'jafar');
  const again = await call({ action: 'keys-sync', keys: { 'ai:groq': { v: 'gsk_secret_1' } } }, 'jafar');
  assert.equal(again.body.keys['ai:groq'].v, '');

  // Keys sealed with an old secret are set aside, not overwritten.
  const store = JSON.parse(fs.readFileSync(path.join(dir, '.data_store.json'), 'utf-8'));
  store['keys:jafar'] = sealKeys({ 'ai:groq': { v: 'from-old-secret', at: 1 } }, 'jafar', 'o'.repeat(40));
  fs.writeFileSync(path.join(dir, '.data_store.json'), JSON.stringify(store));
  // Point the server elsewhere and back, so it reads the file again.
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-keys-'));
  assert.equal((await call({ action: 'keys-sync', keys: {} }, 'jafar')).status, 401);
  process.env.DATA_DIR = dir;
  const fresh = await call({ action: 'keys-sync', keys: { 'ai:openrouter': { v: 'or' } } }, 'jafar');
  assert.equal(fresh.status, 200);
  assert.deepEqual(Object.keys(fresh.body.keys), ['ai:openrouter']);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.data_store.json'), 'utf-8'));
  assert.equal(Object.keys(saved).filter(k => k.startsWith('keys:jafar:unreadable:')).length, 1);
  await call({ action: 'keys-sync', keys: {} }, 'jafar');
  const later = JSON.parse(fs.readFileSync(path.join(dir, '.data_store.json'), 'utf-8'));
  assert.equal(Object.keys(later).filter(k => k.startsWith('keys:jafar:unreadable:')).length, 1, 'set aside once, not on every sync');

  // A session for an account that does not exist gets nothing.
  assert.equal((await call({ action: 'keys-sync', keys: {} }, 'someone')).status, 401);
});
