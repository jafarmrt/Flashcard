// File: /services/speechPractice.ts
// Pronunciation practice: what the AI is asked about a recording, how its
// answer is cleaned, and what the saved tries say about progress (scores over
// time, sounds that keep going wrong, words still weak).
//
// The AI names each problem with one of a fixed list of sound ids, so the
// same weakness is counted together across tries and days.

import type { SpeechAttempt, SpeechIssue } from '../types';
import { dayString } from './streakService.js';

export interface SoundInfo {
  label: string; // Persian name
  ipa: string;
  example: string; // English words that have it
  tip: string; // Persian: how to make it
}

// Sounds and habits that usually trouble Persian speakers, plus a catch-all.
export const SOUNDS: Record<string, SoundInfo> = {
  'th-voiceless': { label: 'صدای th بی‌واک', ipa: 'θ', example: 'think, three', tip: 'نوک زبان را میان دندان‌ها بگذار و بی‌آنکه حنجره بلرزد فوت کن؛ «ت» یا «س» نگو.' },
  'th-voiced': { label: 'صدای th واک‌دار', ipa: 'ð', example: 'this, mother', tip: 'نوک زبان میان دندان‌ها، و این بار حنجره بلرزد؛ «د» یا «ز» نگو.' },
  w: { label: 'صدای w', ipa: 'w', example: 'win, quick', tip: 'لب‌ها را گرد و جلو بیاور و دندان به لب نزن؛ «و» فارسی (v) نیست.' },
  v: { label: 'صدای v', ipa: 'v', example: 'very, give', tip: 'دندان‌های بالا را آرام روی لب پایین بگذار و صدا بده.' },
  ae: { label: 'مصوت æ', ipa: 'æ', example: 'cat, bad', tip: 'دهان را بازتر از «اِ» و کمی کشیده‌تر از «اَ» فارسی کن.' },
  'short-i': { label: 'مصوت کوتاه ɪ', ipa: 'ɪ', example: 'ship, sit', tip: 'کوتاه و شل، میان «ای» و «اِ»؛ آن را مثل «ای» کشیده نگو.' },
  'long-i': { label: 'مصوت بلند iː', ipa: 'iː', example: 'sheep, see', tip: 'کشیده‌تر و با لب‌های کمی کشیده، مثل «ای» بلند.' },
  'short-u': { label: 'مصوت کوتاه ʊ', ipa: 'ʊ', example: 'book, put', tip: 'کوتاه و شل، نه «او» کشیده.' },
  'long-u': { label: 'مصوت بلند uː', ipa: 'uː', example: 'food, blue', tip: 'لب‌ها گرد و کشیده، مثل «او» بلند.' },
  uh: { label: 'مصوت ʌ', ipa: 'ʌ', example: 'cup, love', tip: 'کوتاه و از وسط دهان، نزدیک «اَ» ولی بی‌آنکه دهان زیاد باز شود.' },
  er: { label: 'مصوت ɜː', ipa: 'ɜː', example: 'bird, work', tip: 'دهان نیمه‌باز و زبان در وسط؛ نه «اِر» و نه «اُر».' },
  schwa: { label: 'مصوت خنثی ə', ipa: 'ə', example: 'about, teacher', tip: 'هجای بی‌تکیه را کوتاه و شل بگو؛ همهٔ حرف‌ها را کامل ادا نکن.' },
  'o-vowels': { label: 'مصوت‌های ɒ و ɔː', ipa: 'ɒ ɔː', example: 'hot, law', tip: 'لب‌ها کمی گرد؛ آن را با «اُ» کوتاه فارسی یکی نکن.' },
  diphthong: { label: 'مصوت‌های دوگانه', ipa: 'eɪ aɪ oʊ aʊ ɔɪ', example: 'day, go, now', tip: 'از یک مصوت به دیگری بلغز: day «دِی»، go «گُئو»؛ آن را یک‌تکه نگو.' },
  ng: { label: 'صدای ng', ipa: 'ŋ', example: 'sing, long', tip: 'پشت زبان را به سقف نرم دهان بچسبان و «گ» پایانی را نگو.' },
  r: { label: 'صدای r', ipa: 'r', example: 'red, very', tip: 'زبان را عقب ببر و نلرزان؛ «ر» غلتان فارسی نیست. در لهجهٔ بریتانیایی r پایانی گفته نمی‌شود.' },
  'dark-l': { label: 'صدای l پایانی', ipa: 'ɫ', example: 'feel, milk', tip: 'در پایان واژه، پشت زبان را هم کمی بالا ببر تا l «پُر» شود.' },
  'cluster-start': { label: 'خوشهٔ صامت آغازی', ipa: 'sp st str', example: 'school, street', tip: 'پیش از s یا میان صامت‌ها مصوت نگذار: school نه «اِسکول».' },
  'cluster-end': { label: 'صامت‌های پایانی', ipa: 'sts kt nd', example: 'tests, asked', tip: 'همهٔ صامت‌های پایان واژه را بگو و چیزی از آخرش نینداز.' },
  'final-voicing': { label: 'صامت واک‌دار پایانی', ipa: 'b d g z', example: 'bad, dog, his', tip: 'صامت پایانی را بی‌واک نکن: bad نه «بَت».' },
  silent: { label: 'حرف بی‌صدا', ipa: '', example: 'knife, listen', tip: 'هر حرفی خوانده نمی‌شود؛ تلفظ واژه را بشنو و حرف بی‌صدا را نگو.' },
  stress: { label: 'تکیهٔ واژه', ipa: '', example: 'photograph, record', tip: 'هجای تکیه‌دار را بلندتر و کشیده‌تر بگو؛ جای تکیه معنا را هم عوض می‌کند.' },
  rhythm: { label: 'ریتم و آهنگ جمله', ipa: '', example: 'I want to go.', tip: 'واژه‌های مهم را پررنگ و واژه‌های کوچک (to, a, the) را کوتاه بگو.' },
  linking: { label: 'پیوند واژه‌ها', ipa: '', example: 'turn it off', tip: 'صامت پایانی را به مصوت واژهٔ بعد بچسبان و میان واژه‌ها نایست.' },
  'wrong-word': { label: 'واژهٔ جاافتاده یا اشتباه', ipa: '', example: '', tip: 'متن را آرام و کامل بخوان؛ هیچ واژه‌ای را نینداز یا عوض نکن.' },
  other: { label: 'نکتهٔ دیگر', ipa: '', example: '', tip: '' },
};

