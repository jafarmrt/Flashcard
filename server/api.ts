import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import { createHmac, randomUUID } from 'crypto';
import { clampWords, cleanTz, handleUpdate, newLinkCode, runDaily, startReview, TG_DEFAULT_WORDS, type TgDeps, type TgLink, unlink, userKey } from './telegram.js';
import { freeEnrich, freeTranslate, lookupFrequencies } from './freeLookup.js';
import { lookupChain, lookupSingle, mwKey } from './dictionaries.js';
import { cleanDictionaryRequest, DEFAULT_DICTIONARY_ORDER, DICTIONARY_IDS, DictionaryRequest, dictionarySignature } from '../services/dictionaryCatalog.js';
import { applyChanges, changesSince, upgradeStore } from './syncStore.js';
import { checkPublicHost, fetchPublicPage, PageFetchError } from './pageFetch.js';
import { AiRequestError, ANTHROPIC_URL, anthropicHeaders, anthropicReply, anthropicRequestBody, openAiRequestBody } from './aiRequests.js';
import { packChapter, unpackChapter } from './chapterText.js';
import { geminiUsage, listAnthropicModels, listGeminiModels, listOpenAiModels, openAiUsage } from './aiModels.js';
import { cachedEnrich, fileLookupStore, LookupStore } from './lookupCache.js';
import { openKeys, sealKeys } from './keyVault.js';
import { cleanSentKeys, mergeKeyEntries } from '../services/keySync.js';
import { cleanOpenRouterName, cleanSpeechName, DEFAULT_OPENROUTER_SPEECH_MODEL, DEFAULT_SPEECH_MODEL, DEFAULT_SPEECH_VOICE, generateSpeech, listOpenRouterSpeechModels, MAX_SPEECH_CHARS, openRouterSpeech, SpeechError } from './speech.js';
import {
  PUBLIC_ACTIONS, USERNAME_PATTERN, MIN_PASSWORD_LENGTH, registrationAllowed,
  hashPassword, verifyPassword, getSessionSecret, createSessionToken, sessionUser,
  sessionCookieHeader, clearSessionCookieHeader, loginLockMinutes, recordLoginFailure,
  clearLoginFailures, isAllowedAudioUrl,
} from './auth.js';

// The parts of Express's and Vercel's request/response objects the API uses.
export interface ProxyRequest {
  method?: string;
  query?: Record<string, unknown>;
  body?: any;
  headers: Record<string, string | string[] | undefined>;
  secure?: boolean; // Express sets it (trusting nginx); Vercel does not
  ip?: string;
}
export interface ProxyResponse {
  status(code: number): ProxyResponse;
  json(body: unknown): unknown;
  send(body: unknown): unknown;
  setHeader(name: string, value: string | number | readonly string[]): unknown;
}

const firstHeader = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.split(',')[0].trim();

// On Vercel the platform sets X-Forwarded-Proto and X-Forwarded-For itself.
const isSecure = (req: ProxyRequest) =>
  typeof req.secure === 'boolean' ? req.secure : firstHeader(req.headers['x-forwarded-proto']) === 'https';
const clientIp = (req: ProxyRequest) =>
  req.ip || firstHeader(req.headers['x-real-ip']) || firstHeader(req.headers['x-forwarded-for']) || 'unknown';

// User data lives in Upstash Redis / Vercel KV when KV_REST_API_URL and
// KV_REST_API_TOKEN are set (needed on Vercel, whose disk is not kept), else in
// `<DATA_DIR>/.data_store.json` (the VPS). Settings are read lazily so a
// .env loaded after import still counts.
const dataDir = () => path.resolve(process.env.DATA_DIR || process.cwd());
const kvConfig = () => {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
};

let fileStore: { file: string; store: Map<string, any> } | null = null;

const storeFile = () => path.join(dataDir(), '.data_store.json');

function loadFileStore(): Map<string, any> {
  if (fileStore && fileStore.file === storeFile()) return fileStore.store;
  if (process.env.VERCEL) {
    throw new Error('Cloud storage is not set up. Connect Upstash Redis to this Vercel project so KV_REST_API_URL and KV_REST_API_TOKEN are set.');
  }
  const file = storeFile();
  const store = new Map<string, any>();
  if (fs.existsSync(file)) {
    // A file that cannot be read is never replaced by an empty store: that
    // would delete the account on the next save. Restore it from a backup.
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      throw new Error(`The data file ${file} is damaged (${(e as Error).message}). Restore it from a backup; the server will not overwrite it.`);
    }
    Object.entries(parsed).forEach(([k, v]) => store.set(k, v));
  }
  fileStore = { file, store };
  return store;
}

// Written to a temporary file first and then renamed over the old one, so a
// crash or a full disk mid-write leaves the previous file intact. A failed
// write is an error: the caller must not report the data as saved.
function persistStore(store: Map<string, any>) {
  const file = storeFile();
  const tmp = `${file}.${process.pid}.tmp`;
  const obj: Record<string, any> = {};
  store.forEach((v, k) => { obj[k] = v; });
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.chmodSync(tmp, 0o600); // user data and password hashes: owner only
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean up */ }
    throw new Error(`Could not save the data file ${file}: ${(e as Error).message}`);
  }
}

const getUserKey = (username: string) => `user:${username.toLowerCase()}`;
const accountKeysKey = (username: string) => `keys:${username.toLowerCase()}`;
const chapterKey = (username: string, chapterId: string) => `chapter:${username.toLowerCase()}:${chapterId}`;
const CHAPTER_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_CHAPTER_CHARS = 2_000_000; // under Vercel's 4.5 MB request limit

