import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyChanges, changesSince, upgradeStore, StoreData } from '../server/syncStore';
import { handleProxy, ProxyResponse } from '../server/api';
import { createSessionToken } from '../server/auth';
import { migrateTexts } from '../services/library';
import { checkPublicUrl, fetchPublicPage, isPrivateAddress } from '../server/pageFetch';
import { packChapter, unpackChapter } from '../server/chapterText';

let ids = 0;
const newId = () => `store-${++ids}`;
const T0 = '2026-10-01T10:00:00.000Z';
const T1 = '2026-10-02T10:00:00.000Z';
const T2 = '2026-10-03T10:00:00.000Z';

const card = (id: string, extra: object = {}) => ({
  id, deckId: 'd1', front: id, back: 'معنی', repetition: 0, easinessFactor: 2.5, interval: 0,
  dueDate: T0, createdAt: T0, updatedAt: T0, ...extra,
});

const fresh = (): StoreData => upgradeStore(null, newId).store;

test('a device gets only what changed since its last sync, never its own rows back', () => {
  const store = fresh();
  const echoA = applyChanges(store, { cards: [card('a'), card('b')] });
  const toA = changesSince(store, 0, echoA);
  assert.equal(toA.changes.cards, undefined, 'device A already has its cards');
  const revA = toA.rev;

  const toB = changesSince(store, 0, null);
  assert.deepEqual(toB.changes.cards?.map(c => c.id).sort(), ['a', 'b']);
  assert.ok(toB.changes.cards!.every(c => !('_rev' in c)), 'revs stay on the server');

  applyChanges(store, { cards: [card('a', { back: 'تازه', updatedAt: T1 })] });
  const later = changesSince(store, revA, null);
  assert.deepEqual(later.changes.cards?.map(c => [c.id, c.back]), [['a', 'تازه']]);
  assert.equal(changesSince(store, later.rev, null).changes.cards, undefined, 'nothing new after that');
});

test('an unchanged row sent again does not count as a change', () => {
  const store = fresh();
  applyChanges(store, { cards: [card('a')] });
  const rev = store.rev;
  applyChanges(store, { cards: [card('a')] });
  assert.equal(store.rev, rev);
});

test('the newer edit wins, deletes stick and finished sections add up', () => {
  const store = fresh();
  applyChanges(store, {
    cards: [card('a', { back: 'new', updatedAt: T2 })],
    chapters: [{ id: 'c1', sourceId: 's', order: 1, title: 'One', chunkCount: 5, wordCount: 900, completed: [0, 1], createdAt: T0, updatedAt: T1 }],
  });
  const echo = applyChanges(store, {
    cards: [card('a', { back: 'old', updatedAt: T1, isDeleted: true })],
    chapters: [{ id: 'c1', sourceId: 's', order: 1, title: 'One', chunkCount: 5, wordCount: 900, completed: [3], createdAt: T0, updatedAt: T0 }],
  });
  const a = store.cards.find(c => c.id === 'a')!;
  assert.equal(a.back, 'new');
  assert.equal(a.isDeleted, true);
  assert.deepEqual(store.chapters[0].completed, [0, 1, 3]);
  assert.ok(!echo.rows.has('cards:a'), 'the device gets the merged card back');
});

test('the first download comes in pages', () => {
  const store = fresh();
  applyChanges(store, { cards: Array.from({ length: 7 }, (_, i) => card(`c${i}`)) });
  const seen: string[] = [];
  let since = 0;
  for (let round = 0; round < 10; round++) {
    const page = changesSince(store, since, null, 3);
    seen.push(...(page.changes.cards || []).map(c => c.id));
    since = page.rev;
    if (!page.more) break;
  }
  assert.equal(seen.length, 7);
  assert.equal(new Set(seen).size, 7);
});

test('study logs are kept once per review, whichever device sends them', () => {
  const store = fresh();
  applyChanges(store, { studyHistory: [{ id: 1, uid: 'u1', cardId: 'a', date: '2026-10-01', rating: 'GOOD' }] });
  applyChanges(store, { studyHistory: [{ id: 7, uid: 'u1', cardId: 'a', date: '2026-10-01', rating: 'GOOD' }, { uid: 'u2', cardId: 'a', date: '2026-10-02', rating: 'HARD' }] });
  assert.equal(store.studyHistory.length, 2);
  assert.ok(store.studyHistory.every(l => l.id === undefined), 'device-local ids are dropped');
});

test('sound data stays on the device that made it', () => {
  const store = fresh();
  applyChanges(store, { cards: [card('a', { audioSrc: 'data:audio/mpeg;base64,AAAA' }), card('b', { audioSrc: 'https://api.dictionaryapi.dev/media/b.mp3' })] });
  assert.equal(store.cards.find(c => c.id === 'a')!.audioSrc, undefined);
  assert.equal(store.cards.find(c => c.id === 'b')!.audioSrc, 'https://api.dictionaryapi.dev/media/b.mp3');
});

