import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { handleProxy, ProxyResponse } from '../server/api';

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