// One Redis command through Upstash's REST API.
async function kvCommand(kv: { url: string; token: string }, command: (string | number)[]): Promise<any> {
  const kvResponse = await fetch(kv.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kv.token}` },
    body: JSON.stringify(command),
  });
  if (!kvResponse.ok) throw new Error(`Cloud storage request failed (${kvResponse.status}).`);
  return (await kvResponse.json()).result;
}

// The file store hands out and keeps copies, as Redis does. It used to give
// the caller the stored object itself: a caller that changed it and then
// failed to save had already changed the store, and the rollback in setKey
// put back the very same (changed) object, so memory said "saved" while
// the disk did not.
const copyOf = <T>(value: T): T => (value === undefined || value === null ? value : JSON.parse(JSON.stringify(value)));

// A KV error is thrown, not hidden: falling back to memory would lose data.
export async function getKey(key: string): Promise<any | null> {
  const kv = kvConfig();
  if (kv) {
    const result = await kvCommand(kv, ['GET', key]);
    return result ? JSON.parse(result) : null;
  }
  return copyOf(loadFileStore().get(key)) ?? null;
}

export async function setKey(key: string, value: unknown): Promise<void> {
  const kv = kvConfig();
  if (kv) {
    await kvCommand(kv, ['SET', key, JSON.stringify(value)]);
    return;
  }
  const store = loadFileStore();
  const previous = store.get(key);
  store.set(key, copyOf(value));
  try {
    persistStore(store);
  } catch (e) {
    // Keep memory and disk the same, so nothing looks saved that is not.
    if (previous === undefined) store.delete(key); else store.set(key, previous);
    throw e;
  }
}

export async function delKey(key: string): Promise<void> {
  const kv = kvConfig();
  if (kv) {
    await kvCommand(kv, ['DEL', key]);
    return;
  }
  const store = loadFileStore();
  if (!store.has(key)) return;
  const previous = store.get(key);
  store.delete(key);
  try {
    persistStore(store);
  } catch (e) {
    store.set(key, previous);
    throw e;
  }
}

// Every key that starts with `prefix` (a few dozen at most: used for the
// Telegram links).
export async function listKeys(prefix: string): Promise<string[]> {
  const kv = kvConfig();
  if (kv) {
    const result = await kvCommand(kv, ['KEYS', `${prefix}*`]);
    return Array.isArray(result) ? result.filter((k: unknown): k is string => typeof k === 'string') : [];
  }
  return Array.from(loadFileStore().keys()).filter(k => k.startsWith(prefix));
}

// How long each dictionary may take: the bulk-add setting, within limits.
const lookupTimeout = (value: unknown): number | undefined => {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? Math.min(Math.max(ms, 1000), 8_000) : undefined;
};

// Which dictionaries can answer, so a cached lookup is only reused for the
// same choice (a key on the server counts like one typed on the device).
const serverSignature = (request: DictionaryRequest) =>
  dictionarySignature(request.order ?? DEFAULT_DICTIONARY_ORDER, id => (id === 'mw-learners' || id === 'mw-collegiate') && !!mwKey(id, request.keys));

// Where dictionary lookups are kept: Redis, a file on the VPS, or nowhere
// (Vercel without cloud storage).
let fileLookups: { file: string; store: LookupStore } | null = null;
function lookupStore(): LookupStore | null {
  const kv = kvConfig();
  if (kv) {
    return {
      get: async key => { const result = await kvCommand(kv, ['GET', key]); return result ? JSON.parse(result) : null; },
      set: async (key, value, keepMs) => { await kvCommand(kv, ['SET', key, JSON.stringify(value), 'PX', Math.round(keepMs)]); },
    };
  }
  if (process.env.VERCEL) return null;
  const file = path.join(dataDir(), '.lookup_cache.json');
  if (fileLookups?.file !== file) fileLookups = { file, store: fileLookupStore(file) };
  return fileLookups.store;
}

// The bytes each key takes: Redis is asked for the lengths (in one pipeline
// request per 100 keys), the file store measures each value as it would be
// written.
async function keysBytes(keys: string[]): Promise<number[]> {
  const kv = kvConfig();
  if (!kv) {
    const store = loadFileStore();
    return keys.map(key => {
      const value = store.get(key);
      return value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value), 'utf-8');
    });
  }
  const out: number[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const response = await fetch(`${kv.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kv.token}` },
      body: JSON.stringify(batch.map(key => ['STRLEN', key])),
    });
    if (!response.ok) throw new Error(`Cloud storage request failed (${response.status}).`);
    const results = await response.json();
    out.push(...batch.map((_, n) => Number(Array.isArray(results) ? results[n]?.result : 0) || 0));
  }
  return out;
}

export async function storageUsage(username: string): Promise<{ backend: 'redis' | 'file'; recordBytes: number; chapters: number; chapterBytes: number; translationEmail: boolean }> {
  const user = await getUser(username);
  const ids: string[] = (user?.data?.chapters || [])
    .filter((c: any) => c && !c.isDeleted && typeof c.id === 'string' && CHAPTER_ID.test(c.id))
    .map((c: any) => c.id);
  const [recordBytes, ...chapterSizes] = await keysBytes([getUserKey(username), ...ids.map(id => chapterKey(username, id))]);
  const chapterBytes = chapterSizes.reduce((a, b) => a + b, 0);
  return {
    backend: kvConfig() ? 'redis' : 'file',
    recordBytes,
    chapters: ids.length,
    chapterBytes,
    translationEmail: !!process.env.MYMEMORY_EMAIL, // a larger free translation quota
  };
}

const getUser = (username: string): Promise<any | null> => getKey(getUserKey(username));
const setUser = (userData: any): Promise<void> => setKey(getUserKey(userData.username), userData);

// Syncs of one account run one at a time: two devices merging into the same
// record at once would each save over the other's changes. On Vercel
// (several instances) the lock is a Redis key that expires by itself.
const LOCK_MS = 20_000;
const localLocks = new Map<string, Promise<unknown>>();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function withUserLock<T>(username: string, work: () => Promise<T>): Promise<T> {
  const kv = kvConfig();
  if (!kv) {
    const name = username.toLowerCase();
    const previous = localLocks.get(name) || Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    localLocks.set(name, run);
    try {
      return await run;
    } finally {
      if (localLocks.get(name) === run) localLocks.delete(name);
    }
  }
  const key = `lock:${username.toLowerCase()}`;
  const token = randomUUID();
  for (let attempt = 0; ; attempt++) {
    if ((await kvCommand(kv, ['SET', key, token, 'NX', 'PX', LOCK_MS])) === 'OK') break;
    if (attempt >= 40) throw new BusyError();
    await sleep(250);
  }
  try {
    return await work();
  } finally {
    // Only our own lock is removed, never one taken after ours expired.
    await kvCommand(kv, ['EVAL', "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token])
      .catch(e => console.error('Could not release the sync lock:', e));
  }
}

class BusyError extends Error {
  constructor() { super('Another device is syncing this account. Try again in a moment.'); }
}

// --- Telegram (server/telegram.ts) ---

const telegramToken = () => process.env.TELEGRAM_BOT_TOKEN || '';
let telegramBot = '';

async function telegramApi(method: string, body: Record<string, unknown>): Promise<any> {
  const response = await fetch(`https://api.telegram.org/bot${telegramToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 40_000 : 15_000),
  });
  const reply = await response.json().catch(() => ({}));
  if (!response.ok || !reply.ok) throw new Error(`Telegram ${method}: ${reply.description || response.status}`);
  return reply.result;
}

