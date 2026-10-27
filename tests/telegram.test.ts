import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampWords, handleUpdate, localDay, localHour, newLinkCode, pickTelegramCards, questionText, runDaily, startReview, userKey,
  type TgDeps, type TgLink,
} from '../server/telegram';
import { applyChanges, upgradeStore, type StoreData, type SyncChanges } from '../server/syncStore';

const NOW = new Date('2026-10-27T05:00:00Z'); // 08:30 in Tehran (+210 minutes)
const TEHRAN = 210;
const DAY = 86_400_000;

const card = (id: string, front: string, over: Record<string, unknown> = {}) => ({
  id, deckId: 'd', front, back: `meaning of ${front}`, repetition: 0, easinessFactor: 2.5, interval: 0,
  dueDate: NOW.toISOString(), createdAt: `2026-10-0${id.length}T00:00:00Z`, updatedAt: '2026-10-01T00:00:00Z', ...over,
});
const learned = (id: string, front: string, dueOffsetDays: number) =>
  card(id, front, { repetition: 2, interval: 5, stability: 5, difficulty: 5, lastReviewed: new Date(NOW.getTime() - 5 * DAY).toISOString(), dueDate: new Date(NOW.getTime() + dueOffsetDays * DAY).toISOString() });

// An in-memory store, account data and a Telegram that records what was sent.
const setup = (cards: any[]) => {
  const kv = new Map<string, any>();
  const { store } = upgradeStore(null, () => 'store-1');
  applyChanges(store, {
    cards,
    sources: [{ id: 's1', title: 'Test Book', updatedAt: 'x' }],
    occurrences: [{ id: 'o1', cardId: 'c1', sourceId: 's1', sentence: 'She was reluctant to leave.', updatedAt: 'x' }],
  } as SyncChanges);
  const data: { store: StoreData } = { store };
  const sent: { method: string; body: any }[] = [];
  let now = NOW;
  const deps: TgDeps = {
    get: async k => (kv.has(k) ? JSON.parse(JSON.stringify(kv.get(k))) : null),
    set: async (k, v) => { kv.set(k, JSON.parse(JSON.stringify(v))); },
    del: async k => { kv.delete(k); },
    keys: async prefix => Array.from(kv.keys()).filter(k => k.startsWith(prefix)),
    readData: async () => JSON.parse(JSON.stringify(data.store)),
    changeData: async (_u, make) => {
      const changes = make(data.store);
      if (!changes) return false;
      applyChanges(data.store, changes);
      return true;
    },
    api: async (method, body) => { sent.push({ method, body }); return {}; },
    botName: async () => 'LinguaTestBot',
    now: () => now,
  };
  return { kv, data, sent, deps, setNow: (d: Date) => { now = d; } };
};

const lastMessage = (env: ReturnType<typeof setup>) => env.sent.filter(s => s.method === 'sendMessage').at(-1)!.body.text as string;

const link = async (env: ReturnType<typeof setup>, chatId = 42) => {
  const { code, link: url } = await newLinkCode(env.deps, 'Ann', TEHRAN);
  assert.equal(url, `https://t.me/LinguaTestBot?start=${code}`);
  await handleUpdate(env.deps, { message: { chat: { id: chatId }, text: `/start ${code}` } });
};

test('the day\'s words: due ones first, then new ones, then the soonest; 5 to 10 of them', () => {
  const cards = [learned('c9', 'later', 4), card('c22', 'fresh'), learned('c3', 'overdue', -3), learned('c4', 'today', 0), card('g', 'grammar', { kind: 'grammar' }), card('x', 'gone', { isDeleted: true })];
  assert.deepEqual(pickTelegramCards(cards, 5, NOW).map(c => c.front), ['overdue', 'today', 'fresh', 'later']);
  assert.equal(clampWords(2), 5);
  assert.equal(clampWords(30), 10);
  assert.equal(clampWords('x'), 7);
});

test('the user\'s own day and hour come from the device offset', () => {
  assert.equal(localDay(new Date('2026-10-27T21:00:00Z'), TEHRAN), '2026-10-28');
  assert.equal(localHour(NOW, TEHRAN), 8);
});

test('a question shows the word in its book sentence, in bold, with the book', () => {
  const text = questionText(card('c1', 'reluctant'), { sentence: 'She was reluctant <to> leave.', title: 'Test Book' }, 2, 7);
  assert.match(text, /<b>reluctant<\/b>/);
  assert.match(text, /She was <b>reluctant<\/b> &lt;to&gt; leave\./);
  assert.match(text, /— Test Book/);
  assert.match(text, /۲ از ۷/);
});

