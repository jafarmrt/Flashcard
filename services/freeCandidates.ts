// File: /services/freeCandidates.ts
// Picks the hard words of a text without AI: common words are dropped with a
// stop list, then word frequency (Datamuse, per million words) decides what is
// hard for the learner's level. Pure functions; the lookups live in freeExtractionService.

import { IRREGULAR_FORMS, tokensOf } from './lemma.js';
import { splitSentences } from './textChunker.js';

// Function words and very common words that never deserve a card.
export const STOPWORDS = new Set(`
a about above after again against all almost also although always am among an and another any anyone anything are
around as at away back be became because become been before being below between both but by came can cannot could
did do does doing done down during each either else even ever every few for from further get gets getting go goes
going gone got had has have having he her here hers herself him himself his how however i if in into is it its itself
just know last least less let like made make makes many may me might more most much must my myself near need never
new no nor not now of off often on once one only or other others our ours ourselves out over own per perhaps put
quite rather really said same say says see seem seems shall she should since so some something sometimes still such
take than that the their theirs them themselves then there these they thing things this those though through thus to
too took toward towards under until up upon us use used very was way we well went were what whatever when where
whether which while who whom whose why will with within without would yet you your yours yourself yourselves
year years time times day days people man men woman women good great first two three four five six seven eight nine ten
`.trim().split(/\s+/));

export const PARTICLES = new Set(['up', 'out', 'off', 'down', 'over', 'away', 'back', 'through', 'on', 'in', 'into', 'around', 'along', 'apart', 'aside']);

// A word counts as hard for a level when its frequency (per million words) is below this.
export const LEVEL_FREQUENCY_THRESHOLDS: Record<string, number> = {
  A1: 150,
  A2: 80,
  B1: 40,
  B2: 15,
  C1: 6,
  C2: 2.5,
  IELTS: 20,
  TOEFL: 12,
};

// Below this a "word" is usually a name, a typo or jargon.
const MIN_FREQUENCY = 0.05;

export interface WordCandidate {
  word: string; // lower case, as written in the text
  sentence: string;
}


const sentencesOf = (text: string): string[] =>
  text.split(/\n\s*\n/).flatMap(paragraph => splitSentences(paragraph));

// Words written with a capital inside a sentence and never in lower case are
// names ("Darcy", "London"), also when one starts a sentence.
export const namesIn = (sentences: string[]): Set<string> => {
  const capitalised = new Set<string>();
  const lower = new Set<string>();
  for (const sentence of sentences) {
    tokensOf(sentence).forEach((token, index) => {
      const word = token.toLowerCase();
      if (/^\p{Ll}/u.test(token)) lower.add(word);
      else if (index > 0 && token !== token.toUpperCase()) capitalised.add(word);
    });
  }
  return new Set([...capitalised].filter(w => !lower.has(w)));
};

// Content words of a text section, each with the first sentence it appears in.
export const candidateWords = (text: string): WordCandidate[] => {
  const sentences = sentencesOf(text);
  const names = namesIn(sentences);
  const seen = new Map<string, WordCandidate>();
  for (const sentence of sentences) {
    for (const token of tokensOf(sentence)) {
      const word = token.toLowerCase().replace(/’/g, "'").replace(/'s$/, '');
      if (word.length < 3 || STOPWORDS.has(word) || word.includes("'") || names.has(word)) continue;
      if (/^\p{Lu}+$/u.test(token) && token.length <= 5) continue; // an acronym: NASA, UNESCO
      if (!seen.has(word)) seen.set(word, { word, sentence });
    }
  }
  return Array.from(seen.values());
};

// Verbs that head most phrasal verbs, in any form ("took off" -> "take off").
const PHRASAL_HEADS = new Set(['make', 'take', 'get', 'put', 'go', 'come', 'set', 'turn', 'look', 'give', 'carry', 'bring', 'break', 'run', 'pick', 'point', 'figure', 'find', 'work', 'hold', 'keep', 'cut', 'let', 'show', 'stand', 'fall', 'throw', 'pull', 'call', 'sort', 'end', 'rule', 'wear', 'back', 'sum']);

const headBase = (word: string) => IRREGULAR_FORMS[word] || word;

// Possible phrasal verbs ("give up", "carry out"): a content word followed by
// a particle. Irregular past forms are turned into the base verb. Common
// phrasal-verb heads come first; a dictionary later decides which are real.
export const candidatePhrasalVerbs = (text: string): WordCandidate[] => {
  const seen = new Map<string, WordCandidate & { known: boolean }>();
  for (const sentence of sentencesOf(text)) {
    const tokens = tokensOf(sentence).map(t => t.toLowerCase());
    for (let i = 0; i < tokens.length - 1; i++) {
      const [written, particle] = [tokens[i], tokens[i + 1]];
      if (!PARTICLES.has(particle)) continue;
      const head = headBase(written);
      const known = PHRASAL_HEADS.has(head) || [...PHRASAL_HEADS].some(h => written.startsWith(h) && written.length - h.length <= 4);
      if (head.length < 2 || (STOPWORDS.has(written) && !known)) continue;
      const phrase = `${head} ${particle}`;
      if (!seen.has(phrase)) seen.set(phrase, { word: phrase, sentence, known });
    }
  }
  return Array.from(seen.values())
    .sort((a, b) => Number(b.known) - Number(a.known))
    .map(({ word, sentence }) => ({ word, sentence }));
};

// The hardest useful words for a level: frequency below the level's threshold,
// most frequent first (a hard but common word is worth learning first).
export const pickHardWords = (
  candidates: WordCandidate[],
  frequencies: Record<string, number | null | undefined>,
  level: string,
  count: number,
  exclude: Iterable<string> = []
): WordCandidate[] => {
  const threshold = LEVEL_FREQUENCY_THRESHOLDS[level] ?? LEVEL_FREQUENCY_THRESHOLDS.B2;
  const skip = new Set(Array.from(exclude, w => w.toLowerCase()));
  return candidates
    .filter(c => !skip.has(c.word))
    .map(c => ({ c, f: frequencies[c.word] }))
    .filter((x): x is { c: WordCandidate; f: number } => typeof x.f === 'number' && x.f >= MIN_FREQUENCY && x.f < threshold)
    .sort((a, b) => b.f - a.f)
    .slice(0, Math.max(0, count))
    .map(x => x.c);
};
