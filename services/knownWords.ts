// File: /services/knownWords.ts
// The "I know it" list: terms the user already knows. They are never offered
// again, in any book and in any form ("decided" once "decide" is known).

import type { KnownWord } from '../types';
import { lemmaCandidates, tokensOf } from './lemma.js';
import { existingTermsInText, normalizeTerm } from './vocabMerge.js';

export const knownTermSet = (rows: KnownWord[]): Set<string> => {
  const set = new Set<string>();
  for (const row of rows) if (!row.isDeleted && row.term) set.add(row.term);
  return set;
};

export const isKnownTerm = (term: string, known: Set<string>): boolean => {
  if (known.size === 0) return false;
  const key = normalizeTerm(term);
  if (!key) return false;
  return known.has(key) || lemmaCandidates(key).some(form => known.has(normalizeTerm(form)));
};

// Known terms of a text as written there, so extraction can be told to skip
// them.
export const knownFormsInText = (text: string, known: Set<string>, limit = 150): string[] => {
  if (known.size === 0) return [];
  const phrases = [...known].filter(term => term.includes(' '));
  const out = new Set(existingTermsInText(text, phrases, limit));
  for (const token of tokensOf(text)) {
    if (out.size >= limit) break;
    const word = token.toLowerCase().replace(/’/g, "'");
    if (!out.has(word) && isKnownTerm(word, known)) out.add(word);
  }
  return [...out];
};

export const newKnownWord = (term: string, now: Date = new Date(), id: string = crypto.randomUUID()): KnownWord => ({
  id,
  term: normalizeTerm(term),
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});

// Taking a term off the list deletes every row for it: two devices may each
// have added it.
export const forgetRows = (rows: KnownWord[], term: string, now: Date = new Date()): KnownWord[] => {
  const key = normalizeTerm(term);
  return rows
    .filter(row => !row.isDeleted && row.term === key)
    .map(row => ({ ...row, isDeleted: true, updatedAt: now.toISOString() }));
};

// The list to show: each term once, the most recently added first.
export const knownList = (rows: KnownWord[]): KnownWord[] => {
  const byTerm = new Map<string, KnownWord>();
  for (const row of rows) {
    if (row.isDeleted || !row.term) continue;
    const have = byTerm.get(row.term);
    if (!have || row.createdAt > have.createdAt) byTerm.set(row.term, row);
  }
  return [...byTerm.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};