const legacyText = {
  id: 'text-1', title: 'The Gift', deckName: 'The Gift', createdAt: T0, updatedAt: T1, completed: [0],
  chunks: ['She decided to leave early. The wind was cold.', 'He took off his coat and sat down.'],
};
const legacyDecks = [{ id: 'd1', name: 'The Gift' }];
const legacyCards = [
  card('k1', { front: 'decide', sourceSentence: 'She decided to leave early.' }),
  card('k2', { front: 'take off' }),
  card('k3', { front: 'unrelated' }),
];

test('old texts move into the library the same way on the server and in the browser', () => {
  const { store, chapterTexts } = upgradeStore({
    decks: legacyDecks, cards: [...legacyCards, card('k4', { audioSrc: 'data:audio/mpeg;base64,AAAA' })],
    studyHistory: [{ id: 3, cardId: 'k1', date: '2026-10-01', rating: 'GOOD' }],
    userProfile: { id: 1, xp: 40, level: 1, lastStreakCheck: '' }, userAchievements: [], texts: [legacyText],
  }, newId);

  assert.equal(store.version, 2);
  assert.equal((store as any).texts, undefined, 'the chunks leave the account record');
  assert.deepEqual(store.sources.map(s => [s.id, s.kind, s.deckId]), [['text-1', 'text', 'd1']]);
  assert.deepEqual(store.chapters.map(c => [c.id, c.completed, c.chunkCount]), [['text-1-c1', [0], 2]]);
  assert.deepEqual(chapterTexts, [{ id: 'text-1-c1', sourceId: 'text-1', chunks: legacyText.chunks }]);
  assert.deepEqual(store.occurrences.map(o => [o.cardId, o.chunk, o.sentence]).sort(), [
    ['k1', 0, 'She decided to leave early.'],
    ['k2', 1, 'He took off his coat and sat down.'],
  ]);
  assert.equal(store.cards.find(c => c.id === 'k4')!.audioSrc, undefined);
  assert.equal(new Set([...store.cards, ...store.occurrences, ...store.studyHistory].map(r => r._rev)).size,
    store.cards.length + store.occurrences.length + store.studyHistory.length, 'every row has its own rev');

  const browser = migrateTexts([legacyText as any], legacyDecks as any, legacyCards as any);
  const strip = (rows: any[]) => rows.map(({ _rev, ...r }) => r);
  assert.deepEqual(strip(store.sources), browser.sources);
  assert.deepEqual(strip(store.chapters), browser.chapters);
  assert.deepEqual(strip(store.occurrences).sort((a, b) => a.id.localeCompare(b.id)), [...browser.occurrences].sort((a, b) => a.id.localeCompare(b.id)));
});

// --- Through the API ---

const setupServer = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-sync-'));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = 's'.repeat(40);
  delete process.env.KV_REST_API_URL;
  delete process.env.ALLOW_REGISTRATION;
  return dir;
};

const call = async (body: object, user?: string) => {
  const out: { status: number; body: any } = { status: 0, body: null };
  const res: ProxyResponse = {
    status(code) { out.status = code; return res; },
    json(b) { out.body = b; return b; },
    send(b) { out.body = b; return b; },
    setHeader() { return undefined; },
  };
  const headers: Record<string, string> = {};
  if (user) headers.cookie = `lc_session=${createSessionToken(user, process.env.SESSION_SECRET!)}`;
  await (handleProxy as any)({ body, headers }, res);
  return out;
};

test('two devices sync through the server, and chapter texts travel apart', async () => {
  setupServer();
  assert.equal((await call({ action: 'auth-register', username: 'jafar', password: 'long-enough-password' })).status, 201);

  const a1 = await call({ action: 'sync', since: 0, changes: { cards: [card('x1')], sources: [{ id: 's1', kind: 'book', title: 'Emma', deckId: 'd1', createdAt: T0, updatedAt: T0 }] } }, 'jafar');
  assert.equal(a1.status, 200);
  assert.equal(a1.body.reset, false);
  assert.equal(a1.body.changes.cards, undefined);

  assert.equal((await call({ action: 'chapter-put', id: 's1-c1', sourceId: 's1', chunks: ['Emma Woodhouse, handsome, clever, and rich.'] }, 'jafar')).status, 200);

  const b1 = await call({ action: 'sync', since: 0, changes: {} }, 'jafar');
  assert.deepEqual(b1.body.changes.cards.map((c: any) => c.id), ['x1']);
  assert.deepEqual(b1.body.changes.sources.map((s: any) => s.title), ['Emma']);
  assert.equal(b1.body.storeId, a1.body.storeId);

  const text = await call({ action: 'chapter-get', id: 's1-c1' }, 'jafar');
  assert.deepEqual(text.body.chunks, ['Emma Woodhouse, handsome, clever, and rich.']);
  assert.equal((await call({ action: 'chapter-get', id: 'nope-c1' }, 'jafar')).status, 404);

  // A device that knew another database starts over.
  const stale = await call({ action: 'sync', since: 3, storeId: 'another-db', changes: {} }, 'jafar');
  assert.equal(stale.body.reset, true);
  assert.deepEqual(stale.body.changes.cards.map((c: any) => c.id), ['x1']);

  // The app from before the library is told to reload.
  assert.equal((await call({ action: 'sync-merge', data: {} }, 'jafar')).status, 409);
  assert.equal((await call({ action: 'sync', since: 0 })).status, 401, 'signed-out devices get nothing');
});

