// File: /services/speechPractice.ts
// Pronunciation practice: what the AI is asked about a recording, how its
// answer is cleaned, and what the saved tries say about progress (scores over
// time, sounds that keep going wrong, words still weak).
//
// The AI names each problem with one of a fixed list of sound ids, so the
// same weakness is counted together across tries and days.

import type { Flashcard, Occurrence, SpeechAttempt, SpeechIssue, SpeechMark, SpeechParts } from '../types';
import { dayString } from './streakService.js';
import { isFormOf, termPattern } from './lemma.js';
import { levenshtein } from './stringSimilarity.js';

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

// --- The words of a text read aloud ---

// A text cut into its words and what lies between them, so a sentence can be
// shown with each word marked. `i` numbers the words from 0.
export interface SpeechToken { text: string; i?: number }
const SPEECH_WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export const speechTokens = (text: string): SpeechToken[] => {
  const out: SpeechToken[] = [];
  let at = 0;
  let i = 0;
  for (const m of text.matchAll(SPEECH_WORD)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[0], i: i++ });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
};

export const speechWords = (text: string): string[] => text.match(SPEECH_WORD) || [];

// Where a card's term stands in a sentence, in any form ("took … into
// account" for "take into account"): the indexes of its words, or none.
// Where a placeholder stood ("take something into account") a longer object
// is allowed too ("took the cost of the journey into account").
export const focusIndexes = (sentence: string, term: string): number[] => {
  const words = speechWords(sentence);
  const pattern = termPattern(term);
  const found = findTerm(words, pattern.words, pattern.gaps);
  return found.length || !pattern.gaps.some(g => g > 1)
    ? found
    : findTerm(words, pattern.words, pattern.gaps.map(g => (g > 1 ? 8 : g)));
};

const findTerm = (words: string[], wanted: string[], gaps: number[]): number[] => {
  if (wanted.length === 0) return [];
  for (let start = 0; start < words.length; start++) {
    if (!isFormOf(words[start], wanted[0])) continue;
    const found = [start];
    let at = start;
    for (let k = 1; k < wanted.length && found.length === k; k++) {
      // gaps[k]: how many words may stand between this word and the one before.
      for (let j = at + 1; j <= Math.min(words.length - 1, at + 1 + gaps[k]); j++) {
        if (isFormOf(words[j], wanted[k])) { found.push(j); at = j; break; }
      }
    }
    if (found.length === wanted.length) return found;
  }
  return [];
};