test('linking with a one-time code, then a review answered from the buttons reaches the account', async () => {
  const env = setup([card('c1', 'reluctant'), card('c22', 'house')]);
  await link(env);
  const state: TgLink = env.kv.get(userKey('ann'));
  assert.equal(state.chatId, 42);
  assert.equal(env.kv.get('tg:chat:42'), 'ann');
  assert.match(env.sent.at(-1)!.body.text, /وصل شدی/);
  assert.equal([...env.kv.keys()].filter(k => k.startsWith('tg:code:')).length, 0, 'the code is used up');

  assert.equal(await startReview(env.deps, 'ann', false), 'sent');
  const question = env.sent.at(-1)!;
  assert.match(question.body.text, /reluctant/);
  assert.match(question.body.text, /She was <b>reluctant<\/b> to leave\./);
  assert.equal(question.body.reply_markup.inline_keyboard[0][0].callback_data, 's:c1');
  assert.equal(await startReview(env.deps, 'ann', false), 'skipped', 'once a day');

  const message = { chat: { id: 42 }, message_id: 7 };
  await handleUpdate(env.deps, { callback_query: { id: 'q1', data: 's:c1', message } });
  const shown = env.sent.find(s => s.method === 'editMessageText')!;
  assert.match(shown.body.text, /meaning of reluctant/);
  const buttons = shown.body.reply_markup.inline_keyboard[0];
  assert.deepEqual(buttons.map((b: any) => b.callback_data), ['r:1:c1', 'r:2:c1', 'r:3:c1', 'r:4:c1']);
  assert.match(buttons[0].text, /دوباره · ۱۰ دقیقه/);

  await handleUpdate(env.deps, { callback_query: { id: 'q2', data: 'r:3:c1', message } });
  const stored = env.data.store.cards.find(c => c.id === 'c1')!;
  assert.equal(stored.repetition, 1);
  assert.ok(stored.interval >= 1);
  assert.equal(stored.updatedAt, NOW.toISOString());
  assert.equal(env.data.store.studyHistory.length, 1);
  assert.equal(env.data.store.studyHistory[0].date, '2026-10-27');
  assert.ok(stored._rev! > 0, 'a new rev: devices get it on their next sync');
  assert.match(lastMessage(env), /house/, 'the next card follows');

  // A second tap on the same rating does nothing.
  await handleUpdate(env.deps, { callback_query: { id: 'q3', data: 'r:3:c1', message } });
  assert.equal(env.data.store.studyHistory.length, 1);
  assert.match(env.sent.at(-1)!.body.text ?? '', /قبلاً/);
});

test('"Again" brings the card back once at the end of the day\'s list, then the review ends', async () => {
  const env = setup([card('c1', 'reluctant')]);
  await link(env);
  await startReview(env.deps, 'ann', true);
  const message = { chat: { id: 42 }, message_id: 1 };
  await handleUpdate(env.deps, { callback_query: { id: 'a', data: 'r:1:c1', message } });
  assert.match(lastMessage(env), /reluctant/, 'asked again');
  await handleUpdate(env.deps, { callback_query: { id: 'b', data: 'r:1:c1', message } });
  assert.match(lastMessage(env), /تمام شد: ۲ پاسخ/, 'not a third time');
  assert.equal(env.data.store.studyHistory.length, 2);
});

test('the daily run waits for the local hour, skips paused accounts, and ignores strangers', async () => {
  const env = setup([card('c1', 'reluctant')]);
  await link(env);
  env.setNow(new Date('2026-10-27T03:00:00Z')); // 06:30 in Tehran
  assert.equal(await runDaily(env.deps), 0);
  assert.equal(await runDaily(env.deps, true), 1, 'the once-a-day cron does not wait');

  await handleUpdate(env.deps, { message: { chat: { id: 42 }, text: '/stop' } });
  env.setNow(new Date(NOW.getTime() + DAY));
  assert.equal(await runDaily(env.deps), 0);

  const before = env.sent.length;
  await handleUpdate(env.deps, { callback_query: { id: 'z', data: 'r:3:c1', message: { chat: { id: 99 }, message_id: 1 } } });
  assert.equal(env.data.store.studyHistory.length, 0, 'another chat cannot rate this account\'s cards');
  assert.equal(env.sent.length, before + 1);
});

test('an expired or unknown code does not link', async () => {
  const env = setup([]);
  const { code } = await newLinkCode(env.deps, 'ann', 0);
  env.setNow(new Date(NOW.getTime() + 20 * 60_000));
  await handleUpdate(env.deps, { message: { chat: { id: 5 }, text: `/start ${code}` } });
  assert.equal(env.kv.get(userKey('ann')), undefined);
  assert.match(env.sent.at(-1)!.body.text, /معتبر نیست/);
});
