// File: /server/telegram.ts
// A daily review of 5-10 of the user's own words in Telegram. The bot sends
// one card at a time (the word and the sentence of the book it was met in);
// a button shows the meaning, four buttons rate it as in the app, and the
// rating goes into the account's data with a new rev, so every device gets
// the new schedule on its next sync.
//
// The account is linked once: the app asks for a one-time code, and the user
// opens the bot with it (t.me/<bot>?start=<code>). Everything the bot keeps
// is under `tg:` keys in the same store as the accounts.
//
// Storage, the user's data and the Telegram API come in as `TgDeps`, so this
// file has no knowledge of Redis or files and can be tested with fakes.

import { randomUUID, randomBytes } from 'crypto';
import { calculateSrs, isDue, isNewCard, previewIntervals, RELEARN_STEP_MINUTES } from '../services/srsService.js';
import type { Flashcard, PerformanceRating, StudyLog } from '../types';
import type { StoreData, SyncChanges } from './syncStore';

export const TG_MIN_WORDS = 5;
export const TG_MAX_WORDS = 10;
export const TG_DEFAULT_WORDS = 7;
// On a server that checks every few minutes (VPS), the day's words go out at
// this local hour. On Vercel the daily cron decides (vercel.json).
export const TG_SEND_HOUR = 8;
const CODE_MINUTES = 15;
// A card answered "Again" comes back once more at the end of the day's list.
const MAX_REPEATS = 1;

export interface TgLink {
  chatId: number;
  words: number;
  paused?: boolean;
  tz: number; // minutes east of UTC, from the user's device
  day?: string; // the user's local day of `queue`
  queue?: string[]; // card ids of the day's review
  pos?: number; // the card being asked
  repeats?: string[]; // cards already sent again today
  answered?: number;
  linkedAt: string;
}

type Row = Record<string, any>;

export interface TgDeps {
  get(key: string): Promise<any | null>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
  readData(username: string): Promise<StoreData | null>;
  // Applies the changes `make` returns to the user's data, under the user's lock.
  changeData(username: string, make: (data: StoreData) => SyncChanges | null): Promise<boolean>;
  api(method: string, body: Record<string, unknown>): Promise<any>; // the Telegram Bot API
  botName(): Promise<string>;
  now(): Date;
}

export const userKey = (username: string) => `tg:user:${username.toLowerCase()}`;
const chatKey = (chatId: number) => `tg:chat:${chatId}`;
const codeKey = (code: string) => `tg:code:${code}`;

export const clampWords = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(TG_MAX_WORDS, Math.max(TG_MIN_WORDS, v)) : TG_DEFAULT_WORDS;
};
export const cleanTz = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && Math.abs(v) <= 14 * 60 ? v : 0;
};

// The user's calendar day and hour, from the offset of their device.
const shifted = (now: Date, tz: number) => new Date(now.getTime() + tz * 60_000);
export const localDay = (now: Date, tz: number): string => shifted(now, tz).toISOString().slice(0, 10);
export const localHour = (now: Date, tz: number): number => shifted(now, tz).getUTCHours();

// --- Which cards ---

// Cards due first (the most overdue first), then new cards in the order they
// were made, then the ones coming due soonest: the day always has its few
// words while there are cards at all. Grammar cards want a written answer
// and stay in the app.
export const pickTelegramCards = (cards: Row[], words: number, now: Date): Row[] => {
  const live = cards.filter(c => c && !c.isDeleted && c.kind !== 'grammar' && c.front && c.back) as Flashcard[];
  const byDue = (a: Flashcard, b: Flashcard) => a.dueDate.localeCompare(b.dueDate);
  const due = live.filter(c => !isNewCard(c) && isDue(c, now)).sort(byDue);
  const fresh = live.filter(c => isNewCard(c)).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const later = live.filter(c => !isNewCard(c) && !isDue(c, now)).sort(byDue);
  return [...due, ...fresh, ...later].slice(0, clampWords(words));
};

// --- Messages ---

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const faNum = (n: number | string) => String(n).replace(/\d/g, d => FA_DIGITS[Number(d)]);
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

export const intervalText = (days: number): string => {
  if (days <= 0) return `${faNum(RELEARN_STEP_MINUTES)} دقیقه`;
  if (days < 30) return `${faNum(days)} روز`;
  if (days < 365) return `${faNum(Math.round(days / 30))} ماه`;
  return `${faNum(Math.round((days / 365) * 10) / 10)} سال`;
};

const RATING_NAME: Record<PerformanceRating, string> = { AGAIN: 'دوباره', HARD: 'سخت', GOOD: 'خوب', EASY: 'آسان' };
const RATINGS: PerformanceRating[] = ['AGAIN', 'HARD', 'GOOD', 'EASY'];