export const pronunciationPrompt = (target: string, kind: SpeechKind, weak: string[] = [], focus?: string): string => {
  const sounds = weak.filter(id => SOUNDS[id] && id !== 'other').slice(0, 5);
  const usual = sounds.length ? `\nThis learner often has trouble with: ${sounds.join(', ')}. Check these closely.` : '';
  const issues = `- "issues": every specific problem, most important first (empty when it was right). Each item:
  - "sound": one id from this list: ${SOUND_IDS.join(', ')}.
  - "word": the word where it happened.
  - "detail": one short Persian sentence: what you heard and how to say it right (e.g. «th را مثل "ت" گفتی؛ نوک زبان را میان دندان‌ها بگذار»).`;
  if (kind === 'word') {
    return `I am a Persian speaker learning English. The audio is my attempt at reading the word "${target}" aloud.
Listen carefully and judge it like a strict but kind pronunciation teacher. Return JSON:
- "heard": exactly what was said, word for word, spelled the way it sounded ("tink" for think said with a t, "de" for the said with a d). Do NOT correct it to match the text: leave out words that were not said and keep wrong or added ones. Empty if silence or noise.
- "score": 0-100 for how close it is to a clear standard pronunciation. Silence, noise or a different word scores below 20.
- "feedback": 1-2 short, encouraging sentences in Persian: what was good and the most important thing to fix.
- "tip": one short Persian instruction for the next try.
- "correction": the IPA of the correct pronunciation, between slashes.
${issues}
Only report problems you really hear; do not invent any. If you cannot make out clear speech, return "heard": "" and "score": 0: never guess words from noise, and never write about the audio itself (its quality, noise, silence) in "heard".${usual}`;
  }
  const words = speechWords(target);
  const at = focus ? focusIndexes(target, focus) : [];
  const focusLine = at.length
    ? `\nThe phrase I am learning in it is "${at.map(i => words[i]).join(' ')}" (word${at.length > 1 ? 's' : ''} ${at.map(i => i + 1).join(', ')}): listen to it most closely and score it alone as "focusScore".`
    : '';
  return `I am a Persian speaker learning English. The audio is my attempt at reading the sentence "${target}" aloud.
Its words, numbered: ${words.map((w, i) => `${i + 1} ${w}`).join(' | ')}${focusLine}
Listen carefully and judge the whole sentence like a strict but kind pronunciation teacher. Return JSON:
- "heard": exactly what was said, word for word, spelled the way it sounded ("tink" for think said with a t, "de" for the said with a d). Do NOT correct it to match the text: leave out words that were not said and keep wrong or added ones. Empty if silence or noise.
- "score": 0-100 overall: how clear and natural the whole sentence was. Silence, noise or a different text scores below 20.
- "parts": each 0-100: "accuracy" (the sounds of the words), "fluency" (smooth, without long pauses, restarts or hesitation), "rhythm" (word stress, sentence stress, linking and intonation), "completeness" (every word read, none added).
- "marks": one item for each word that did NOT come out right, by its number: "i" (the word's number), "status" ("unclear": understandable but off; "wrong": a different sound or word; "missed": left out), "heard" (how it sounded), "sound" (an id from the list below). Words you do not list count as right.${at.length ? '\n- "focusScore": 0-100 for the phrase I am learning alone.' : ''}
- "feedback": 2-3 short, encouraging sentences in Persian about the whole sentence: what was good, and the most important thing to fix (a sound, the stress, the rhythm or the linking).
- "tip": one short Persian instruction for the next try (e.g. «واژه‌های کوچک را کوتاه‌تر بگو و روی think تکیه کن»).
- "correction": the IPA of the words you flag, between slashes (or empty).
${issues}
Only report problems you really hear; do not invent any. If you cannot make out clear speech, return "heard": "" and "score": 0: never guess words from noise, and never write about the audio itself (its quality, noise, silence) in "heard".${usual}`;
};

// --- What was heard, against the text ---
//
// The AI also writes down what it heard, word for word. The app lines that
// up with the text itself, so a word left out or said as another word is
// marked and counted even when the AI's own judgement was too kind.

const plain = (w: string) => w.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]/gu, '');

// 1 for the same word, down to 0 for nothing alike.
export const wordLikeness = (a: string, b: string): number => {
  const x = plain(a);
  const y = plain(b);
  if (x === y) return 1;
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
};

const CLOSE = 0.6; // said, though not cleanly ("tink" for think)

export interface HeardWord { i: number; status: 'ok' | 'close' | 'wrong' | 'missed'; heard?: string }

// Each word of the text: said, said nearly, said as another word, or left
// out. Words added in between are counted apart.
export const compareHeard = (target: string, heard: string): { words: HeardWord[]; added: number } => {
  const want = speechWords(target);
  const got = speechWords(heard);
  const n = want.length;
  const m = got.length;
  // Edit distance on words: a near word costs less than a different one.
  const cost = (i: number, j: number) => {
    const like = wordLikeness(want[i], got[j]);
    return like === 1 ? 0 : like >= CLOSE ? 0.4 : 1;
  };
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost(i - 1, j - 1));
  }
  const words: HeardWord[] = [];
  let added = 0;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && Math.abs(d[i][j] - (d[i - 1][j - 1] + cost(i - 1, j - 1))) < 1e-9) {
      const like = wordLikeness(want[i - 1], got[j - 1]);
      words.push({ i: i - 1, status: like === 1 ? 'ok' : like >= CLOSE ? 'close' : 'wrong', ...(like < 1 ? { heard: got[j - 1] } : {}) });
      i--; j--;
    } else if (i > 0 && Math.abs(d[i][j] - (d[i - 1][j] + 1)) < 1e-9) {
      words.push({ i: i - 1, status: 'missed' });
      i--;
    } else {
      added++;
      j--;
    }
  }
  return { words: words.reverse(), added };
};