export const telegramDeps = (): TgDeps => ({
  get: getKey,
  set: setKey,
  del: delKey,
  keys: listKeys,
  readData: async username => {
    const user = await getUser(username);
    return user ? upgradeStore(user.data, randomUUID).store : null;
  },
  changeData: (username, make) => withUserLock(username, async () => {
    const user = await getUser(username);
    if (!user) return false;
    const { store } = upgradeStore(user.data, randomUUID);
    const changes = make(store);
    if (!changes) return false;
    applyChanges(store, changes);
    user.data = store;
    await setUser(user);
    return true;
  }),
  api: telegramApi,
  botName: async () => {
    if (process.env.TELEGRAM_BOT_USERNAME) return process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, '');
    if (!telegramBot) telegramBot = (await telegramApi('getMe', {})).username;
    return telegramBot;
  },
  now: () => new Date(),
});

// The header Telegram sends with every update, set with the webhook.
const webhookSecret = (secret: string) => createHmac('sha256', secret).update('telegram-webhook').digest('hex').slice(0, 48);

// The webhook points at this deployment; set again on every link, which
// also moves it after a change of address. A server that polls (TELEGRAM_POLLING)
// never sets one.
async function ensureWebhook(req: ProxyRequest, secret: string) {
  if (process.env.TELEGRAM_POLLING === 'true') return;
  const host = firstHeader(req.headers['x-forwarded-host']) || firstHeader(req.headers.host);
  if (!host || /^(localhost|127\.|\[::1\])/.test(host)) return; // Telegram cannot reach this machine
  const url = process.env.TELEGRAM_WEBHOOK_URL || `https://${host}/api/telegram`;
  await telegramApi('setWebhook', { url, secret_token: webhookSecret(secret), allowed_updates: ['message', 'callback_query'] });
}

