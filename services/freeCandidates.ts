// File: /services/freeCandidates.ts
// Picks the hard words of a text without AI: common words are dropped with a
// stop list, then word frequency (Datamuse, per million words) decides what is
// hard for the learner's level. Pure functions; the lookups live in freeExtractionService.

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

const TOKEN = /[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]/g;

// Content words of a text section, each with the first sentence it appears in.
// Capitalised words inside a sentence are treated as names and skipped.
export const candidateWords = (text: string): WordCandidate[] => {
  const seen = new Map<string, WordCandidate>();
  for (const paragraph of text.split(/\n\s*\n/)) {
    for (const sentence of splitSentences(paragraph)) {
      const tokens = sentence.match(TOKEN) || [];
      tokens.forEach((token, index) => {
        const word = token.toLowerCase().replace(/’/g, "'").replace(/'s$/, '');
        if (word.length < 3 || STOPWORDS.has(word) || word.includes("'")) return;
        if (index > 0 && /^[A-Z]/.test(token) && token !== token.toUpperCase()) return; // a name
        if (!seen.has(word)) seen.set(word, { word, sentence });
      });
    }
  }
  return Array.from(seen.values());
};

// Possible phrasal verbs ("give up", "carry out"): a content word followed by a particle.
// They are only kept when a dictionary knows them.
export const candidatePhrasalVerbs = (text: string): WordCandidate[] => {
  const seen = new Map<string, WordCandidate>();
  for (const paragraph of text.split(/\n\s*\n/)) {
    for (const sentence of splitSentences(paragraph)) {
      const tokens = (sentence.match(TOKEN) || []).map(t => t.toLowerCase());
      for (let i = 0; i < tokens.length - 1; i++) {
        const [head, particle] = [tokens[i], tokens[i + 1]];
        if (head.length < 3 || !PARTICLES.has(particle)) continue;
        if (STOPWORDS.has(head) && !['make', 'take', 'get', 'put', 'go', 'come', 'set', 'turn', 'look', 'give', 'carry', 'bring', 'break', 'run', 'pick', 'point', 'figure', 'find', 'work', 'hold', 'keep'].includes(head)) continue;
        const phrase = `${head} ${particle}`;
        if (!seen.has(phrase)) seen.set(phrase, { word: phrase, sentence });
      }
    }
  }
  return Array.from(seen.values());
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
