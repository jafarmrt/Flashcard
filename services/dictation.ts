// File: /services/dictation.ts
// Listening from the books: a sentence where a word you are learning was
// met is read aloud, and you write what you hear. Reading teaches the eye;
// this teaches the ear the same words, in sentences you already know the
// meaning of. The written answer is lined up with the sentence word by
// word (services/speechPractice compareHeard), as a spoken one is.

import type { Flashcard, Occurrence } from '../types';
import { compareHeard, focusIndexes, practiceSentence, speechWords, type HeardWord } from './speechPractice.js';
import { isNewCard } from './srsService.js';

export interface DictationItem { cardId: string; front: string; back: string; sentence: string }

const MIN_WORDS = 5;
const MAX_WORDS = 20; // longer is a memory test, not a listening one

// Cards being learned that were met in a book, each in its sentence (a long
// one cut around the word), the least stable first, then mixed.
export const pickDictation = (cards: Flashcard[], occurrences: Occurrence[], count = 6, random: () => number = Math.random): DictationItem[] => {
  const met = new Set(occurrences.filter(o => !o.isDeleted && o.sentence?.trim()).map(o => o.cardId));
  const pool = cards
    .filter(c => !c.isDeleted && c.kind !== 'grammar' && !isNewCard(c) && met.has(c.id))
    .sort((a, b) => (a.stability ?? a.interval) - (b.stability ?? b.interval))
    .slice(0, count * 3);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out: DictationItem[] = [];
  const seen = new Set<string>();
  for (const card of pool) {
    if (out.length >= count) break;
    const sentence = practiceSentence(card, occurrences.filter(o => !o.isDeleted)).replace(/^…\s*|\s*…$/g, '');
    const n = speechWords(sentence).length;
    if (n < MIN_WORDS || n > MAX_WORDS || seen.has(sentence) || focusIndexes(sentence, card.front).length === 0) continue;
    seen.add(sentence);
    out.push({ cardId: card.id, front: card.front, back: card.back, sentence });
  }
  return out;
};

export interface DictationResult {
  words: HeardWord[]; // each word of the sentence: written right, nearly, as another word, or left out
  score: number; // 0-100
  focusOk: boolean; // the card's own word was written right (or nearly)
}

export const checkDictation = (item: Pick<DictationItem, 'sentence' | 'front'>, typed: string): DictationResult => {
  const { words, added } = compareHeard(item.sentence, typed);
  const n = Math.max(1, words.length);
  const got = words.reduce((sum, w) => sum + (w.status === 'ok' ? 1 : w.status === 'close' ? 0.6 : 0), 0);
  const score = Math.max(0, Math.round(((got - added * 0.5) / n) * 100));
  const focus = new Set(focusIndexes(item.sentence, item.front));
  const focusOk = focus.size > 0 && words.filter(w => focus.has(w.i)).every(w => w.status === 'ok' || w.status === 'close');
  return { words, score, focusOk };
};