// The sentence of a book the word was met in, and the book's title.
export const placeOf = (data: Pick<StoreData, 'occurrences' | 'sources'>, card: Row): { sentence: string; title?: string } => {
  const met = (data.occurrences || []).find(o => o && !o.isDeleted && o.cardId === card.id && o.sentence);
  if (met) {
    const source = (data.sources || []).find(s => s.id === met.sourceId && !s.isDeleted);
    return { sentence: met.sentence, title: source?.title };
  }
  const own = card.sourceSentence || (Array.isArray(card.exampleSentenceTarget) ? card.exampleSentenceTarget[0] : card.exampleSentenceTarget) || '';
  return { sentence: own };
};

// The word in its sentence, in bold.
const boldIn = (sentence: string, word: string): string => {
  const plain = esc(sentence);
  const w = word.trim().split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, '');
  if (!w || w.length < 2) return plain;
  const re = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\p{L}*)`, 'iu');
  return plain.replace(re, '<b>$1</b>');
};

export const questionText = (card: Row, place: { sentence: string; title?: string }, n: number, total: number): string => {
  const head = [`<b>${esc(card.front)}</b>`, [card.pronunciation, card.partOfSpeech].filter(Boolean).map(esc).join(' · ')].filter(Boolean).join('   ');
  const lines = [head];
  if (place.sentence) lines.push('', `<i>${boldIn(clip(place.sentence, 400), String(card.front))}</i>`);
  if (place.title) lines.push(`— ${esc(place.title)}`);
  lines.push('', `${faNum(n)} از ${faNum(total)}`);
  return lines.join('\n');
};

export const answerText = (card: Row): string => {
  const lines = ['', `<b>${esc(card.back)}</b>`];
  const def = Array.isArray(card.definition) ? card.definition[0] : card.definition;
  if (def) lines.push(esc(clip(String(def), 200)));
  if (card.notes) lines.push(esc(clip(String(card.notes), 300)));
  return lines.join('\n');
};

const showButton = (id: string) => ({ inline_keyboard: [[{ text: 'معنی را نشان بده', callback_data: `s:${id}` }]] });
const rateButtons = (card: Flashcard, now: Date) => {
  const days = previewIntervals(card, now);
  return { inline_keyboard: [RATINGS.map((r, i) => ({ text: `${RATING_NAME[r]} · ${intervalText(days[r])}`, callback_data: `r:${i + 1}:${card.id}` }))] };
};

// --- Linking ---

export const newLinkCode = async (deps: TgDeps, username: string, tz: number): Promise<{ code: string; link: string; bot: string }> => {
  const code = randomBytes(9).toString('base64url');
  await deps.set(codeKey(code), { username: username.toLowerCase(), tz: cleanTz(tz), exp: deps.now().getTime() + CODE_MINUTES * 60_000 });
  const bot = await deps.botName();
  return { code, link: `https://t.me/${bot}?start=${code}`, bot };
};

const link = async (deps: TgDeps, chatId: number, code: string) => {
  const entry = await deps.get(codeKey(code));
  if (!entry || typeof entry.username !== 'string' || entry.exp < deps.now().getTime()) {
    await deps.api('sendMessage', { chat_id: chatId, text: 'این کد دیگر معتبر نیست. در برنامه، تنظیمات › تلگرام، دوباره «وصل کردن» را بزن.' });
    return;
  }
  await deps.del(codeKey(code));
  const before: TgLink | null = await deps.get(userKey(entry.username));
  if (before && before.chatId !== chatId) await deps.del(chatKey(before.chatId));
  const next: TgLink = { chatId, words: before?.words ?? TG_DEFAULT_WORDS, tz: entry.tz, linkedAt: deps.now().toISOString() };
  await deps.set(userKey(entry.username), next);
  await deps.set(chatKey(chatId), entry.username);
  await deps.api('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML',
    text: `به حساب <b>${esc(entry.username)}</b> وصل شدی.\n\nهر روز ${faNum(next.words)} واژه از کارت‌هایت این‌جا می‌آید؛ اول واژه و جمله‌اش در کتاب، با یک دکمه معنی، و بعد مثل برنامه امتیاز می‌دهی.\n\n/review همین حالا مرور کن\n/stop مرور روزانه را نفرست\n/resume دوباره بفرست`,
  });
};