export const SOUND_IDS = Object.keys(SOUNDS);
export const soundInfo = (id: string): SoundInfo => SOUNDS[id] || SOUNDS.other;

export type SpeechKind = SpeechAttempt['kind'];

export const pronunciationPrompt = (target: string, kind: SpeechKind, weak: string[] = []): string => {
  const what = kind === 'sentence' ? `the sentence "${target}"` : `the word "${target}"`;
  const focus = weak.filter(id => SOUNDS[id] && id !== 'other').slice(0, 5);
  return `I am a Persian speaker learning English. The audio is my attempt at reading ${what} aloud.
Listen carefully and judge it like a strict but kind pronunciation teacher. Return JSON:
- "heard": what you actually heard, written in English letters (empty if silence or noise).
- "score": 0-100 for how close it is to a clear standard pronunciation. Silence, noise or a different ${kind === 'sentence' ? 'text' : 'word'} scores below 20.
- "feedback": 1-2 short, encouraging sentences in Persian: what was good and the most important thing to fix.
- "correction": the IPA of the correct pronunciation${kind === 'sentence' ? ' of the words you flag (or empty)' : ''}, between slashes.
- "issues": every specific problem, most important first (empty when it was right). Each item:
  - "sound": one id from this list: ${SOUND_IDS.join(', ')}.
  - "word": the word where it happened.
  - "detail": one short Persian sentence: what you heard and how to say it right (e.g. «th را مثل "ت" گفتی؛ نوک زبان را میان دندان‌ها بگذار»).
Only report problems you really hear; do not invent any.${focus.length ? `\nThis learner often has trouble with: ${focus.join(', ')}. Check these closely.` : ''}`;
};