// /api/telegram: updates from Telegram (POST, with the webhook's secret) and
// the daily cron (GET ?cron=1, with Vercel's CRON_SECRET).
export async function handleTelegram(req: ProxyRequest, res: ProxyResponse) {
  if (!telegramToken()) return res.status(404).json({ error: 'Telegram is not set up on this server (TELEGRAM_BOT_TOKEN).' });
  let secret: string;
  try {
    secret = getSessionSecret(dataDir());
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
  try {
    if (req.method === 'GET') {
      const cronSecret = process.env.CRON_SECRET;
      if (!cronSecret || firstHeader(req.headers.authorization) !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Not allowed.' });
      const sent = await runDaily(telegramDeps(), true);
      return res.status(200).json({ sent });
    }
    if (firstHeader(req.headers['x-telegram-bot-api-secret-token']) !== webhookSecret(secret)) return res.status(401).json({ error: 'Not allowed.' });
    await handleUpdate(telegramDeps(), req.body);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Telegram update failed:', e);
    // A 200 all the same: Telegram would otherwise send the same update again and again.
    return res.status(200).json({ ok: false });
  }
}

// A server without a public address (or that prefers it) asks Telegram for
// updates itself, and sends the day's words once the local hour comes.
export function startTelegramWorker(): void {
  if (!telegramToken() || process.env.VERCEL) return;
  const deps = telegramDeps();
  setInterval(() => { runDaily(deps).catch(e => console.warn('Telegram daily run failed:', e.message)); }, 10 * 60_000);
  if (process.env.TELEGRAM_POLLING !== 'true') return;
  let offset = 0;
  const poll = async () => {
    try {
      await telegramApi('deleteWebhook', {}).catch(() => undefined);
      for (;;) {
        const updates = await telegramApi('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
        for (const update of updates || []) {
          offset = Math.max(offset, update.update_id + 1);
          await handleUpdate(deps, update).catch(e => console.warn('Telegram update failed:', e.message));
        }
      }
    } catch (e) {
      console.warn('Telegram polling stopped; trying again in a minute:', (e as Error).message);
      setTimeout(poll, 60_000);
    }
  };
  poll();
}

// Whether any account exists yet; registration closes after the first one.
async function anyAccountExists(): Promise<boolean> {
  const kv = kvConfig();
  if (kv) {
    const result = await kvCommand(kv, ['KEYS', 'user:*']);
    return Array.isArray(result) && result.length > 0;
  }
  return Array.from(loadFileStore().keys()).some(k => k.startsWith('user:'));
}

// --- AI HELPERS ---
const AI_TIMEOUT_MS = 50_000; // under Vercel's 60 s function limit

// One short line saying why an AI request failed ("Gemini (429): quota
// exceeded"), shown to the user instead of a bare "API error".
export function aiErrorMessage(provider: string, status: number, body: string): string {
  let reason = '';
  try {
    const json = JSON.parse(body);
    reason = json?.error?.message || json?.message || (typeof json?.error === 'string' ? json.error : '');
  } catch {
    reason = body;
  }
  reason = String(reason || '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '').slice(0, 200);
  // Refused for where the request comes from (sanctions, a region the
  // service does not serve), not for the key.
  const blocked = /location is not supported|security policy|unsupported.?(country|region)|not available in your (country|region)|request not allowed/i.test(reason);
  const hint = blocked ? 'this service refuses requests from where the server is (region or sanctions), not the key'
    : status === 401 || status === 403 ? 'the API key is wrong or not allowed'
    : status === 429 ? 'the free quota is used up for now'
    : status === 404 ? 'the model name is not available'
    : '';
  return `${provider} (${status}): ${[hint, reason].filter(Boolean).join(' - ') || 'request failed'}`;
}

// Base URL of an OpenAI-compatible provider: http(s) only.
export function cleanAiBaseUrl(baseUrl: string | undefined): string {
  const raw = (baseUrl || 'https://api.groq.com/openai/v1').trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('The AI base URL is not a valid address.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The AI base URL must start with https://');
  if (url.username || url.password) throw new Error('Put the API key in the key field, not in the base URL.');
  if (url.search || url.hash || raw.includes('#') || raw.includes('?')) throw new Error('The AI base URL cannot have ? or # in it.');
  return raw;
}

// The server sends requests to the base URL a user typed, so it must be on
// the public internet: never this server, its network or a cloud metadata
// address. A VPS running its own Ollama sets ALLOW_PRIVATE_AI_URL=true.
export async function checkAiBaseUrl(baseUrl: string | undefined, lookup?: (host: string) => Promise<string[]>): Promise<string> {
  const clean = cleanAiBaseUrl(baseUrl);
  if (process.env.ALLOW_PRIVATE_AI_URL === 'true') return clean;
  try {
    await checkPublicHost(new URL(clean), lookup);
  } catch (e) {
    throw new Error(e instanceof PageFetchError && /public internet/.test(e.message)
      ? 'The AI base URL must be a public address. A server running its own Ollama can allow private addresses with ALLOW_PRIVATE_AI_URL=true.'
      : 'The AI base URL could not be found.');
  }
  return clean;
}

// --- GEMINI API HANDLER ---
async function handleGeminiGenerate(payload: any, res: ProxyResponse, apiKey: string) {
  const { model, contents, config } = payload;
  // Support gemini-2.5-flash / gemini-2.5-pro or standard gemini-2.5-flash
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.5-flash')}:generateContent`;

  const {
    systemInstruction,
    responseModalities,
    speechConfig,
    ...generationConfig
  } = config || {};

  const finalContents = Array.isArray(contents)
    ? contents
    : (contents && typeof contents === 'object' && contents.parts)
      ? [contents]
      : [{ parts: [{ text: contents }] }];

  const googleApiBody: Record<string, any> = {
    contents: finalContents,
    ...(systemInstruction && { systemInstruction }),
    ...(responseModalities && { responseModalities }),
    ...(speechConfig && { speechConfig }),
    ...(Object.keys(generationConfig).length > 0 && { generationConfig }),
  };

  const geminiResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(googleApiBody),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  if (!geminiResponse.ok) {
    const errorText = await geminiResponse.text();
    console.error('Google API Error:', errorText);
    return res.status(geminiResponse.status).json({ error: aiErrorMessage('Gemini', geminiResponse.status, errorText) });
  }

  const responseData = await geminiResponse.json();
  const usage = geminiUsage(responseData);
  const adaptedResponse = {
    text: responseData.candidates?.[0]?.content?.parts?.[0]?.text || '',
    candidates: responseData.candidates,
    model: responseData.modelVersion || model || 'gemini-2.5-flash',
    ...(usage ? { usage } : {}),
  };

  return res.status(200).json(adaptedResponse);
}

// --- OPENAI-COMPATIBLE (GROQ, OPENROUTER, DEEPSEEK, OLLAMA, TOGETHER, ETC.) HANDLER ---
async function handleOpenAiGenerate(payload: any, res: ProxyResponse, apiKey: string, baseUrl?: string) {
  let cleanBaseUrl: string;
  try {
    cleanBaseUrl = await checkAiBaseUrl(baseUrl);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
  const endpoint = `${cleanBaseUrl}/chat/completions`;
  const requestBody = openAiRequestBody(payload, new URL(endpoint).hostname);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const apiResponse = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    redirect: 'error', // a redirect could lead to an address that was not checked
  });

  if (!apiResponse.ok) {
    const errorText = await apiResponse.text();
    console.error('OpenAI-compatible API Error:', errorText);
    return res.status(apiResponse.status).json({ error: aiErrorMessage(new URL(endpoint).hostname, apiResponse.status, errorText) });
  }

  const responseData = await apiResponse.json();
  const text = responseData.choices?.[0]?.message?.content || '';
  const usage = openAiUsage(responseData);
  return res.status(200).json({ text, candidates: responseData.choices, model: responseData.model || requestBody.model, ...(usage ? { usage } : {}) });
}

// --- ANTHROPIC (CLAUDE) HANDLER ---
// Only with the key typed on the device: the server has no Claude key of its own.
async function handleAnthropicGenerate(payload: any, res: ProxyResponse, apiKey: string) {
  if (!apiKey) return res.status(400).json({ error: 'Claude: no API key. Enter an Anthropic key in the AI settings.' });
  let body: Record<string, any>;
  try {
    body = anthropicRequestBody(payload);
  } catch (e) {
    if (e instanceof AiRequestError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
  const response = await fetch(`${ANTHROPIC_URL}/messages`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Anthropic API Error:', errorText);
    return res.status(response.status).json({ error: aiErrorMessage('Claude', response.status, errorText) });
  }
  const reply = anthropicReply(await response.json(), body.model);
  return res.status(200).json(reply);
}

// --- PROXY ENDPOINT ---
// The one API endpoint, shared by the Express server (VPS, local dev) and the
// Vercel function in api/proxy.ts.
export async function handleProxy(req: ProxyRequest, res: ProxyResponse) {
  const { action, ...payload } = req.body || {};

  // Every action except the pings and sign-in needs a valid session cookie;
  // the signed-in user comes from the cookie, never from the request body.
  const secure = isSecure(req);
  let secret: string;
  try {
    secret = getSessionSecret(dataDir());
  } catch (e) {
    // Vercel cannot keep a generated secret, so SESSION_SECRET must be set there.
    return res.status(500).json({ error: (e as Error).message });
  }
  const cookie = req.headers.cookie;
  const signedInUser = sessionUser(Array.isArray(cookie) ? cookie.join('; ') : cookie, secret);
  if (!PUBLIC_ACTIONS.has(action) && !signedInUser) {
    return res.status(401).json({ error: 'Please sign in again.', code: 'AUTH_REQUIRED' });
  }

  try {
    switch (action) {
      case 'ping':
        return res.status(200).json({ message: 'pong' });

      case 'ping-free-dict': {
        try {
          const dictResponse = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/hello', {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LinguaCards/1.0',
              'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(3000),
          });
          if (dictResponse.ok) return res.status(200).json({ message: 'pong' });
        } catch {
          // unreachable: reported below
        }
        return res.status(503).json({ error: 'The free dictionary cannot be reached from the server.' });
      }

      case 'ping-mw': {
        // Only says whether a key is set: calling Merriam-Webster here would
        // spend its quota on every page load.
        return res.status(200).json({ message: process.env.MW_API_KEY || process.env.MW_LEARNERS_API_KEY ? 'configured' : 'unconfigured' });
      }

      case 'gemini-generate': {
        if (payload.aiProvider === 'anthropic') return await handleAnthropicGenerate(payload, res, payload.customApiKey || '');
        const isCustomOpenAi = payload.aiProvider === 'openai-compatible' || payload.aiBaseUrl;
        if (isCustomOpenAi) {
          const apiKey = payload.customApiKey || '';
          return await handleOpenAiGenerate(payload, res, apiKey, payload.aiBaseUrl);
        }

        const apiKey = payload.customApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
        if (!apiKey) return res.status(400).json({ error: 'Gemini: no API key. Set GEMINI_API_KEY on the server or enter a key in the AI settings.' });
        return await handleGeminiGenerate(payload, res, apiKey);
      }

      case 'ai-speech': {
        // Reading aloud with an AI voice: one short piece of text at a time.
        const text = typeof payload.text === 'string' ? payload.text.replace(/\s+/g, ' ').trim() : '';
        if (!text) return res.status(400).json({ error: 'text is required.' });
        if (text.length > MAX_SPEECH_CHARS) return res.status(400).json({ error: `At most ${MAX_SPEECH_CHARS} characters at a time.` });
        if (payload.provider === 'openrouter') {
          const key = payload.customApiKey || process.env.OPENROUTER_API_KEY;
          if (!key) return res.status(400).json({ error: 'OpenRouter voice: no API key. Enter an OpenRouter key in the AI settings.' });
          const model = cleanOpenRouterName(payload.model, DEFAULT_OPENROUTER_SPEECH_MODEL);
          try {
            const audio = await openRouterSpeech(key, text, model, cleanOpenRouterName(payload.voice, '') || undefined);
            return res.status(200).json({ ...audio, model });
          } catch (e) {
            if (e instanceof SpeechError) return res.status(e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message });
            throw e;
          }
        }
        const apiKey = payload.customApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
        if (!apiKey) return res.status(400).json({ error: 'Gemini voice: no API key. Enter a Gemini key in the AI settings.' });
        const model = cleanSpeechName(payload.model, DEFAULT_SPEECH_MODEL);
        try {
          const audio = await generateSpeech(apiKey, text, model, cleanSpeechName(payload.voice, DEFAULT_SPEECH_VOICE));
          return res.status(200).json({ ...audio, model });
        } catch (e) {
          if (e instanceof SpeechError) return res.status(e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message });
          throw e;
        }
      }

      case 'list-speech-models': {
        // OpenRouter's speech models and their voices, for Settings.
        try {
          return res.status(200).json({ models: await listOpenRouterSpeechModels(payload.customApiKey || process.env.OPENROUTER_API_KEY || '') });
        } catch (e) {
          if (e instanceof SpeechError) return res.status(e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message });
          throw e;
        }
      }

      case 'test-ai-key': {
        if (payload.aiProvider === 'anthropic') {
          return await handleAnthropicGenerate({ model: payload.model, contents: 'Say "OK".', config: { maxOutputTokens: 16 } }, res, payload.customApiKey || '');
        }
        const isCustomOpenAi = payload.aiProvider === 'openai-compatible' || payload.aiBaseUrl;
        if (isCustomOpenAi) {
          const apiKey = payload.customApiKey || '';
          const model = payload.model || 'llama-3.3-70b-versatile';
          const testPayload = {
            model,
            contents: 'Say "OK" in JSON: {"status": "OK"}',
            config: { responseMimeType: 'application/json' }
          };
          return await handleOpenAiGenerate(testPayload, res, apiKey, payload.aiBaseUrl);
        }

        const apiKey = payload.customApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
        if (!apiKey) return res.status(400).json({ error: 'No API key provided.' });
        const model = payload.model || 'gemini-2.5-flash';
        const testPayload = {
          model,
          contents: 'Say "OK" if connected.',
          config: {}
        };
        return await handleGeminiGenerate(testPayload, res, apiKey);
      }

      case 'list-models': {
        // The models of one service, asked with the key typed on the device
        // (Gemini: or the server's key).
        const isAnthropic = payload.aiProvider === 'anthropic';
        const isCustomOpenAi = !isAnthropic && (payload.aiProvider === 'openai-compatible' || payload.aiBaseUrl);
        try {
          if (isAnthropic) {
            if (!payload.customApiKey) return res.status(400).json({ error: 'Claude: no API key.' });
            return res.status(200).json({ models: await listAnthropicModels(payload.customApiKey) });
          }
          if (isCustomOpenAi) {
            let baseUrl: string;
            try {
              baseUrl = await checkAiBaseUrl(payload.aiBaseUrl);
            } catch (e) {
              return res.status(400).json({ error: (e as Error).message });
            }
            return res.status(200).json({ models: await listOpenAiModels(baseUrl, payload.customApiKey || '') });
          }
          const apiKey = payload.customApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
          if (!apiKey) return res.status(400).json({ error: 'Gemini: no API key.' });
          return res.status(200).json({ models: await listGeminiModels(apiKey) });
        } catch (e) {
          const status = Number((e as { status?: number }).status) || 502;
          const host = isAnthropic ? 'Claude' : isCustomOpenAi ? (() => { try { return new URL(cleanAiBaseUrl(payload.aiBaseUrl)).hostname; } catch { return 'AI'; } })() : 'Gemini';
          const error = status === 404
            ? `${host} (404): this service does not list its models; type the model name instead`
            : aiErrorMessage(host, status, (e as Error).message || 'the model list could not be read');
          return res.status(status >= 400 && status < 600 ? status : 502).json({ error });
        }
      }

      case 'dictionary-lookup': {
        // One dictionary (`source`), or the user's dictionaries in order.
        const { word } = payload;
        if (!word || typeof word !== 'string') return res.status(400).json({ error: 'Word is required.' });
        if (word.length > 100) return res.status(400).json({ error: 'word is too long.' });
        const request = cleanDictionaryRequest(payload.dictionaries);
        const timeoutMs = lookupTimeout(payload.timeoutMs);
        const source = DICTIONARY_IDS.find(id => id === payload.source);
        try {
          const entry = source
            ? await lookupSingle(source, word, { request, timeoutMs })
            : await lookupChain(word, { request, timeoutMs });
          if (entry) return res.status(200).json(entry);
          return res.status(404).json({ error: `Could not find definition for "${word}".` });
        } catch (e) {
          return res.status(400).json({ error: (e as Error).message });
        }
      }

      case 'test-dictionary': {
        // Asks one dictionary (or the translation service) for a word it
        // certainly knows, with the key typed on the device.
        const request = cleanDictionaryRequest(payload.dictionaries);
        if (payload.source === 'mymemory') {
          const translation = await freeTranslate('good morning', undefined, request.keys?.mymemory);
          return translation
            ? res.status(200).json({ message: translation })
            : res.status(503).json({ error: 'MyMemory did not answer (or its daily quota is used up).' });
        }
        const source = DICTIONARY_IDS.find(id => id === payload.source);
        if (!source) return res.status(400).json({ error: 'Unknown dictionary.' });
        try {
          const entry = await lookupSingle(source, source === 'urban' ? 'ghosting' : source === 'wiktionary' ? 'break the ice' : 'hello', { request, timeoutMs: 6000 });
          return entry
            ? res.status(200).json({ message: entry.definitions[0] || 'ok' })
            : res.status(503).json({ error: 'The dictionary did not answer.' });
        } catch (e) {
          return res.status(400).json({ error: (e as Error).message });
        }
      }

      case 'word-frequencies': {
        const { words } = payload;
        if (!Array.isArray(words)) return res.status(400).json({ error: 'words must be an array.' });
        const frequencies = await lookupFrequencies(words.map((w: unknown) => String(w)));
        return res.status(200).json({ frequencies });
      }

      case 'free-enrich': {
        const { term } = payload;
        if (!term || typeof term !== 'string') return res.status(400).json({ error: 'term is required.' });
        if (term.length > 100) return res.status(400).json({ error: 'term is too long.' });
        const onlyIfFound = payload.onlyIfFound === true;
        const request = cleanDictionaryRequest(payload.dictionaries);
        const timeoutMs = lookupTimeout(payload.timeoutMs);
        return res.status(200).json(await cachedEnrich(term, lookupStore(), () => freeEnrich(term, undefined, onlyIfFound, request, timeoutMs), serverSignature(request)));
      }

      case 'free-translate': {
        const { text } = payload;
        if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text is required.' });
        const request = cleanDictionaryRequest(payload.dictionaries);
        return res.status(200).json({ translation: await freeTranslate(text, undefined, request.keys?.mymemory) });
      }

      case 'fetch-audio': {
        const { url } = payload;
        if (!url) return res.status(400).json({ error: 'URL is required.' });
        if (!isAllowedAudioUrl(url)) return res.status(400).json({ error: 'Audio is only fetched from dictionary sites.' });
        const audioResponse = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!audioResponse.ok) {
          const errorText = await audioResponse.text();
          return res.status(audioResponse.status).json({ error: 'Failed to fetch audio from source.', details: errorText });
        }
        const contentType = audioResponse.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
        const arrayBuffer = await audioResponse.arrayBuffer();
        return res.status(200).send(Buffer.from(arrayBuffer));
      }

      case 'auth-register': {
        const { username, password } = payload;
        if (!registrationAllowed(await anyAccountExists())) return res.status(403).json({ error: 'Registration is closed on this server. Sign in with your account instead.' });
        if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Username and password are required.' });
        if (!USERNAME_PATTERN.test(username)) return res.status(400).json({ error: 'Username must be 3-32 letters, digits, dots, dashes or underscores.' });
        if (password.length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });

        const existingUser = await getUser(username);
        if (existingUser) {
          return res.status(409).json({ error: 'Username is already taken.' });
        }

        const newUser = {
          username,
          password: await hashPassword(password),
          data: upgradeStore(null, randomUUID).store,
        };

        await setUser(newUser);
        res.setHeader('Set-Cookie', sessionCookieHeader(createSessionToken(username, secret), secure));
        return res.status(201).json({ message: 'User registered successfully.', username: username.toLowerCase() });
      }

      case 'auth-login': {
        const { username, password } = payload;
        if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
          return res.status(400).json({ error: 'Username and password are required.' });
        }
        const ip = clientIp(req);
        const lockedMinutes = loginLockMinutes(ip, username);
        if (lockedMinutes > 0) {
          return res.status(429).json({ error: `Too many failed attempts. Try again in ${lockedMinutes} minute(s).` });
        }

        const user = await getUser(username);
        const check = await verifyPassword(password, user?.password);
        if (!user || !check.ok) {
          recordLoginFailure(ip, username);
          return res.status(401).json({ error: 'Invalid username or password.' });
        }
        clearLoginFailures(ip, username);
        if (check.needsRehash) {
          user.password = await hashPassword(password); // replace a legacy plain-text password
          await setUser(user);
        }

        res.setHeader('Set-Cookie', sessionCookieHeader(createSessionToken(username, secret), secure));
        return res.status(200).json({ message: 'Login successful.', username: username.toLowerCase() });
      }

      case 'auth-session': {
        if (!signedInUser || !(await getUser(signedInUser))) return res.status(200).json({ username: null });
        return res.status(200).json({ username: signedInUser });
      }

      case 'auth-logout': {
        res.setHeader('Set-Cookie', clearSessionCookieHeader(secure));
        return res.status(200).json({ message: 'Logged out.' });
      }

      // Versions of the app from before the library sent everything at
      // once; they reload into the new version, which syncs with 'sync'.
      case 'sync-load':
      case 'sync-merge':
        return res.status(409).json({ error: 'The app was updated. Reload the page to sync.', code: 'APP_UPDATED' });

      case 'sync': {
        const since = Number.isSafeInteger(payload.since) && payload.since > 0 ? payload.since : 0;
        const result = await withUserLock(signedInUser!, async () => {
          const user = await getUser(signedInUser!);
          if (!user) return null;
          const { store, chapterTexts } = upgradeStore(user.data, randomUUID);
          const upgraded = store !== user.data;
          // Texts moved out of the record are saved before the record
          // without them, so a failure in between loses nothing.
          for (const text of chapterTexts) {
            if (!(await getKey(chapterKey(signedInUser!, text.id)))) await setKey(chapterKey(signedInUser!, text.id), packChapter(text));
          }
          // A device that knows another database, or a later rev than this
          // one has, starts over from the beginning.
          const reset = (typeof payload.storeId === 'string' && payload.storeId !== store.storeId) || since > store.rev;
          const revBefore = store.rev;
          const echo = applyChanges(store, payload.changes);
          if (upgraded || store.rev !== revBefore) {
            user.data = store;
            await setUser(user);
          }
          return { storeId: store.storeId, reset, ...changesSince(store, reset ? 0 : since, echo) };
        });
        if (!result) return res.status(401).json({ error: 'Please sign in again.', code: 'AUTH_REQUIRED' });
        return res.status(200).json(result);
      }

      // The account's AI and dictionary keys: the device sends the ones it
      // has (with when each was typed) and gets the account's, newest first.
      // Kept encrypted under their own record (server/keyVault).
      case 'keys-sync': {
        const incoming = cleanSentKeys(payload.keys);
        const keys = await withUserLock(signedInUser!, async () => {
          if (!(await getUser(signedInUser!))) return null;
          const record = await getKey(accountKeysKey(signedInUser!));
          let stored = openKeys(record, signedInUser!, secret);
          const unreadable = !stored;
          if (!stored) {
            // Sealed with another secret: kept aside, never overwritten.
            console.warn(`The saved keys of ${signedInUser} do not open with this server's secret; they are kept aside and the devices send theirs again.`);
            await setKey(`${accountKeysKey(signedInUser!)}:unreadable:${Date.now()}`, record);
            stored = {};
          }
          const { merged, changed } = mergeKeyEntries(stored, incoming);
          if (changed || unreadable) await setKey(accountKeysKey(signedInUser!), sealKeys(merged, signedInUser!, secret));
          return merged;
        });
        if (!keys) return res.status(401).json({ error: 'Please sign in again.', code: 'AUTH_REQUIRED' });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ keys });
      }

      // A chapter's text is saved under its own key, compressed: when it is
      // added, and again when the reader edits it (`editedAt`).
      case 'chapter-put': {
        const { id, sourceId, chunks } = payload;
        const editedAt = typeof payload.editedAt === 'string' && !Number.isNaN(Date.parse(payload.editedAt)) ? payload.editedAt : undefined;
        if (typeof id !== 'string' || !CHAPTER_ID.test(id) || typeof sourceId !== 'string' || !CHAPTER_ID.test(sourceId)) {
          return res.status(400).json({ error: 'A chapter id and source id are required.' });
        }
        if (!Array.isArray(chunks) || chunks.some((c: unknown) => typeof c !== 'string')) return res.status(400).json({ error: 'chunks must be a list of texts.' });
        if (chunks.reduce((n: number, c: string) => n + c.length, 0) > MAX_CHAPTER_CHARS) return res.status(413).json({ error: 'This chapter is too long to save.' });
        // An older edit arriving late does not replace a newer one.
        const stored = await getKey(chapterKey(signedInUser!, id));
        if (stored?.editedAt && (!editedAt || editedAt < stored.editedAt)) return res.status(200).json({ ok: true, kept: stored.editedAt });
        await setKey(chapterKey(signedInUser!, id), packChapter({ id, sourceId, chunks, editedAt }));
        return res.status(200).json({ ok: true });
      }

      case 'chapter-get': {
        const { id } = payload;
        if (typeof id !== 'string' || !CHAPTER_ID.test(id)) return res.status(400).json({ error: 'A chapter id is required.' });
        const text = await getKey(chapterKey(signedInUser!, id));
        if (!text) return res.status(404).json({ error: 'This chapter is not on the server yet. Open the app on the device that added it.' });
        return res.status(200).json(unpackChapter(text));
      }

      // The daily review in Telegram: whether it is set up and linked, a
      // code to link it, its settings.
      case 'telegram-status': {
        if (!telegramToken()) return res.status(200).json({ available: false });
        const state: TgLink | null = await getKey(userKey(signedInUser!));
        let bot = '';
        try { bot = await telegramDeps().botName(); } catch (e) { console.warn('Telegram getMe failed:', (e as Error).message); }
        return res.status(200).json({ available: true, bot, linked: !!state, words: state?.words ?? TG_DEFAULT_WORDS, paused: !!state?.paused });
      }

      case 'telegram-link': {
        if (!telegramToken()) return res.status(404).json({ error: 'Telegram is not set up on this server (TELEGRAM_BOT_TOKEN).' });
        const deps = telegramDeps();
        await ensureWebhook(req, secret);
        return res.status(200).json(await newLinkCode(deps, signedInUser!, cleanTz(payload.tz)));
      }

      case 'telegram-update': {
        const state: TgLink | null = await getKey(userKey(signedInUser!));
        if (!state) return res.status(404).json({ error: 'Telegram is not linked.' });
        const next: TgLink = {
          ...state,
          ...(payload.words !== undefined ? { words: clampWords(payload.words) } : {}),
          ...(typeof payload.paused === 'boolean' ? { paused: payload.paused } : {}),
          ...(payload.tz !== undefined ? { tz: cleanTz(payload.tz) } : {}),
        };
        await setKey(userKey(signedInUser!), next);
        return res.status(200).json({ linked: true, words: next.words, paused: !!next.paused });
      }

      case 'telegram-send': {
        if (!telegramToken()) return res.status(404).json({ error: 'Telegram is not set up on this server (TELEGRAM_BOT_TOKEN).' });
        return res.status(200).json({ result: await startReview(telegramDeps(), signedInUser!, true) });
      }

      case 'telegram-unlink': {
        if (telegramToken()) await unlink(telegramDeps(), signedInUser!);
        else { await delKey(userKey(signedInUser!)); }
        return res.status(200).json({ linked: false });
      }

      // How much this account keeps on the server, for the usage page.
      case 'storage-usage':
        return res.status(200).json(await storageUsage(signedInUser!));

      // The page of an article link, read by the browser into plain text.
      case 'fetch-page': {
        const { url } = payload;
        if (typeof url !== 'string' || !url) return res.status(400).json({ error: 'A link is required.' });
        try {
          return res.status(200).json(await fetchPublicPage(url));
        } catch (e) {
          if (e instanceof PageFetchError) return res.status(e.status).json({ error: e.message });
          throw e;
        }
      }

      default:
        return res.status(400).json({ message: 'Invalid or missing action.' });
    }
  } catch (error) {
    if (error instanceof BusyError) return res.status(503).json({ error: error.message, code: 'BUSY' });
    console.error(`Error in proxy action '${action}':`, error);
    const name = (error as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return res.status(504).json({ error: 'The outside service took too long to answer. Try again.' });
    }
    // Only a signed-in user sees the reason; it can name files or services.
    return res.status(500).json({ error: signedInUser ? `Server error: ${(error as Error).message}` : 'An internal server error occurred.' });
  }
}
