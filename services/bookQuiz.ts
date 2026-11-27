// File: /services/bookQuiz.ts
// A four-choice quiz built from your own cards and books (no AI needed):
//   - 'gap': a book sentence where a word you are learning was met, blanked out;
//   - 'meaning': Persian meaning shown, pick the English word;
//   - 'word-to-meaning': English word shown, pick its Persian meaning;
//   - 'audio': hear the English word, pick its Persian meaning.
//
// Every choice carries its counterpart from its own card, and `optionWords`
// maps every option label back to its English headword so mistake tracking
// works the same across English and Persian option buttons.

import type { Flashcard } from '../types';
import type { CardPlace } from './library';
import { clozeFor } from './cloze.js';
import { phraseRanges, readerSection } from './readerText.js';
import { isNewCard } from './srsService.js';

export type QuizAsk = 'gap' | 'meaning' | 'word-to-meaning' | 'audio';

export interface BookQuizQuestion {
  cardId: string;
  targetWord: string;
  sourceSentence: string; // '' for a question without a sentence
  questionText: string; // sentence with gap, Persian meaning, or English word
  ask: QuizAsk;
  options: string[];
  correctAnswer: string;
  hint: string; // Persian meaning for gap/meaning, or blanked sentence context for reverse/audio
  meanings: Record<string, string>; // each choice's counterpart (Persian meaning or English word)
  optionCards: Record<string, string>; // each choice's card id
  optionWords: Record<string, string>; // each choice's English headword (for mistake tracking)
  audioSrc?: string;
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

// Three other words of yours as the wrong choices: distinct front and back,
// the same kind and, first, the same part of speech.
const wrongChoices = (card: Flashcard, words: Flashcard[], sentence: string, random: () => number): Flashcard[] => {
  const others = shuffle(words.filter(c => c.id !== card.id && !same(c.front, card.front) && !same(c.back, card.back)
    && (c.kind || 'word') === (card.kind || 'word') && !(sentence && standsIn(sentence, c.front))), random)
    .sort((a, b) => Number((b.partOfSpeech || '') === (card.partOfSpeech || '')) - Number((a.partOfSpeech || '') === (card.partOfSpeech || '')));
  const out: Flashcard[] = [];
  for (const c of others) {
    if (!out.some(o => same(o.front, c.front) || same(o.back, c.back))) out.push(c);
    if (out.length === 3) break;
  }
  return out;
};

const buildQuestion = (
  card: Flashcard,
  wrong: Flashcard[],
  ask: QuizAsk,
  random: () => number,
  gap?: { sentence: string; before: string; after: string },
): BookQuizQuestion => {
  const all = [card, ...wrong];
  const targetWord = card.front.trim();
  const targetMeaning = card.back.trim();
  const blankedSentence = gap ? `${gap.before}${GAP}${gap.after}` : '';

  if (ask === 'word-to-meaning' || ask === 'audio') {
    return {
      cardId: card.id,
      targetWord,
      sourceSentence: gap?.sentence || '',
      questionText: targetWord,
      ask,
      options: shuffle(all.map(c => c.back.trim()), random),
      correctAnswer: targetMeaning,
      hint: blankedSentence,
      meanings: Object.fromEntries(all.map(c => [c.back.trim(), c.front.trim()])),
      optionCards: Object.fromEntries(all.map(c => [c.back.trim(), c.id])),
      optionWords: Object.fromEntries(all.map(c => [c.back.trim(), c.front.trim()])),
      ...(card.audioSrc ? { audioSrc: card.audioSrc } : {}),
    };
  }

  return {
    cardId: card.id,
    targetWord,
    sourceSentence: gap?.sentence || '',
    questionText: ask === 'gap' && blankedSentence ? blankedSentence : targetMeaning,
    ask: ask === 'gap' && blankedSentence ? 'gap' : 'meaning',
    options: shuffle(all.map(c => c.front.trim()), random),
    correctAnswer: targetWord,
    hint: targetMeaning,
    meanings: Object.fromEntries(all.map(c => [c.front.trim(), c.back.trim()])),
    optionCards: Object.fromEntries(all.map(c => [c.front.trim(), c.id])),
    optionWords: Object.fromEntries(all.map(c => [c.front.trim(), c.front.trim()])),
    ...(card.audioSrc ? { audioSrc: card.audioSrc } : {}),
  };
};

export interface QuizOptions {
  count?: number;
  random?: () => number;
  // Only these cards (the words that went wrong before, or "still hard" at the
  // end of a review), new ones too; a card with no usable book sentence is
  // asked from its meaning.
  only?: Set<string>;
  // Mix sentence gaps with meaning, reverse meaning, and audio questions.
  mix?: boolean;
  // Whether the browser can speak words without saved audioSrc.
  canSpeak?: boolean;
}

// Words being learned (not new ones unless `only` is given), the least stable
// first. By default (`mix` false) only book-sentence gaps are used unless
// `only` is set; with `mix: true`, question types rotate across available modes.
export const bookQuiz = (cards: Flashcard[], places: Map<string, CardPlace[]>, options: QuizOptions = {}): BookQuizQuestion[] => {
  const { count = 5, random = Math.random, only, mix = false, canSpeak = false } = options;
  const words = cards.filter(c => !c.isDeleted && c.kind !== 'grammar' && c.front.trim() && c.back.trim());
  const candidates = only
    ? words.filter(c => only.has(c.id))
    : words.filter(c => !isNewCard(c)).sort((a, b) => (a.stability ?? a.interval) - (b.stability ?? b.interval)).slice(0, Math.max(count * 4, 20));
  const questions: BookQuizQuestion[] = [];
  for (const card of shuffle(candidates, random)) {
    if (questions.length >= count) break;
    const sentences = (places.get(card.id) || []).map(p => p.sentence).filter((s): s is string => !!s);
    const cloze = sentences.length ? clozeFor({ ...card, exampleSentenceTarget: [], sourceSentence: undefined }, sentences) : null;
    if (!cloze && !only && !mix) continue;
    const wrong = wrongChoices(card, words, cloze?.sentence || '', random);
    if (wrong.length < 3) continue;

    let ask: QuizAsk = cloze ? 'gap' : 'meaning';
    if (mix) {
      const hasAudio = canSpeak || !!card.audioSrc;
      const modes: QuizAsk[] = cloze
        ? ['gap', 'word-to-meaning', ...(hasAudio ? ['audio' as const] : []), 'meaning']
        : ['meaning', 'word-to-meaning', ...(hasAudio ? ['audio' as const] : [])];
      ask = modes[questions.length % modes.length];
    }

    questions.push(buildQuestion(card, wrong, ask, random, cloze || undefined));
  }
  return questions;
};