// The listener did not really hear a recording that has voice in it: it
// heard nothing, or it wrote about the recording instead of what was said
// ("leaked audio", "[inaudible]", "background noise"). Such an answer is
// not the learner's score and is not kept.
const ABOUT_THE_AUDIO = /\b(audio|recording|recorded|silence|silent|noise|noisy|music|inaudible|unintelligible|static|no speech|speech)\b|[[\]()]/i;

export const listenerMissed = (evaluation: Pick<Evaluation, 'heard' | 'score'>, target: string): boolean => {
  const heard = (evaluation.heard || '').trim();
  if (!heard) return evaluation.score < 20;
  const found = heard.match(ABOUT_THE_AUDIO);
  if (!found) return false;
  if (/^[[\]()]$/.test(found[0])) return true; // "[inaudible]", "(noise)"
  // A word about audio counts only when the text itself does not have it.
  return !new RegExp(`\\b${found[0]}\\b`, 'i').test(target);
};

// The AI's marks with what the comparison found added: a word left out or
// said as another word that the AI did not mark. Completeness is counted,
// and the score cannot stand far above it.
export const withHeardCheck = (evaluation: Evaluation, target: string, kind: SpeechKind): Evaluation => {
  const heard = evaluation.heard?.trim();
  if (!heard) return evaluation;
  if (kind === 'word') {
    // A different word altogether is not a near miss.
    const best = Math.max(0, ...speechWords(heard).map(w => wordLikeness(target, w)), wordLikeness(target, heard));
    return best < 0.4 ? { ...evaluation, score: Math.min(evaluation.score, 30) } : evaluation;
  }
  const n = speechWords(target).length;
  if (!n) return evaluation;
  const { words, added } = compareHeard(target, heard);
  const marks = [...(evaluation.marks || [])];
  for (const w of words) {
    if ((w.status === 'missed' || w.status === 'wrong') && !marks.some(m => m.i === w.i)) {
      marks.push({ i: w.i, status: w.status, ...(w.heard ? { heard: w.heard } : {}) });
    }
  }
  marks.sort((a, b) => a.i - b.i);
  const missed = words.filter(w => w.status === 'missed').length;
  const completeness = Math.max(0, Math.round(100 * (n - missed - Math.min(added, n) * 0.5) / n));
  return {
    ...evaluation,
    score: Math.min(evaluation.score, completeness + 15),
    parts: { ...(evaluation.parts || {}), completeness },
    ...(marks.length ? { marks } : {}),
  };
};

const PERCENT = { type: 'INTEGER' };

export const PRONUNCIATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    heard: { type: 'STRING' },
    score: PERCENT,
    feedback: { type: 'STRING' },
    tip: { type: 'STRING' },
    correction: { type: 'STRING' },
    focusScore: PERCENT,
    parts: {
      type: 'OBJECT',
      properties: { accuracy: PERCENT, fluency: PERCENT, rhythm: PERCENT, completeness: PERCENT },
    },
    marks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          i: { type: 'INTEGER' },
          status: { type: 'STRING', enum: ['unclear', 'wrong', 'missed'] },
          heard: { type: 'STRING' },
          sound: { type: 'STRING', enum: SOUND_IDS },
        },
        required: ['i', 'status'],
      },
    },
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
  tip?: string;
  focusScore?: number;
  parts?: SpeechParts;
  marks?: SpeechMark[];
  by?: string; // the service and model that listened
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const MAX_ISSUES = 6;
const percent = (v: unknown): number | undefined => {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : undefined;
};
const MARK_STATUS = new Set(['unclear', 'wrong', 'missed']);

