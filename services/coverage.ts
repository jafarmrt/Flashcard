// File: /services/coverage.ts
// How much of a book's running text the learner already knows, and how hard
// the book is. A text is read comfortably when about 95% of its words are
// known. Words count as known when they are very common (stop words), when
// they are at or below the learner's level by how often English uses them,
// when they are on the "I know it" list, or when their card has grown.
//
// A whole book can hold many thousands of different words, so only a sample
// is looked up: the most used ones, which carry most of the text, and an even
// spread of the rest, whose share stands for all of them.

import type { CefrLevel, Flashcard, KnownWord } from '../types';
import { STOPWORDS } from './freeCandidates.js';
import { isKnownTerm, knownTermSet } from './knownWords.js';
import { lemmaCandidates, tokensOf } from './lemma.js';
import { masteryStage } from './masteryService.js';
import { CEFR, learnerStep, levelOfFrequency } from './wordLevel.js';

export const HEAD_SIZE = 250;
export const TAIL_SIZE = 150; // HEAD_SIZE + TAIL_SIZE: one frequency request (at most 400 words)
export const COMFORTABLE = 0.95;

export interface WordSample {
  word: string;
  count: number; // times it is in the text
  frequency: number | null; // per million words of English; null when unknown
}

export interface BookProfile {
  tokens: number; // running words, names left out
  common: number; // of them, stop words and short forms ("don't")
  head: WordSample[]; // the most used other words
  tail: WordSample[]; // an even sample of the rest
  tailTokens: number; // running words of all the rest
  types: number; // different words, stop words left out
  at: string;
}

export interface WordCounts {
  tokens: number;
  common: number;
  counts: Map<string, number>; // other words, by count
}

