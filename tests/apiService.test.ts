import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callProxy, ProxyError, TIMEOUT_STATUS, timeoutFor, SLOW_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from '../services/apiService';

// A fetch that never answers until it is aborted, like a dead connection.
const hangingFetch = (async (_url: string, init?: { signal?: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })) as unknown as typeof fetch;

const withFetch = async (impl: typeof fetch, run: () => Promise<void>) => {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { await run(); } finally { globalThis.fetch = real; }
};

test('a request that gets no answer fails with a timeout ProxyError', async () => {
  await withFetch(hangingFetch, async () => {
    await assert.rejects(callProxy('ping', {}, { timeoutMs: 20 }), (e: unknown) => e instanceof ProxyError && e.status === TIMEOUT_STATUS);
  });
});

test("the caller's own cancel is not reported as a timeout", async () => {
  await withFetch(hangingFetch, async () => {
    const controller = new AbortController();
    const call = callProxy('ping', {}, { timeoutMs: 5000, signal: controller.signal });
    controller.abort();
    await assert.rejects(call, (e: unknown) => !(e instanceof ProxyError) && (e as Error).name === 'AbortError');
  });
});

test('answers and server errors pass through as before', async () => {
  const ok = (async () => new Response(JSON.stringify({ hello: 1 }), { status: 200 })) as unknown as typeof fetch;
  await withFetch(ok, async () => assert.deepEqual(await callProxy('ping', {}), { hello: 1 }));
  const bad = (async () => new Response(JSON.stringify({ error: 'quota' }), { status: 429 })) as unknown as typeof fetch;
  await withFetch(bad, async () => {
    await assert.rejects(callProxy('ping', {}), (e: unknown) => e instanceof ProxyError && e.status === 429 && e.message === 'quota');
  });
});

test('AI and upload requests get the long limit, the rest the short one', () => {
  assert.equal(timeoutFor('gemini-generate'), SLOW_TIMEOUT_MS);
  assert.equal(timeoutFor('sync'), SLOW_TIMEOUT_MS);
  assert.equal(timeoutFor('ping'), DEFAULT_TIMEOUT_MS);
  assert.equal(timeoutFor('dictionary-lookup'), DEFAULT_TIMEOUT_MS);
});
