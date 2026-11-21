// File: /services/bookQuiz.ts
// A quiz from the books' own sentences: a sentence where a word you are
// learning was met, the word left out, and four of your words to choose
// from. It needs no AI (the AI quiz wrote new sentences that had nothing to
// do with what was read) and every question belongs to a card, so a wrong
// answer can count as forgetting it.

import type { Flashcard } from '../types';
import type { CardPlace } from './library';
import { clozeFor } from './cloze.js';
import { isNewCard } from './srsService.js';

export interface BookQuizQuestion {
  cardId: string;
  targetWord: string;
  sourceSentence: string;
  questionText: string; // the sentence with a gap
  options: string[];
  correctAnswer: string;
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

// Words being learned (not new ones: the quiz is recall, not a first look),
// the least stable first, each in a sentence from a book.
export const bookQuiz = (cards: Flashcard[], places: Map<string, CardPlace[]>, count = 5, random: () => number = Math.random): BookQuizQuestion[] => {
  const words = cards.filter(c => !c.isDeleted && c.kind !== 'grammar' && c.front.trim());
  const learning = words.filter(c => !isNewCard(c)).sort((a, b) => (a.stability ?? a.interval) - (b.stability ?? b.interval));
  const questions: BookQuizQuestion[] = [];
  const pool = shuffle(learning.slice(0, Math.max(count * 4, 20)), random);
  for (const card of pool) {
    if (questions.length >= count) break;
    const sentences = (places.get(card.id) || []).map(p => p.sentence).filter((s): s is string => !!s);
    if (sentences.length === 0) continue; // only the books' sentences here
    const cloze = clozeFor({ ...card, exampleSentenceTarget: [], sourceSentence: undefined }, sentences);
    if (!cloze) continue;
    const key = card.front.trim().toLowerCase();
    // Other words of the same kind, part of speech first, as the wrong choices.
    const others = shuffle(words.filter(c => c.id !== card.id && c.front.trim().toLowerCase() !== key && (c.kind || 'word') === (card.kind || 'word')), random)
      .sort((a, b) => Number((b.partOfSpeech || '') === (card.partOfSpeech || '')) - Number((a.partOfSpeech || '') === (card.partOfSpeech || '')));
    const wrong: string[] = [];
    for (const c of others) {
      const front = c.front.trim();
      if (!wrong.some(w => w.toLowerCase() === front.toLowerCase())) wrong.push(front);
      if (wrong.length === 3) break;
    }
    if (wrong.length < 3) continue;
    questions.push({
      cardId: card.id,
      targetWord: card.front.trim(),
      sourceSentence: cloze.sentence,
      questionText: `${cloze.before}${GAP}${cloze.after}`,
      options: shuffle([card.front.trim(), ...wrong], random),
      correctAnswer: card.front.trim(),
    });
  }
  return questions;
};
