// File: /services/cardKinds.ts
// What a card can teach, with its Persian name, and what extraction looks
// for in a text (Settings.extractKinds).

import type { CardKind, Settings } from '../types';

export const CARD_KINDS: CardKind[] = ['word', 'phrase', 'collocation', 'idiom', 'expression', 'slang', 'grammar'];

export const KIND_LABEL: Record<CardKind, string> = {
  word: 'واژه',
  phrase: 'فعل عبارتی',
  collocation: 'کالوکیشن',
  idiom: 'ایدیوم',
  expression: 'اصطلاح',
  slang: 'اسلنگ',
  grammar: 'ساختار دستوری',
};

// Shown next to each kind in the settings.
export const KIND_EXAMPLE: Record<CardKind, string> = {
  word: 'reluctant',
  phrase: 'give up, carry out',
  collocation: 'make a decision, heavy rain',
  idiom: 'spill the beans',
  expression: 'no wonder, by the way',
  slang: 'ghost someone, broke',
  grammar: 'Had I known…',
};

export const parseCardKind = (value: unknown): CardKind | undefined => {
  const kind = String(value || '').trim().toLowerCase();
  return (CARD_KINDS as string[]).includes(kind) ? (kind as CardKind) : undefined;
};

// The kinds extraction looks for: all, unless the user narrowed them. A
// single word is always kept, so a text never comes back empty for lack of
// expressions.
export const extractKinds = (settings: Partial<Settings>): CardKind[] => {
  const chosen = (settings.extractKinds || []).filter(k => CARD_KINDS.includes(k));
  return chosen.length > 0 ? CARD_KINDS.filter(k => k === 'word' || chosen.includes(k)) : [...CARD_KINDS];
};