test('an account saved before the library is upgraded on its first sync', async () => {
  const dir = setupServer();
  fs.writeFileSync(path.join(dir, '.data_store.json'), JSON.stringify({
    'user:old': { username: 'old', password: 'x', data: { decks: legacyDecks, cards: legacyCards, studyHistory: [], userProfile: null, userAchievements: [], texts: [legacyText] } },
  }));
  const res = await call({ action: 'sync', since: 0, changes: {} }, 'old');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.changes.sources.map((s: any) => s.id), ['text-1']);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.data_store.json'), 'utf-8'));
  assert.equal(saved['user:old'].data.version, 2);
  assert.deepEqual(unpackChapter(saved['chapter:old:text-1-c1']).chunks, legacyText.chunks);
  assert.equal(saved['chapter:old:text-1-c1'].chunks, undefined, 'kept compressed');
  assert.equal((await call({ action: 'chapter-get', id: 'text-1-c1' }, 'old')).body.chunks.length, 2);
});

test('the "I know it" list syncs between devices, and a store saved before it gets the table', async () => {
  const { store } = upgradeStore({ ...upgradeStore(null, newId).store, knownWords: undefined }, newId);
  assert.deepEqual(store.knownWords, []);

  setupServer();
  assert.equal((await call({ action: 'auth-register', username: 'jafar', password: 'long-enough-password' })).status, 201);
  const row = { id: 'k1', term: 'take into account', createdAt: T0, updatedAt: T0 };
  assert.equal((await call({ action: 'sync', since: 0, changes: { knownWords: [row] } }, 'jafar')).status, 200);
  const other = await call({ action: 'sync', since: 0, changes: {} }, 'jafar');
  assert.deepEqual(other.body.changes.knownWords, [row]);

  // Taken off the list on one device: gone everywhere, and a new row for
  // the same term (added again later) lives.
  const removed = { ...row, isDeleted: true, updatedAt: T1 };
  await call({ action: 'sync', since: other.body.rev, changes: { knownWords: [removed, { ...row, id: 'k2', createdAt: T2, updatedAt: T2 }] } }, 'jafar');
  const later = await call({ action: 'sync', since: 0, changes: { knownWords: [row] } }, 'jafar');
  const byId = Object.fromEntries(later.body.changes.knownWords.map((k: any) => [k.id, k]));
  assert.equal(byId.k1.isDeleted, true, 'an old copy cannot bring it back');
  assert.equal(byId.k2.isDeleted, undefined);
});

test('chapter texts are kept compressed, and older plain ones are still read', async () => {
  const chunks = Array.from({ length: 5 }, (_, i) => `Section ${i}. ${'It is a truth universally acknowledged. '.repeat(60)}`);
  const packed = packChapter({ id: 'c', sourceId: 's', chunks });
  assert.ok(packed.gz!.length < JSON.stringify(chunks).length / 5, 'much smaller');
  assert.deepEqual(unpackChapter(packed), { id: 'c', sourceId: 's', chunks });
  assert.deepEqual(unpackChapter({ id: 'c', sourceId: 's', chunks: ['plain'] }).chunks, ['plain']);

  const dir = setupServer();
  await call({ action: 'auth-register', username: 'jafar', password: 'long-enough-password' });
  assert.equal((await call({ action: 'chapter-put', id: 's1-c1', sourceId: 's1', chunks }, 'jafar')).status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.data_store.json'), 'utf-8'));
  assert.equal(typeof saved['chapter:jafar:s1-c1'].gz, 'string');
  assert.deepEqual((await call({ action: 'chapter-get', id: 's1-c1' }, 'jafar')).body.chunks, chunks);
});

test('only public web pages are fetched for articles', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.5', '172.20.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '100.100.1.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '192.0.78.9', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);

  const lookup = async (host: string) => (host === 'inside.example' ? ['10.0.0.5'] : ['93.184.216.34']);
  await assert.rejects(checkPublicUrl('http://inside.example/a', lookup), /public internet/);
  await assert.rejects(checkPublicUrl('file:///etc/passwd', lookup), /http and https/);
  await assert.rejects(checkPublicUrl('http://site.example:8080/', lookup), /standard web ports/);

  // A redirect to a private address is not followed.
  const redirecting = (async () => new Response(null, { status: 302, headers: { location: 'http://inside.example/secret' } })) as typeof fetch;
  await assert.rejects(fetchPublicPage('https://site.example/post', redirecting, lookup), /public internet/);

  const page = (async () => new Response('<html><body><p>Hi</p></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })) as typeof fetch;
  assert.deepEqual(await fetchPublicPage('https://site.example/post', page, lookup), { url: 'https://site.example/post', html: '<html><body><p>Hi</p></body></html>' });
});
