// File: /services/gloss.ts
// A word's meaning written small above it in the book, from the user's own
// card, while the card is new: the reader sees it without stopping, and it
// goes away by itself once the word is learned. One gloss per card in a
// section (its first place), so a page does not fill with them.

import type { Flashcard } from '../types';
import { cardForTerm, type CardIndex } from './cardLookup';
import { masteryStage } from './masteryService';

export type GlossMode = 'off' | 'new' | 'learning';
export const MAX_GLOSS_CHARS = 18;

// The first, shortest sense of a Persian meaning: "بی‌میل، اکراه‌دار (به کاری)" → "بی‌میل".
export const shortMeaning = (back: string): string => {
  const first = back
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/[،,;؛/|\n]| - /)[0]
    .replace(/\s+/g, ' ')
    .trim();
  return first.length > MAX_GLOSS_CHARS ? `${first.slice(0, MAX_GLOSS_CHARS - 1).trimEnd()}…` : first;
};

// The highest stage that still gets a gloss: "new" until the card's first
// days are behind it, "learning" until it is familiar.
const maxStage = (mode: GlossMode) => (mode === 'learning' ? 2 : 1);

// For each word of a section, the gloss to write above it, if any.
// `isKnown`: words on the "I know it" list are never glossed.
export const glossesFor = (words: { i: number; text: string }[], index: CardIndex, mode: GlossMode, isKnown: (word: string) => boolean): (string | undefined)[] => {
  const out: (string | undefined)[] = new Array(words.length);
  if (mode === 'off') return out;
  const seen = new Set<string>();
  for (const w of words) {
    if (isKnown(w.text)) continue;
    const card: Flashcard | undefined = cardForTerm(index, w.text);
    if (!card || seen.has(card.id) || !card.back || masteryStage(card) > maxStage(mode)) continue;
    seen.add(card.id);
    const meaning = shortMeaning(card.back);
    if (meaning) out[w.i] = meaning;
  }
  return out;
};
