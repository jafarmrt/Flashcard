// File: /services/vocabMerge.ts
// Merges extraction results of several text sections and flags terms that
// already have a card, so the same word is never offered twice.

import { Collocation, ExtractedWordCard } from '../types';

// Key used to compare terms: lower case, no surrounding punctuation, no leading
// article or "to", single spaces. "To Take Into Account." -> "take into account".
export const normalizeTerm = (term: string): string =>
  term
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(to|a|an|the) /, '')
    .trim();

const mergeCollocations = (a: Collocation[] = [], b: Collocation[] = []): Collocation[] => {
  const seen = new Map<string, Collocation>();
  for (const c of [...a, ...b]) {
    const key = normalizeTerm(c.phrase);
    if (!key) continue;
    const prev = seen.get(key);
    if (!prev) seen.set(key, c);
    else if (!prev.meaning && c.meaning) seen.set(key, { ...prev, meaning: c.meaning });
  }
  return Array.from(seen.values());
};

// Keeps the first occurrence of each term, filling its empty fields from later ones.
export const mergeExtracted = (cards: ExtractedWordCard[]): ExtractedWordCard[] => {
  const byKey = new Map<string, ExtractedWordCard>();
  for (const card of cards) {
    const key = normalizeTerm(card.front);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...card });
      continue;
    }
    byKey.set(key, {
      ...prev,
      back: prev.back || card.back,
      pronunciation: prev.pronunciation || card.pronunciation,
      partOfSpeech: prev.partOfSpeech || card.partOfSpeech,
      definition: prev.definition?.length ? prev.definition : card.definition,
      exampleSentenceTarget: prev.exampleSentenceTarget?.length ? prev.exampleSentenceTarget : card.exampleSentenceTarget,
      notes: prev.notes || card.notes,
      sourceSentence: prev.sourceSentence || card.sourceSentence,
      collocations: mergeCollocations(prev.collocations, card.collocations),
      synonyms: prev.synonyms?.length ? prev.synonyms : card.synonyms,
      wordFamily: prev.wordFamily?.length ? prev.wordFamily : card.wordFamily,
      commonMistake: prev.commonMistake || card.commonMistake,
      register: prev.register || card.register,
      wordRoot: prev.wordRoot || card.wordRoot,
      extrasAt: prev.extrasAt || card.extrasAt,
    });
  }
  return Array.from(byKey.values());
};

// Flags (and unselects) every card whose term already has a card.
export const markExisting = (cards: ExtractedWordCard[], existingFronts: Iterable<string>): ExtractedWordCard[] => {
  const existing = new Set(Array.from(existingFronts, normalizeTerm));
  return cards.map(card =>
    existing.has(normalizeTerm(card.front)) ? { ...card, alreadyInDeck: true, selected: false } : card
  );
};

// Existing card terms that occur in a text section, so the AI can be told to skip them.
export const existingTermsInText = (text: string, existingFronts: Iterable<string>, limit = 150): string[] => {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').replace(/\s+/g, ' ')} `;
  const found: string[] = [];
  for (const front of existingFronts) {
    const key = normalizeTerm(front);
    if (key && lower.includes(` ${key} `)) {
      found.push(key);
      if (found.length >= limit) break;
    }
  }
  return found;
};
