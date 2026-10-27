import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHmac } from 'crypto';
import { handleProxy, handleTelegram, type ProxyRequest, type ProxyResponse } from '../server/api';

// The whole path through the server: the app asks for a link, Telegram sends
// "/start <code>" to the webhook, the account is linked, and a review is sent.
test('linking Telegram through the API and the webhook', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-tg-'));
  const secret = 't'.repeat(40);
  Object.assign(process.env, { DATA_DIR: dir, SESSION_SECRET: secret, TELEGRAM_BOT_TOKEN: 'fake', TELEGRAM_BOT_USERNAME: 'TestBot', TELEGRAM_POLLING: 'true' });
  delete process.env.KV_REST_API_URL;

  const sent: { method: string; body: any }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    const method = String(url).split('/').pop()!;
    sent.push({ method, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  }) as typeof fetch;

  let cookie = '';
  const call = async (req: ProxyRequest, handler = handleProxy) => {
    const out: { status: number; body: any } = { status: 0, body: null };
    const res: ProxyResponse = {
      status(code) { out.status = code; return res; },
      json(b) { out.body = b; return b; },
      send(b) { out.body = b; return b; },
      setHeader(name, value) { if (name === 'Set-Cookie') cookie = String(value).split(';')[0]; return undefined; },
    };
    await handler(req, res);
    return out;
  };
  const app = (body: object) => call({ body, headers: { cookie } });

  try {
    assert.equal((await app({ action: 'auth-register', username: 'ann', password: 'long-enough-password' })).status, 201);
    assert.deepEqual((await app({ action: 'telegram-status' })).body, { available: true, bot: 'TestBot', linked: false, words: 7, paused: false });
    await app({ action: 'sync', since: 0, changes: { cards: [{ id: 'c1', deckId: 'd', front: 'reluctant', back: 'بی‌میل', repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }] } });

    const linked = await app({ action: 'telegram-link', tz: 210 });
    const code = String(linked.body.link).split('start=')[1];
    assert.ok(code);

    const webhook = (update: object, token = createHmac('sha256', secret).update('telegram-webhook').digest('hex').slice(0, 48)) =>
      call({ method: 'POST', body: update, headers: { 'x-telegram-bot-api-secret-token': token } }, handleTelegram);
    assert.equal((await webhook({ message: { chat: { id: 77 }, text: `/start ${code}` } }, 'wrong')).status, 401);
    assert.equal((await webhook({ message: { chat: { id: 77 }, text: `/start ${code}` } })).status, 200);
    assert.equal((await app({ action: 'telegram-status' })).body.linked, true);

    assert.equal((await app({ action: 'telegram-update', words: 12 })).body.words, 10);
    assert.equal((await app({ action: 'telegram-send' })).body.result, 'sent');
    const question = sent.filter(s => s.method === 'sendMessage').at(-1)!;
    assert.equal(question.body.chat_id, 77);
    assert.match(question.body.text, /reluctant/);

    // The cron needs Vercel's secret.
    assert.equal((await call({ method: 'GET', query: { cron: '1' }, headers: {} }, handleTelegram)).status, 401);

    assert.equal((await app({ action: 'telegram-unlink' })).body.linked, false);
    assert.equal((await app({ action: 'telegram-status' })).body.linked, false);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_USERNAME;
    delete process.env.TELEGRAM_POLLING;
  }
});