// The words of a text, lower-cased. A word only ever written with a capital is
// a name and is left out; "I" and short forms ("don't", "we'll") are common;
// "mother's" counts as "mother"; "well-known" as its two parts.
export const countWords = (texts: string[]): WordCounts => {
  const lower = new Map<string, number>();
  const capital = new Map<string, number>();
  let common = 0;
  for (const text of texts) {
    for (const token of tokensOf(text)) {
      for (const part of token.split('-')) {
        if (!part) continue;
        const apostrophe = part.search(/['’]/);
        let word = part;
        if (apostrophe > 0) {
          const suffix = part.slice(apostrophe + 1).toLowerCase();
          if (suffix !== 's') { common++; continue; }
          word = part.slice(0, apostrophe);
        }
        const key = word.toLowerCase();
        if (key === 'i' || STOPWORDS.has(key)) { common++; continue; }
        if (key.length < 2) continue;
        const target = /^\p{Lu}/u.test(word) ? capital : lower;
        target.set(key, (target.get(key) || 0) + 1);
      }
    }
  }
  const counts = new Map(lower);
  // Capitalised at the start of a sentence, lower-case elsewhere: a word.
  for (const [key, n] of capital) if (lower.has(key)) counts.set(key, (counts.get(key) || 0) + n);
  let tokens = common;
  for (const n of counts.values()) tokens += n;
  return { tokens, common, counts };
};

// The words to look up: the most used, then an even spread of the rest.
export const sampleWords = (counts: Map<string, number>): { head: [string, number][]; tail: [string, number][]; tailTokens: number } => {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = sorted.slice(0, HEAD_SIZE);
  const rest = sorted.slice(HEAD_SIZE);
  const tailTokens = rest.reduce((n, [, c]) => n + c, 0);
  if (rest.length <= TAIL_SIZE) return { head, tail: rest, tailTokens };
  const step = rest.length / TAIL_SIZE;
  const tail = Array.from({ length: TAIL_SIZE }, (_, i) => rest[Math.floor(i * step)]);
  return { head, tail, tailTokens };
};

export type FrequencyLookup = (words: string[]) => Promise<Record<string, number | null>>;

export const buildProfile = async (texts: string[], lookup: FrequencyLookup, now: Date = new Date()): Promise<BookProfile> => {
  const { tokens, common, counts } = countWords(texts);
  const { head, tail, tailTokens } = sampleWords(counts);
  const words = [...head, ...tail].map(([w]) => w);
  const frequencies = words.length ? await lookup(words) : {};
  const sample = ([word, count]: [string, number]): WordSample => ({ word, count, frequency: frequencies[word] ?? null });
  return { tokens, common, head: head.map(sample), tail: tail.map(sample), tailTokens, types: counts.size, at: now.toISOString() };
};

// Why a word is known, or null.
export type KnownBy = 'level' | 'card' | 'list' | null;

export interface Coverage {
  percent: number; // of running words, 0-100
  unknownPer300: number; // unknown words in a 300-word section
  byLevel: number; // percent known by level alone (and stop words)
  personal: number; // percent more known from cards and the "I know it" list
  textLevel: CefrLevel | 'C2+'; // the lowest level that reads it comfortably
  verdict: 'easy' | 'fits' | 'stretch' | 'hard';
}

const atOrBelow = (frequency: number | null, step: CefrLevel): boolean => {
  const level = levelOfFrequency(frequency);
  return !!level && CEFR.indexOf(level) <= CEFR.indexOf(step);
};

// The share of running words known, by a rule for each sampled word.
const shareKnown = (p: BookProfile, known: (s: WordSample) => boolean): number => {
  if (p.tokens === 0) return 1;
  let knownTokens = p.common;
  for (const s of p.head) if (known(s)) knownTokens += s.count;
  const tailSampled = p.tail.reduce((n, s) => n + s.count, 0);
  if (tailSampled > 0) {
    const tailKnown = p.tail.reduce((n, s) => n + (known(s) ? s.count : 0), 0);
    knownTokens += p.tailTokens * (tailKnown / tailSampled);
  }
  return knownTokens / p.tokens;
};

export const textLevelOf = (p: BookProfile): CefrLevel | 'C2+' =>
  CEFR.find(step => shareKnown(p, s => atOrBelow(s.frequency, step)) >= COMFORTABLE) || 'C2+';

export const coverageOf = (p: BookProfile, userLevel: string | undefined, knownBy: (word: string) => 'card' | 'list' | null): Coverage => {
  const step = learnerStep(userLevel);
  const byLevel = shareKnown(p, s => atOrBelow(s.frequency, step));
  const all = shareKnown(p, s => atOrBelow(s.frequency, step) || knownBy(s.word) !== null);
  const percent = Math.round(all * 1000) / 10;
  return {
    percent,
    unknownPer300: Math.round((1 - all) * 300),
    byLevel: Math.round(byLevel * 1000) / 10,
    personal: Math.round((all - byLevel) * 1000) / 10,
    textLevel: textLevelOf(p),
    verdict: all >= 0.98 ? 'easy' : all >= COMFORTABLE ? 'fits' : all >= 0.9 ? 'stretch' : 'hard',
  };
};

// A word is the learner's own when its card has grown (it stays in memory
// for 10 days or more) or it is on the "I know it" list, in any form.
export const GROWN_STAGE = 3;

export const knownByFrom = (cards: Flashcard[], knownRows: KnownWord[]): ((word: string) => 'card' | 'list' | null) => {
  const grown = new Set<string>();
  for (const c of cards) {
    if (c.isDeleted || c.kind === 'grammar' || masteryStage(c) < GROWN_STAGE) continue;
    const front = c.front.trim().toLowerCase();
    if (front && !/\s/.test(front)) grown.add(front);
  }
  const list = knownTermSet(knownRows);
  return (word: string) => {
    if (grown.size && lemmaCandidates(word).some(form => grown.has(form))) return 'card';
    if (list.size && isKnownTerm(word, list)) return 'list';
    return null;
  };
};

export const VERDICT_TEXT: Record<Coverage['verdict'], string> = {
  easy: 'آسان؛ برای روان‌خوانی خوب است.',
  fits: 'مناسب سطح تو؛ واژه‌های تازه کم و قابل‌حدس‌اند.',
  stretch: 'کمی بالاتر از سطحت؛ با کارت ساختن خوب پیش می‌رود.',
  hard: 'سخت؛ واژه‌های ناآشنا زیادند. پیش‌مطالعهٔ هر فصل کمک می‌کند.',
};

// --- Kept on this device, per book ---

const storageKey = (sourceId: string) => `bookProfile:v1:${sourceId}`;

export const savedProfile = (sourceId: string): BookProfile | null => {
  try {
    const raw = localStorage.getItem(storageKey(sourceId));
    return raw ? (JSON.parse(raw) as BookProfile) : null;
  } catch {
    return null;
  }
};

export const saveProfile = (sourceId: string, profile: BookProfile): void => {
  try {
    localStorage.setItem(storageKey(sourceId), JSON.stringify(profile));
  } catch {
    // Storage full or blocked: the profile is computed again next time.
  }
};
