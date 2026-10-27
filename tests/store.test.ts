import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getKey, handleProxy, ProxyResponse, setKey } from '../server/api';

// A minimal response object that records what the handler sent.
const call = async (body: object) => {
  const out: { status: number; body: any } = { status: 0, body: null };
  const res: ProxyResponse = {
    status(code) { out.status = code; return res; },
    json(b) { out.body = b; return b; },
    send(b) { out.body = b; return b; },
    setHeader() { return undefined; },
  };
  await handleProxy({ body, headers: {} }, res);
  return out;
};

test('a damaged data file is never replaced by an empty one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-store-'));
  const file = path.join(dir, '.data_store.json');
  const damaged = '{"user:jafar": {"username": "jafar", "data": {"cards": [';
  fs.writeFileSync(file, damaged);
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = 's'.repeat(40);
  delete process.env.KV_REST_API_URL;
  delete process.env.ALLOW_REGISTRATION;

  const res = await call({ action: 'auth-register', username: 'stranger', password: 'long-enough-password' });
  assert.equal(res.status, 500);
  assert.equal(fs.readFileSync(file, 'utf-8'), damaged, 'the file is left as it was');
});

test('a failed write leaves the stored value as it was, even if the caller changed its copy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-store-'));
  const file = path.join(dir, '.data_store.json');
  process.env.DATA_DIR = dir;
  delete process.env.KV_REST_API_URL;

  await setKey('user:ann', { username: 'ann', data: { cards: 1 } });
  const user = await getKey('user:ann');
  user.data.cards = 2; // changed in memory, not saved yet
  assert.equal((await getKey('user:ann')).data.cards, 1, 'a copy, not the stored object');

  // The data file's place is taken by a folder: the rename fails.
  fs.rmSync(file);
  fs.mkdirSync(file);
  await assert.rejects(setKey('user:ann', user));
  assert.equal((await getKey('user:ann')).data.cards, 1, 'rolled back to what is on disk');
});
