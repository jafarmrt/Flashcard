// File: /services/cardCheck.ts
// Checks a card can pass without AI, so a wrong card does not slip into
// review unnoticed: the dictionary did not know its term, it has no Persian
// meaning, or its term is not in the sentence it was taken from. A card the
// user confirmed (or fixed) is not flagged again.

import type { Flashcard } from '../types';
import { cardsInText } from './library.js';

export type CheckReason = 'not-in-dictionary' | 'no-persian' | 'not-in-sentence';

export const REASON_TEXT: Record<CheckReason, string> = {
  'not-in-dictionary': 'در دیکشنری پیدا نشد',
  'no-persian': 'معنی فارسی ندارد',
  'not-in-sentence': 'در جملهٔ منبع نیست',
};

type Checked = Pick<Flashcard, 'front' | 'back' | 'kind' | 'sourceSentence' | 'notInDictionary' | 'checkedAt' | 'isDeleted'>;

export const termInSentence = (card: Pick<Flashcard, 'front' | 'kind'>, sentence: string): boolean =>
  cardsInText(sentence, [{ front: card.front, kind: card.kind }]).length > 0;

export const checkReasons = (card: Checked): CheckReason[] => {
  if (card.isDeleted || card.checkedAt) return [];
  const reasons: CheckReason[] = [];
  if (card.notInDictionary && card.kind !== 'grammar') reasons.push('not-in-dictionary');
  const back = (card.back || '').trim();
  if (!back || back === '…') reasons.push('no-persian');
  if (card.kind !== 'grammar' && card.sourceSentence?.trim() && !termInSentence(card, card.sourceSentence)) reasons.push('not-in-sentence');
  return reasons;
};

export const needsCheck = (card: Checked): boolean => checkReasons(card).length > 0;

// Cards worth an AI meaning check: flagged ones, and unchecked cards the
// free dictionaries filled (a dictionary gives the commonest sense, often
// not the one in the book). Grammar cards are left out.
export const meaningCheckCandidates = <T extends Checked & { origin?: Flashcard['origin'] }>(cards: T[]): T[] =>
  cards.filter(c => !c.isDeleted && !c.checkedAt && c.kind !== 'grammar' && (needsCheck(c) || c.origin?.by === 'dictionary'));