export const unlink = async (deps: TgDeps, username: string): Promise<void> => {
  const current: TgLink | null = await deps.get(userKey(username));
  if (!current) return;
  await deps.del(userKey(username));
  await deps.del(chatKey(current.chatId));
  await deps.api('sendMessage', { chat_id: current.chatId, text: 'اتصال این گفت‌وگو به برنامه برداشته شد.' }).catch(() => undefined);
};

// --- The day's review ---

const findCard = (data: StoreData, id: string): Flashcard | undefined =>
  (data.cards as Row[]).find(c => c.id === id && !c.isDeleted) as Flashcard | undefined;

const sendCurrent = async (deps: TgDeps, username: string, state: TgLink, data?: StoreData | null): Promise<void> => {
  const store = data ?? (await deps.readData(username));
  const queue = state.queue || [];
  let pos = state.pos ?? 0;
  // A card deleted since the list was made is passed over.
  while (store && pos < queue.length && !findCard(store, queue[pos])) pos++;
  if (pos !== (state.pos ?? 0)) { state.pos = pos; await deps.set(userKey(username), state); }
  if (!store || pos >= queue.length) { await sendDone(deps, state); return; }
  const card = findCard(store, queue[pos])!;
  await deps.api('sendMessage', {
    chat_id: state.chatId, parse_mode: 'HTML',
    text: questionText(card, placeOf(store, card), pos + 1, queue.length),
    reply_markup: showButton(card.id),
  });
};

const sendDone = (deps: TgDeps, state: TgLink) =>
  deps.api('sendMessage', {
    chat_id: state.chatId,
    text: state.answered
      ? `مرور امروز تمام شد: ${faNum(state.answered)} پاسخ. برنامه در همگام‌سازی بعدی زمان‌بندی تازه را می‌گیرد.`
      : 'امروز کارتی برای مرور نیست. در برنامه یک بخش از کتابت را بخوان تا واژه‌های تازه پیدا شود.',
  });

// Starts the day's review, or (when one is under way) asks its current card
// again. `force`: the user asked (/review, "send now"); otherwise one review
// a day at most.
export const startReview = async (deps: TgDeps, username: string, force: boolean): Promise<'sent' | 'resumed' | 'empty' | 'skipped' | 'unlinked'> => {
  const state: TgLink | null = await deps.get(userKey(username));
  if (!state) return 'unlinked';
  const now = deps.now();
  const day = localDay(now, state.tz);
  const underWay = state.day === day && (state.pos ?? 0) < (state.queue?.length ?? 0);
  if (underWay) {
    if (!force) return 'skipped';
    await sendCurrent(deps, username, state);
    return 'resumed';
  }
  if (state.day === day && !force) return 'skipped';
  const data = await deps.readData(username);
  const cards = data ? pickTelegramCards(data.cards, state.words, now) : [];
  const next: TgLink = { ...state, day, queue: cards.map(c => c.id), pos: 0, repeats: [], answered: 0 };
  await deps.set(userKey(username), next);
  if (cards.length === 0) {
    if (force) await sendDone(deps, next);
    return 'empty';
  }
  await deps.api('sendMessage', { chat_id: state.chatId, text: `مرور امروز: ${faNum(cards.length)} واژه از کارت‌هایت.` });
  await sendCurrent(deps, username, next, data);
  return 'sent';
};

// Every linked account whose day has not had its review yet. `anyHour`: the
// once-a-day cron (Vercel), which does not wait for the local hour.
export const runDaily = async (deps: TgDeps, anyHour = false): Promise<number> => {
  let sent = 0;
  const now = deps.now();
  for (const key of await deps.keys('tg:user:')) {
    const username = key.slice('tg:user:'.length);
    try {
      const state: TgLink | null = await deps.get(key);
      if (!state || state.paused) continue;
      if (!anyHour && localHour(now, state.tz) < TG_SEND_HOUR) continue;
      if ((await startReview(deps, username, false)) === 'sent') sent++;
    } catch (e) {
      console.warn(`Telegram review for ${username} failed:`, (e as Error).message);
    }
  }
  return sent;
};

// --- Updates from Telegram ---

