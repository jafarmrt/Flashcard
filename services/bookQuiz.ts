// File: /services/bookQuiz.ts
// A quiz from the books' own sentences: a sentence where a word you are
// learning was met, the word left out, and four of your words to choose
// from. It needs no AI (the AI quiz wrote new sentences that had nothing to
// do with what was read) and every question belongs to a card, so a wrong
// answer can count as forgetting it.
//
// Every choice carries the meaning from its own card: after an answer the
// right word and the one picked are shown side by side with what they mean,
// which is the feedback a wrong answer needs and costs nothing.

import type { Flashcard } from '../types';
import type { CardPlace } from './library';
import { clozeFor } from './cloze.js';
import { phraseRanges, readerSection } from './readerText.js';
import { isNewCard } from './srsService.js';

export interface BookQuizQuestion {
  cardId: string;
  targetWord: string;
  sourceSentence: string; // '' for a question without a sentence
  questionText: string; // the sentence with a gap, or the Persian meaning to find the word for
  ask: 'gap' | 'meaning';
  options: string[];
  correctAnswer: string;
  hint: string; // the right word's Persian meaning
  meanings: Record<string, string>; // each choice's Persian meaning, from its card
  optionCards: Record<string, string>; // each choice's card id
}

const GAP = '_____';

const shuffle = <T,>(list: T[], random: () => number): T[] => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// A word that stands in the sentence already (in any form) is no choice: it
// is either a second right answer or plainly wrong at a glance.
const standsIn = (sentence: string, term: string): boolean => {
  try {
    return phraseRanges(readerSection(sentence), term).length > 0;
  } catch {
    return sentence.toLowerCase().includes(term.trim().toLowerCase());
  }
};

// Three other words of yours as the wrong choices: the same kind and, first,
// the same part of speech, so the choice is between like words.
const wrongChoices = (card: Flashcard, words: Flashcard[], sentence: string, random: () => number): Flashcard[] => {
  const others = shuffle(words.filter(c => c.id !== card.id && !same(c.front, card.front) && !same(c.back, card.back)
    && (c.kind || 'word') === (card.kind || 'word') && !(sentence && standsIn(sentence, c.front))), random)
    .sort((a, b) => Number((b.partOfSpeech || '') === (card.partOfSpeech || '')) - Number((a.partOfSpeech || '') === (card.partOfSpeech || '')));
  const out: Flashcard[] = [];
  for (const c of others) {
    if (!out.some(o => same(o.front, c.front))) out.push(c);
    if (out.length === 3) break;
  }
  return out;
};

const question = (card: Flashcard, wrong: Flashcard[], random: () => number, gap?: { sentence: string; before: string; after: string }): BookQuizQuestion => {
  const all = [card, ...wrong];
  return {
    cardId: card.id,
    targetWord: card.front.trim(),
    sourceSentence: gap?.sentence || '',
    questionText: gap ? `${gap.before}${GAP}${gap.after}` : card.back,
    ask: gap ? 'gap' : 'meaning',
    options: shuffle(all.map(c => c.front.trim()), random),
    correctAnswer: card.front.trim(),
    hint: card.back,
    meanings: Object.fromEntries(all.map(c => [c.front.trim(), c.back])),
    optionCards: Object.fromEntries(all.map(c => [c.front.trim(), c.id])),
  };
};

export interface QuizOptions {
  count?: number;
  random?: () => number;
  // Only these cards (the words that went wrong before), new ones too; a
  // card with no usable book sentence is then asked from its meaning.
  only?: Set<string>;
}

// Words being learned (not new ones: the quiz is recall, not a first look),
// the least stable first, each in a sentence from a book.
export const bookQuiz = (cards: Flashcard[], places: Map<string, CardPlace[]>, options: QuizOptions = {}): BookQuizQuestion[] => {
  const { count = 5, random = Math.random, only } = options;
  const words = cards.filter(c => !c.isDeleted && c.kind !== 'grammar' && c.front.trim() && c.back.trim());
  const candidates = only
    ? words.filter(c => only.has(c.id))
    : words.filter(c => !isNewCard(c)).sort((a, b) => (a.stability ?? a.interval) - (b.stability ?? b.interval)).slice(0, Math.max(count * 4, 20));
  const questions: BookQuizQuestion[] = [];
  for (const card of shuffle(candidates, random)) {
    if (questions.length >= count) break;
    const sentences = (places.get(card.id) || []).map(p => p.sentence).filter((s): s is string => !!s);
    const cloze = sentences.length ? clozeFor({ ...card, exampleSentenceTarget: [], sourceSentence: undefined }, sentences) : null;
    if (!cloze && !only) continue; // only the books' sentences here
    const wrong = wrongChoices(card, words, cloze?.sentence || '', random);
    if (wrong.length < 3) continue;
    questions.push(question(card, wrong, random, cloze || undefined));
  }
  return questions;
};
