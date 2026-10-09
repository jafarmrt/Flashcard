// File: /services/cloze.ts
// Review with a gap: the sentence of the book the word was met in, with the
// word left out, and its Persian meaning as the hint. The learner writes the
// missing word as the sentence needs it ("decided", not "decide").

import type { Flashcard } from '../types';
import { isFormOf, termWords } from './lemma.js';
import { phraseRanges, readerSection } from './readerText.js';
import { levenshtein } from './stringSimilarity.js';

export interface Cloze {
  sentence: string;
  before: string;
  answer: string; // the words left out, as written in the sentence
  after: string;
}

// A sentence long enough to hint at the word, short enough to read at a glance.
const MAX_WORDS = 45;

export const makeCloze = (sentence: string, term: string): Cloze | null => {
  const text = sentence.trim();
  if (!text || !term.trim()) return null;
  const section = readerSection(text);
  if (section.words.length < 3 || section.words.length > MAX_WORDS) return null;
  const [range] = phraseRanges(section, term);
  if (!range) return null;
  const start = section.words[range[0]].start;
  const end = section.words[range[1]].end;
  if (end - start >= text.length - 2) return null; // nothing left around the gap
  return { sentence: text, before: text.slice(0, start), answer: text.slice(start, end), after: text.slice(end) };
};

// The first sentence that makes a gap for the card: where it was met in
// books first, then the card's own sentence and examples. Grammar cards have
// no single word to leave out.
export const clozeFor = (card: Pick<Flashcard, 'front' | 'kind' | 'sourceSentence' | 'exampleSentenceTarget'>, places: (string | undefined)[] = []): Cloze | null => {
  if (card.kind === 'grammar') return null;
  const examples = Array.isArray(card.exampleSentenceTarget) ? card.exampleSentenceTarget : card.exampleSentenceTarget ? [String(card.exampleSentenceTarget)] : [];
  for (const sentence of [...places, card.sourceSentence, ...examples]) {
    if (!sentence) continue;
    const cloze = makeCloze(sentence, card.front);
    if (cloze) return cloze;
  }
  return null;
};

// The gap as shown: the first letter of each word, then a dash per letter.
export const blankOf = (answer: string): string => answer.replace(/\p{L}+/gu, w => w[0] + '_'.repeat(Math.max(0, w.length - 1)));

export type ClozeResult = 'correct' | 'close' | 'wrong';

const normal = (s: string) => s.toLowerCase().replace(/’/g, "'").replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();

// Right as written in the sentence; close with a typo or another form of the
// same word ("decide" for "decided"); otherwise wrong.
export const checkCloze = (typed: string, cloze: Cloze, front: string): ClozeResult => {
  const t = normal(typed);
  if (!t) return 'wrong';
  const answer = normal(cloze.answer);
  if (t === answer) return 'correct';
  if (levenshtein(t, answer) <= Math.max(1, Math.floor(answer.length / 5))) return 'close';
  const words = termWords(front);
  const typedWords = t.split(' ');
  let i = 0;
  for (const w of typedWords) if (i < words.length && isFormOf(w, words[i])) i++;
  return i === words.length ? 'close' : 'wrong';
};