// The AI's answer made safe to show and save: a whole score from 0 to 100,
// known sound ids, short texts. With the text that was read, word marks are
// kept only for its real words (the AI numbers them from 1).
export const cleanEvaluation = (raw: any, target?: string): Evaluation => {
  const r = raw && typeof raw === 'object' ? raw : {};
  const n = typeof r.score === 'string' && r.score.trim() === '' ? NaN : Number(r.score ?? NaN);
  // An answer without a score is no answer: it is not saved as a zero.
  if (!Number.isFinite(n)) throw new Error('The AI sent no score.');
  const score = Math.max(0, Math.min(100, Math.round(n)));
  const wordCount = target ? speechWords(target).length : 0;
  const marks: SpeechMark[] = [];
  for (const m of Array.isArray(r.marks) && wordCount ? r.marks : []) {
    const i = Math.round(Number(m?.i)) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= wordCount || marks.some(x => x.i === i)) continue;
    const status = text(m.status, 10).toLowerCase();
    if (!MARK_STATUS.has(status)) continue;
    const heard = text(m.heard, 60);
    const sound = text(m.sound, 40).toLowerCase();
    marks.push({ i, status: status as SpeechMark['status'], ...(heard ? { heard } : {}), ...(SOUNDS[sound] ? { sound } : {}) });
  }
  marks.sort((a, b) => a.i - b.i);
  const parts: SpeechParts = {};
  for (const key of ['accuracy', 'fluency', 'rhythm', 'completeness'] as const) {
    const v = percent(r.parts?.[key]);
    if (v !== undefined) parts[key] = v;
  }
  const focusScore = percent(r.focusScore);
  const tip = text(r.tip, 300);
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
    ...(tip ? { tip } : {}),
    ...(focusScore !== undefined ? { focusScore } : {}),
    ...(Object.keys(parts).length ? { parts } : {}),
    ...(marks.length ? { marks } : {}),
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
      const { heard: _h, correction: _c, tip: _t, ...rest } = a;
      return {
        ...rest,
        feedback: '',
        issues: (a.issues || []).map(i => ({ sound: i.sound, ...(i.word ? { word: i.word } : {}), detail: '' })),
        ...(a.marks ? { marks: a.marks.map(({ heard: _mh, ...m }) => m) } : {}),
        compact: true,
        updatedAt: now.toISOString(),
      };
    });
};

// --- What to practise: the sentence of a card ---

const MIN_SENTENCE_WORDS = 3;
const MAX_SENTENCE_WORDS = 25;

// A long sentence is cut to the words around the card's term, at a comma or
// a clause start where there is one, so it can be read in one breath.
export const sentenceAround = (sentence: string, term: string, max = MAX_SENTENCE_WORDS): string => {
  const tokens = speechTokens(sentence.trim());
  const count = tokens.filter(t => t.i !== undefined).length;
  if (count <= max) return sentence.trim();
  const at = focusIndexes(sentence, term);
  const centre = at.length ? Math.round((at[0] + at[at.length - 1]) / 2) : 0;
  let from = Math.max(0, Math.min(centre - Math.floor(max / 2), count - max));
  let to = from + max - 1;
  // Move the ends to a nearby comma, semicolon or dash, when the term stays in.
  const breakBefore = (i: number) => {
    const k = tokens.findIndex(t => t.i === i);
    return k > 0 && /[,;:—–(]/.test(tokens[k - 1].text);
  };
  for (let i = from; i <= Math.min(from + 6, at[0] ?? from); i++) if (breakBefore(i)) { from = i; break; }
  for (let i = to + 1; i >= Math.max(to - 6, (at[at.length - 1] ?? to) + 1); i--) if (i < count && breakBefore(i)) { to = i - 1; break; }
  const startK = tokens.findIndex(t => t.i === from);
  const endK = tokens.findIndex(t => t.i === to);
  const cut = tokens.slice(startK, endK + 1).map(t => t.text).join('').trim();
  return `${from > 0 ? '… ' : ''}${cut}${to < count - 1 ? ' …' : ''}`;
};

// The sentence a card is practised in: where the word was met in a book
// (latest first), then the card's own sentence, then its examples. Very
// short ones are skipped; long ones are cut around the word.
export const practiceSentence = (card: Pick<Flashcard, 'id' | 'front' | 'sourceSentence' | 'exampleSentenceTarget'>, occurrences: Occurrence[] = []): string => {
  const met = occurrences
    .filter(o => o.cardId === card.id && !o.isDeleted && o.sentence?.trim())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(o => o.sentence!);
  const candidates = [...met, card.sourceSentence || '', ...(card.exampleSentenceTarget || [])]
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => speechWords(s).length >= MIN_SENTENCE_WORDS);
  const withTerm = candidates.filter(s => focusIndexes(s, card.front).length > 0);
  const pick = withTerm[0] || candidates[0];
  return pick ? sentenceAround(pick, card.front) : '';
};