export const PRONUNCIATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    heard: { type: 'STRING' },
    score: { type: 'INTEGER' },
    feedback: { type: 'STRING' },
    correction: { type: 'STRING' },
    issues: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sound: { type: 'STRING', enum: SOUND_IDS },
          word: { type: 'STRING' },
          detail: { type: 'STRING' },
        },
        required: ['sound', 'detail'],
      },
    },
  },
  required: ['score', 'feedback', 'issues'],
};

export interface Evaluation {
  score: number;
  heard?: string;
  feedback: string;
  correction?: string;
  issues: SpeechIssue[];
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const MAX_ISSUES = 6;

// The AI's answer made safe to show and save: a whole score from 0 to 100,
// known sound ids, short texts.
export const cleanEvaluation = (raw: any): Evaluation => {
  const r = raw && typeof raw === 'object' ? raw : {};
  const n = typeof r.score === 'string' && r.score.trim() === '' ? NaN : Number(r.score ?? NaN);
  // An answer without a score is no answer: it is not saved as a zero.
  if (!Number.isFinite(n)) throw new Error('The AI sent no score.');
  const score = Math.max(0, Math.min(100, Math.round(n)));
  const issues: SpeechIssue[] = (Array.isArray(r.issues) ? r.issues : [])
    .map((i: any): SpeechIssue | null => {
      if (!i || typeof i !== 'object') return null;
      const detail = text(i.detail, 300);
      const id = text(i.sound, 40).toLowerCase();
      if (!detail && !SOUNDS[id]) return null;
      const word = text(i.word, 80);
      return { sound: SOUNDS[id] ? id : 'other', ...(word ? { word } : {}), detail };
    })
    .filter((i: SpeechIssue | null): i is SpeechIssue => !!i)
    .slice(0, MAX_ISSUES);
  const heard = text(r.heard, 400);
  const correction = text(r.correction, 200);
  return {
    score,
    ...(heard ? { heard } : {}),
    feedback: text(r.feedback, 600),
    ...(correction ? { correction } : {}),
    issues,
  };
};

export const newAttempt = (
  target: string, kind: SpeechKind, evaluation: Evaluation, cardId?: string,
  now: Date = new Date(), id: string = crypto.randomUUID(),
): SpeechAttempt => ({
  id,
  ...(cardId ? { cardId } : {}),
  target: target.trim(),
  kind,
  ...evaluation,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});

// Live tries, oldest first.
export const liveAttempts = (attempts: SpeechAttempt[]): SpeechAttempt[] =>
  attempts.filter(a => !a.isDeleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

// One item practised: a card read as a word or as its sentence, or a text
// without a card.
export const attemptKey = (a: Pick<SpeechAttempt, 'cardId' | 'target' | 'kind'>) =>
  `${a.cardId || a.target.toLowerCase()}|${a.kind}`;

export const attemptsFor = (attempts: SpeechAttempt[], key: string): SpeechAttempt[] =>
  liveAttempts(attempts).filter(a => attemptKey(a) === key);

export interface WeakSound {
  sound: string;
  count: number; // tries (in the window) where it went wrong
  share: number; // count / tries in the window, 0-1
  words: string[]; // where, most recent first
  lastAt: string;
}

// Sounds that went wrong in the last `window` tries, most frequent first.
// A sound counts once per try; one that went wrong in fewer than `minCount`
// tries is left out.
export const weakSounds = (attempts: SpeechAttempt[], window = 40, minCount = 1): WeakSound[] => {
  const recent = liveAttempts(attempts).slice(-window);
  const by = new Map<string, WeakSound>();
  for (const a of [...recent].reverse()) {
    const seen = new Set<string>();
    for (const issue of a.issues || []) {
      if (issue.sound === 'other') continue;
      let w = by.get(issue.sound);
      if (!w) { w = { sound: issue.sound, count: 0, share: 0, words: [], lastAt: a.createdAt }; by.set(issue.sound, w); }
      if (!seen.has(issue.sound)) { w.count++; seen.add(issue.sound); }
      const word = (issue.word || a.target).trim();
      if (word && !w.words.some(x => x.toLowerCase() === word.toLowerCase()) && w.words.length < 6) w.words.push(word);
    }
  }
  return Array.from(by.values())
    .filter(w => w.count >= minCount)
    .map(w => ({ ...w, share: recent.length ? w.count / recent.length : 0 }))
    .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
};

export interface DayScore { day: string; average: number; count: number }

// The average score of each day with practice, the latest `days` of them.
export const dailyScores = (attempts: SpeechAttempt[], days = 14): DayScore[] => {
  const by = new Map<string, { sum: number; count: number }>();
  for (const a of liveAttempts(attempts)) {
    const day = dayString(new Date(a.createdAt));
    const d = by.get(day) || { sum: 0, count: 0 };
    d.sum += a.score; d.count++;
    by.set(day, d);
  }
  return Array.from(by.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-days)
    .map(([day, d]) => ({ day, average: Math.round(d.sum / d.count), count: d.count }));
};

export interface SpeechSummary {
  total: number;
  recentAverage: number | null; // the last `size` tries
  previousAverage: number | null; // the `size` before them
  change: number | null; // recent - previous
  practisedItems: number;
}

const average = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

export const speechSummary = (attempts: SpeechAttempt[], size = 10): SpeechSummary => {
  const live = liveAttempts(attempts);
  const recentAverage = average(live.slice(-size).map(a => a.score));
  // Compared only once there are `size` earlier tries to compare with.
  const previousAverage = live.length >= 2 * size ? average(live.slice(-2 * size, -size).map(a => a.score)) : null;
  return {
    total: live.length,
    recentAverage,
    previousAverage,
    change: recentAverage !== null && previousAverage !== null ? recentAverage - previousAverage : null,
    practisedItems: new Set(live.map(attemptKey)).size,
  };
};

export interface ItemProgress {
  key: string;
  cardId?: string;
  target: string;
  kind: SpeechKind;
  scores: number[]; // oldest first
  first: number;
  last: number;
  best: number;
  lastAt: string;
  lastIssues: SpeechIssue[];
}

// Every item practised, the most recently practised first.
export const itemProgress = (attempts: SpeechAttempt[]): ItemProgress[] => {
  const by = new Map<string, SpeechAttempt[]>();
  for (const a of liveAttempts(attempts)) {
    const key = attemptKey(a);
    by.set(key, [...(by.get(key) || []), a]);
  }
  return Array.from(by.entries())
    .map(([key, list]) => {
      const last = list[list.length - 1];
      const scores = list.map(a => a.score);
      return {
        key, target: last.target, kind: last.kind, ...(last.cardId ? { cardId: last.cardId } : {}),
        scores, first: scores[0], last: last.score, best: Math.max(...scores),
        lastAt: last.createdAt, lastIssues: last.issues || [],
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
};

export const WEAK_SCORE = 75;

// Cards whose latest try (word or sentence) scored below `threshold`,
// the weakest first.
export const weakCardIds = (attempts: SpeechAttempt[], threshold = WEAK_SCORE): string[] =>
  itemProgress(attempts)
    .filter(p => p.cardId && p.last < threshold)
    .sort((a, b) => a.last - b.last)
    .map(p => p.cardId as string)
    .filter((id, i, all) => all.indexOf(id) === i);

// Sound ids worth telling the AI to listen for: the ones that went wrong in
// at least two of the recent tries.
export const focusSounds = (attempts: SpeechAttempt[]): string[] =>
  weakSounds(attempts, 30, 2).map(w => w.sound);

// Tries beyond the latest `keep` lose their long texts (feedback, what was
// heard, each problem's explanation) but keep the score, the sound ids and
// the words, so the progress page still counts them while the account's
// record on the server stays small. Returns the rows to write back.
export const KEEP_FULL_ATTEMPTS = 200;
export const compactAttempts = (attempts: SpeechAttempt[], keep = KEEP_FULL_ATTEMPTS, now: Date = new Date()): SpeechAttempt[] => {
  const live = liveAttempts(attempts);
  return live.slice(0, Math.max(0, live.length - keep))
    .filter(a => !a.compact)
    .map(a => {
      const { heard: _h, correction: _c, ...rest } = a;
      return {
        ...rest,
        feedback: '',
        issues: (a.issues || []).map(i => ({ sound: i.sound, ...(i.word ? { word: i.word } : {}), detail: '' })),
        compact: true,
        updatedAt: now.toISOString(),
      };
    });
};