const answerCallback = (deps: TgDeps, id: string, text?: string) =>
  deps.api('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) }).catch(() => undefined);

const rate = async (deps: TgDeps, username: string, state: TgLink, cardId: string, rating: PerformanceRating, message: { chatId: number; messageId: number }) => {
  const queue = state.queue || [];
  const pos = state.pos ?? 0;
  if (queue[pos] !== cardId) return 'stale' as const;
  const now = deps.now();
  let shown: { card: Flashcard; next: Flashcard } | null = null;
  await deps.changeData(username, data => {
    const card = findCard(data, cardId);
    if (!card) return null;
    const next: Flashcard = { ...calculateSrs(card, rating, now), updatedAt: now.toISOString() };
    shown = { card, next };
    const log: StudyLog = { uid: randomUUID(), cardId, date: localDay(now, state.tz), rating };
    return { cards: [next as Row as any], studyHistory: [log] };
  });
  const done = shown as { card: Flashcard; next: Flashcard } | null;
  if (done) {
    const data = await deps.readData(username);
    const place = data ? placeOf(data, done.card) : { sentence: '' };
    await deps.api('editMessageText', {
      chat_id: message.chatId, message_id: message.messageId, parse_mode: 'HTML',
      text: `${questionText(done.card, place, pos + 1, queue.length)}\n${answerText(done.card)}\n\n✓ ${RATING_NAME[rating]} · دوباره ${rating === 'AGAIN' ? 'امروز' : `در ${intervalText(done.next.interval)}`}`,
    }).catch(() => undefined);
  }
  const repeats = state.repeats || [];
  const again = rating === 'AGAIN' && repeats.filter(id => id === cardId).length < MAX_REPEATS;
  const next: TgLink = {
    ...state,
    pos: pos + 1,
    queue: again ? [...queue, cardId] : queue,
    repeats: again ? [...repeats, cardId] : repeats,
    answered: (state.answered || 0) + (done ? 1 : 0),
  };
  await deps.set(userKey(username), next);
  await sendCurrent(deps, username, next);
  return 'ok' as const;
};

export const handleUpdate = async (deps: TgDeps, update: any): Promise<void> => {
  const callback = update?.callback_query;
  if (callback) {
    const chatId = callback.message?.chat?.id;
    const username: string | null = typeof chatId === 'number' ? await deps.get(chatKey(chatId)) : null;
    if (!username) { await answerCallback(deps, callback.id, 'این گفت‌وگو به حسابی وصل نیست.'); return; }
    const state: TgLink | null = await deps.get(userKey(username));
    if (!state || state.chatId !== chatId) { await answerCallback(deps, callback.id, 'این گفت‌وگو به حسابی وصل نیست.'); return; }
    const [kind, a, b] = String(callback.data || '').split(':');
    const message = { chatId, messageId: callback.message.message_id };
    if (kind === 's' && a) {
      const data = await deps.readData(username);
      const card = data && findCard(data, a);
      if (!card) { await answerCallback(deps, callback.id, 'این کارت دیگر نیست.'); return; }
      const queue = state.queue || [];
      await deps.api('editMessageText', {
        chat_id: chatId, message_id: message.messageId, parse_mode: 'HTML',
        text: `${questionText(card, placeOf(data!, card), (state.pos ?? 0) + 1, queue.length || 1)}\n${answerText(card)}`,
        reply_markup: queue[state.pos ?? 0] === card.id ? rateButtons(card, deps.now()) : undefined,
      });
      await answerCallback(deps, callback.id);
      return;
    }
    if (kind === 'r' && b) {
      const rating = RATINGS[Number(a) - 1];
      if (!rating) { await answerCallback(deps, callback.id); return; }
      const result = await rate(deps, username, state, b, rating, message);
      await answerCallback(deps, callback.id, result === 'stale' ? 'این کارت قبلاً جواب داده شده.' : undefined);
      return;
    }
    await answerCallback(deps, callback.id);
    return;
  }

  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const text: string = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (typeof chatId !== 'number' || !text) return;
  const [command, arg] = text.split(/\s+/);
  const name = command.replace(/@\w+$/, '').toLowerCase();
  if (name === '/start' && arg) { await link(deps, chatId, arg); return; }
  const username: string | null = await deps.get(chatKey(chatId));
  if (!username) {
    await deps.api('sendMessage', { chat_id: chatId, text: 'سلام. برای مرور روزانهٔ واژه‌هایت، در برنامهٔ Lingua Cards به تنظیمات › تلگرام برو و «وصل کردن» را بزن.' });
    return;
  }
  const state: TgLink | null = await deps.get(userKey(username));
  if (!state) return;
  if (name === '/review' || text === 'مرور') { await startReview(deps, username, true); return; }
  if (name === '/stop' || name === '/resume') {
    await deps.set(userKey(username), { ...state, paused: name === '/stop' });
    await deps.api('sendMessage', { chat_id: chatId, text: name === '/stop' ? 'مرور روزانه فرستاده نمی‌شود. /resume برای ادامه؛ /review هر وقت خواستی.' : 'مرور روزانه دوباره فرستاده می‌شود.' });
    return;
  }
  await deps.api('sendMessage', { chat_id: chatId, text: '/review مرور واژه‌های امروز\n/stop مرور روزانه را نفرست\n/resume دوباره بفرست' });
};