// --- When an item comes back (spaced pronunciation practice) ---
//
// Worked out from the tries alone, so it follows the account to every
// device. Each day an item was practised counts once, by its FIRST try that
// day: that one says what has stuck, the later ones are practice.
//   - first try of the last day below GOOD_SCORE: back the next day, or two
//     days later when it ended the day well;
//   - at or above GOOD_SCORE: 3, 7, 16, then 35 days, as such days follow in
//     a row; three in a row and it counts as settled.

export const GOOD_SCORE = 80;
const INTERVALS = [3, 7, 16, 35];
export const SETTLED_DAYS = 3;

export type SpeechStage = 'new' | 'learning' | 'reviewing' | 'settled';

export interface SpeechSchedule {
  key: string;
  cardId?: string;
  kind: SpeechKind;
  target: string;
  stage: SpeechStage;
  lastScore: number; // the latest try
  firstScoreLastDay: number; // the first try of the last practice day
  goodDays: number; // days in a row (latest back) that started at GOOD_SCORE or above
  lastDay: string;
  dueDay: string; // local YYYY-MM-DD
  tries: number;
}

const addDays = (day: string, days: number): string => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dayString(d);
};

export const scheduleFor = (key: string, list: SpeechAttempt[]): SpeechSchedule => {
  const byDay = new Map<string, SpeechAttempt[]>();
  for (const a of list) {
    const day = dayString(new Date(a.createdAt));
    byDay.set(day, [...(byDay.get(day) || []), a]);
  }
  const days = Array.from(byDay.keys()).sort();
  const firstOf = (day: string) => byDay.get(day)![0].score;
  let goodDays = 0;
  for (let k = days.length - 1; k >= 0 && firstOf(days[k]) >= GOOD_SCORE; k--) goodDays++;
  const lastDay = days[days.length - 1];
  const lastOfDay = byDay.get(lastDay)!;
  const first = lastOfDay[0].score;
  const best = Math.max(...lastOfDay.map(a => a.score));
  const interval = first >= GOOD_SCORE ? INTERVALS[Math.min(goodDays, INTERVALS.length) - 1] : best >= GOOD_SCORE ? 2 : 1;
  const last = list[list.length - 1];
  return {
    key, kind: last.kind, target: last.target, ...(last.cardId ? { cardId: last.cardId } : {}),
    stage: goodDays >= SETTLED_DAYS ? 'settled' : goodDays > 0 ? 'reviewing' : 'learning',
    lastScore: last.score, firstScoreLastDay: first, goodDays, lastDay, dueDay: addDays(lastDay, interval), tries: list.length,
  };
};

// Every item practised, with when it comes back.
export const speechSchedules = (attempts: SpeechAttempt[]): SpeechSchedule[] => {
  const by = new Map<string, SpeechAttempt[]>();
  for (const a of liveAttempts(attempts)) {
    const key = attemptKey(a);
    by.set(key, [...(by.get(key) || []), a]);
  }
  return Array.from(by.entries()).map(([key, list]) => scheduleFor(key, list));
};

// Items due today or earlier, the weakest first.
export const dueSchedules = (attempts: SpeechAttempt[], today: string = dayString(new Date())): SpeechSchedule[] =>
  speechSchedules(attempts)
    .filter(s => s.dueDay <= today)
    .sort((a, b) => a.firstScoreLastDay - b.firstScoreLastDay || a.dueDay.localeCompare(b.dueDay));

