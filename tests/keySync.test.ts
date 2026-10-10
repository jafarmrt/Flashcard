import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { handleProxy, ProxyResponse } from '../server/api';
import { createSessionToken } from '../server/auth';
import { openKeys, sealKeys } from '../server/keyVault';
import { applyServerKeys, cleanKeyEntries, localKeyEntries, mergeKeyEntries, stampKeyChanges } from '../services/keySync';
import { providerKey } from '../services/aiSettings';
import { dictionaryKey } from '../services/dictSettings';
import { toSyncedSettings } from '../services/settingsSync';
import type { Settings } from '../types';

const SECRET = 's'.repeat(40);

test('keys are sealed with the server secret and open only with it', () => {
  const entries = { 'ai:groq': { v: 'gsk_123', at: 5 } };
  const sealed = sealKeys(entries, SECRET);
  assert.ok(!JSON.stringify(sealed).includes('gsk_123'), 'the key is not readable in the record');
  assert.deepEqual(openKeys(sealed, SECRET), entries);
  assert.deepEqual(openKeys(sealed, 'x'.repeat(40)), {}, 'another secret opens nothing');
  assert.deepEqual(openKeys({ ...sealed, data: sealed.data.slice(2) }, SECRET), {}, 'a damaged record opens nothing');
  assert.deepEqual(openKeys(null, SECRET), {});
});

test('a key typed or removed on this device is stamped; other settings are not', () => {
  const before: Partial<Settings> = { aiKeys: { groq: 'a' }, dictKeys: { 'mw-learners': 'm' } };
  assert.equal(stampKeyChanges(before, { ...before, theme: 'dark' }, 100), undefined);
  assert.deepEqual(stampKeyChanges(before, { ...before, aiKeys: { groq: 'b' } }, 100), { 'ai:groq': 100 });
  assert.deepEqual(stampKeyChanges(before, { ...before, dictKeys: {} }, 100), { 'dict:mw-learners': 100 });
  // The key from before the list moving into aiKeys is not a change.
  const legacy: Partial<Settings> = { aiProvider: 'openai-compatible', aiBaseUrl: 'https://api.groq.com/openai/v1', customApiKey: 'k' };
  assert.equal(stampKeyChanges(legacy, { ...legacy, customApiKey: undefined, aiKeys: { groq: 'k' } }, 100), undefined);
});

test('a device sends its keys, removed ones as empty', () => {
  const s: Partial<Settings> = { aiKeys: { openrouter: 'or' }, dictKeys: { mymemory: 'me@x' }, keyStamps: { 'ai:openrouter': 7, 'ai:groq': 9 } };
  assert.deepEqual(localKeyEntries(s), {
    'ai:openrouter': { v: 'or', at: 7 }, 'ai:groq': { v: '', at: 9 }, 'dict:mymemory': { v: 'me@x', at: 0 },
  });
});

test('the server keeps the later typing of each key, and its own copy on a tie', () => {
  const stored = { 'ai:groq': { v: 'old', at: 10 }, 'ai:gemini': { v: 'g', at: 0 } };
  const { merged, changed } = mergeKeyEntries(stored, {
    'ai:groq': { v: 'new', at: 20 }, 'ai:gemini': { v: 'other', at: 0 }, 'ai:deepseek': { v: '', at: 30 }, 'dict:mw-learners': { v: 'mw', at: 0 },
  });
  assert.equal(changed, true);
  assert.deepEqual(merged, { 'ai:groq': { v: 'new', at: 20 }, 'ai:gemini': { v: 'g', at: 0 }, 'dict:mw-learners': { v: 'mw', at: 0 } });
  assert.equal(mergeKeyEntries(merged, { 'ai:groq': { v: 'stale', at: 15 } }).changed, false);
  // Removing a key is kept as an empty value, so the removal reaches other devices.
  assert.deepEqual(mergeKeyEntries(merged, { 'ai:groq': { v: '', at: 25 } }).merged['ai:groq'], { v: '', at: 25 });
});

