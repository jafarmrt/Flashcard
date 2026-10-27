// File: /services/cardLookup.ts
// The user's own card for a word met in a text. Reading a book, a word that
// already has a card should show what the card says at once (no dictionary,
// no network): the meaning the user chose and is learning. The same during a
// review, for the words of the card's sentences.

import type { Flashcard } from '../types';
import { lemmaCandidates } from './lemma';
import { normalizeTerm } from './vocabMerge';

export type CardIndex = Map<string, Flashcard>;

// Grammar cards are named after a structure, not a word: they are left out.
export const indexCards = (cards: Flashcard[]): CardIndex => {
  const index: CardIndex = new Map();
  for (const card of cards) {
    if (card.isDeleted || card.kind === 'grammar') continue;
    const key = normalizeTerm(card.front);
    if (key && !index.has(key)) index.set(key, card);
  }
  return index;
};

// The card for a word as written ("decided"), or for one of its base forms
// ("decide"). A phrase is matched as a whole.
export const cardForTerm = (index: CardIndex, term: string): Flashcard | undefined => {
  const key = normalizeTerm(term);
  if (!key) return undefined;
  const exact = index.get(key);
  if (exact || key.includes(' ')) return exact;
  for (const form of lemmaCandidates(key)) {
    const card = index.get(normalizeTerm(form));
    if (card) return card;
  }
  return undefined;
};