export interface SpeechItem {
  card: Flashcard;
  kind: SpeechKind;
  target: string;
  focus?: string; // the card's term, in a sentence
}

export type SpeechChoice = 'plan' | 'weak';
export const SESSION_SIZE = 6;
const NEW_PER_SESSION_ALWAYS = 2;

const shuffled = <T,>(list: T[], random: () => number): T[] => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// The items of one session.
//   plan: those due again (weakest first), then a few never practised: cards
//     being learned now (new or due in review) before the others;
//   weak: those whose latest try stayed below WEAK_SCORE, weakest first.
export const pickSpeechItems = (opts: {
  cards: Flashcard[];
  attempts: SpeechAttempt[];
  occurrences?: Occurrence[];
  kind: SpeechKind;
  choice: SpeechChoice;
  size?: number;
  now?: Date;
  random?: () => number;
}): SpeechItem[] => {
  const { cards, attempts, occurrences = [], kind, choice, size = SESSION_SIZE, now = new Date(), random = Math.random } = opts;
  const itemOf = (card: Flashcard): SpeechItem | null => {
    if (card.isDeleted || card.kind === 'grammar' || !card.front.trim()) return null;
    if (kind === 'word') return { card, kind, target: card.front.trim() };
    const target = practiceSentence(card, occurrences);
    return target ? { card, kind, target, focus: card.front.trim() } : null;
  };
  const byId = new Map(cards.map(c => [c.id, c]));
  const ofKind = attempts.filter(a => a.kind === kind);
  const fromSchedules = (list: SpeechSchedule[]) =>
    list.map(s => (s.cardId ? byId.get(s.cardId) : undefined)).filter((c): c is Flashcard => !!c).map(itemOf).filter((i): i is SpeechItem => !!i);

  if (choice === 'weak') {
    const weak = speechSchedules(ofKind).filter(s => s.lastScore < WEAK_SCORE).sort((a, b) => a.lastScore - b.lastScore);
    return fromSchedules(weak).slice(0, size);
  }
  const due = fromSchedules(dueSchedules(ofKind, dayString(now)));
  const practised = new Set(ofKind.map(a => a.cardId).filter(Boolean));
  const fresh = cards.filter(c => !practised.has(c.id));
  const learning = fresh.filter(c => c.repetition === 0 || new Date(c.dueDate).getTime() <= now.getTime());
  const others = fresh.filter(c => !learning.includes(c));
  const newItems = [...shuffled(learning, random), ...shuffled(others, random)].map(itemOf).filter((i): i is SpeechItem => !!i);
  // Reviews first; new items take the room left, and always a couple so
  // learning goes on when many are due.
  const newCount = Math.min(newItems.length, Math.max(size - due.length, NEW_PER_SESSION_ALWAYS));
  return [...due.slice(0, size - newCount), ...newItems.slice(0, newCount)];
};

// What a session leaves behind: each item's first and last score in it, and
// when it comes back.
export interface SessionItemResult {
  key: string;
  target: string;
  kind: SpeechKind;
  focus?: string;
  first: number;
  last: number;
  tries: number;
  dueDay: string;
  stage: SpeechStage;
}

export const sessionResults = (allAttempts: SpeechAttempt[], tried: SpeechAttempt[]): SessionItemResult[] => {
  const keys = Array.from(new Set(tried.map(attemptKey)));
  const schedules = new Map(speechSchedules(allAttempts).map(s => [s.key, s]));
  return keys.map(key => {
    const mine = tried.filter(a => attemptKey(a) === key);
    const s = schedules.get(key) || scheduleFor(key, mine);
    const last = mine[mine.length - 1];
    return {
      key, target: last.target, kind: last.kind, ...(last.focus ? { focus: last.focus } : {}),
      first: mine[0].score, last: last.score, tries: mine.length, dueDay: s.dueDay, stage: s.stage,
    };
  });
};
