// File: /services/freeExtractionService.ts
// Builds flashcards from a text section with free dictionaries only (no AI):
// hard words by frequency, phrasal verbs a dictionary knows, then one lookup per
// term for meaning, IPA, audio, Persian translation and common expressions.

import { ExtractedWordCard } from '../types';
import { callProxy } from './apiService';
import { candidatePhrasalVerbs, candidateWords, pickHardWords } from './freeCandidates';

export interface FreeEnrichment {
  found: boolean;
  headword: string;
  pronunciation: string;
  partOfSpeech: string;
  definitions: string[];
  examples: string[];
  audioUrl?: string;
  translation: string;
  collocations: { phrase: string }[];
}

export const freeEnrich = (term: string): Promise<FreeEnrichment> => callProxy('free-enrich', { term });

export const freeTranslate = async (text: string): Promise<string> => {
  const res = await callProxy('free-translate', { text });
  return res?.translation || '';
};

const runLimited = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, signal?: AbortSignal): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length && !signal?.aborted) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

export const enrichmentToCard = (term: string, sentence: string | undefined, e: FreeEnrichment, kind: ExtractedWordCard['kind']): ExtractedWordCard => ({
  front: e.headword || term,
  back: e.translation,
  pronunciation: e.pronunciation,
  partOfSpeech: e.partOfSpeech,
  definition: e.definitions.slice(0, 2),
  exampleSentenceTarget: e.examples.slice(0, 2),
  notes: '',
  kind,
  sourceSentence: sentence,
  collocations: e.collocations,
  audioSrc: e.audioUrl,
  selected: true,
});

export interface FreeExtractParams {
  text: string;
  level: string;
  count: number;
  exclude?: string[]; // terms that already have a card
  signal?: AbortSignal;
}

export const extractWithFreeDictionaries = async ({ text, level, count, exclude = [], signal }: FreeExtractParams): Promise<ExtractedWordCard[]> => {
  const words = candidateWords(text);
  const { frequencies } = await callProxy('word-frequencies', { words: words.map(w => w.word) });
  const hardWords = pickHardWords(words, frequencies || {}, level, count, exclude);

  // At most a few phrasal verbs per section; each is kept only if a dictionary knows it.
  const skip = new Set(exclude.map(e => e.toLowerCase()));
  const phrasal = candidatePhrasalVerbs(text).filter(p => !skip.has(p.word)).slice(0, 4);

  const terms = [
    ...phrasal.map(p => ({ ...p, kind: 'phrase' as const })),
    ...hardWords.map(w => ({ ...w, kind: 'word' as const })),
  ];

  const cards = await runLimited(terms, 4, async term => {
    try {
      const e = await freeEnrich(term.word);
      if (term.kind === 'phrase' && !e.found) return null;
      return enrichmentToCard(term.word, term.sentence, e, term.kind);
    } catch {
      return term.kind === 'word' ? enrichmentToCard(term.word, term.sentence, {
        found: false, headword: term.word, pronunciation: '', partOfSpeech: '', definitions: [], examples: [], translation: '', collocations: [],
      }, 'word') : null;
    }
  }, signal);

  return cards.filter((c): c is ExtractedWordCard => !!c).slice(0, count + phrasal.length);
};