test('keys from a device are checked: known ids, strings, sane length and time', () => {
  const now = 1_000_000;
  assert.deepEqual(cleanKeyEntries({
    'ai:groq': { v: ' k ', at: 5 }, 'ai:nope': { v: 'x', at: 1 }, 'dict:mymemory': { v: 3, at: 1 },
    'ai:openrouter': { v: 'y'.repeat(501), at: 1 }, 'ai:deepseek': { v: 'd', at: now * 1000 }, 'ai:gemini': { v: 'g', at: -4 },
  }, now), { 'ai:groq': { v: 'k', at: 5 }, 'ai:deepseek': { v: 'd', at: now + 86_400_000 }, 'ai:gemini': { v: 'g', at: 0 } });
  assert.deepEqual(cleanKeyEntries('nonsense'), {});
});

test('a device takes the account\'s keys, but keeps one typed after them', () => {
  const local: Partial<Settings> = {
    aiProvider: 'openai-compatible', aiBaseUrl: 'https://api.groq.com/openai/v1', customApiKey: 'legacy',
    dictKeys: { mymemory: 'me@x' }, keyStamps: { 'dict:mymemory': 50 },
  };
  const change = applyServerKeys(local, {
    'ai:groq': { v: '', at: 20 }, 'ai:openrouter': { v: 'or', at: 30 }, 'dict:mymemory': { v: 'old@x', at: 40 }, 'dict:mw-learners': { v: 'mw', at: 0 },
  })!;
  const after = { ...local, ...change };
  assert.equal(providerKey(after, 'groq'), undefined, 'removed on another device, and the old key does not come back');
  assert.equal(providerKey(after, 'openrouter'), 'or');
  assert.equal(dictionaryKey(after, 'mymemory'), 'me@x', 'typed here later');
  assert.equal(dictionaryKey(after, 'mw-learners'), 'mw');
  assert.deepEqual(after.keyStamps, { 'dict:mymemory': 50, 'ai:groq': 20, 'ai:openrouter': 30 });
  assert.equal(applyServerKeys(after, { 'ai:openrouter': { v: 'or', at: 30 } }), null, 'nothing new');
  assert.equal(applyServerKeys(after, undefined), null);
});

test('keys never ride in the synced settings', () => {
  const synced = toSyncedSettings({ theme: 'dark', aiKeys: { groq: 'k' }, dictKeys: { mymemory: 'm' }, keyStamps: { 'ai:groq': 1 } });
  assert.deepEqual(synced, { theme: 'dark' });
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

  const laptop = await call({ action: 'keys-sync', keys: { 'ai:groq': { v: 'gsk_secret_1', at: 100 } } }, 'jafar');
  assert.equal(laptop.status, 200);
  assert.equal(laptop.headers['Cache-Control'], 'no-store');
  const file = fs.readFileSync(path.join(dir, '.data_store.json'), 'utf-8');
  assert.ok(!file.includes('gsk_secret_1'), 'the key is not stored in plain text');
  assert.ok(JSON.parse(file)['keys:jafar'], 'kept under its own record');

  const phone = await call({ action: 'keys-sync', keys: {} }, 'jafar');
  assert.deepEqual(phone.body.keys, { 'ai:groq': { v: 'gsk_secret_1', at: 100 } });

  // The phone removes it; the laptop hears about it.
  await call({ action: 'keys-sync', keys: { 'ai:groq': { v: '', at: 200 } } }, 'jafar');
  const again = await call({ action: 'keys-sync', keys: { 'ai:groq': { v: 'gsk_secret_1', at: 100 } } }, 'jafar');
  assert.deepEqual(again.body.keys, { 'ai:groq': { v: '', at: 200 } });

  // A session for an account that does not exist gets nothing.
  assert.equal((await call({ action: 'keys-sync', keys: {} }, 'someone')).status, 401);
});
