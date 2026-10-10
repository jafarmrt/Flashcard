// File: /services/freeExtractionService.ts
// Builds flashcards from a text section with free dictionaries only (no AI):
// hard words by frequency, phrasal verbs a dictionary knows, then one lookup per
// term for meaning, IPA, audio, Persian translation and common expressions.

import { ExtractedWordCard } from '../types';
import { callProxy } from './apiService';
import { dictionaryOrigin } from './aiSettings';
import { candidatePhrasalVerbs, candidateWords, pickHardWords } from './freeCandidates';
import { cachedLookup } from './lookupCache';
import { activeDictionaryRequest } from './dictSettings';
import { DICTIONARY_SERVICE, logUsage, TRANSLATION_SERVICE } from './usageLog';
import { levelOfFrequency } from './wordLevel';

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
  frequency?: number | null; // per million words
  source?: string; // the dictionary that knew the term
  kindHint?: 'idiom' | 'slang'; // the dictionary labels the term so
  incomplete?: boolean; // a dictionary did not answer: not kept
}

// Looked up once per word on this device (services/lookupCache). Each
// lookup that reaches the server is noted for the usage page; the server
// translates the headword, which counts towards the free translation quota.
export const freeEnrich = (term: string, onlyIfFound = false): Promise<FreeEnrichment> =>
  cachedLookup(term, async () => {
    try {
      const value: FreeEnrichment = await callProxy('free-enrich', { term, onlyIfFound, dictionaries: activeDictionaryRequest() });
      logUsage({ service: DICTIONARY_SERVICE, task: 'lookup', ok: true, chars: value?.translation ? (value.headword || term).length : 0 });
      return value;
    } catch (error) {
      logUsage({ service: DICTIONARY_SERVICE, task: 'lookup', ok: false, error: (error as Error)?.message });
      throw error;
    }
  });

export const freeTranslate = async (text: string): Promise<string> => {
  try {
    const res = await callProxy('free-translate', { text, dictionaries: activeDictionaryRequest() });
    logUsage({ service: TRANSLATION_SERVICE, task: 'translate', ok: !!res?.translation, chars: text.length, ...(res?.translation ? {} : { error: 'no translation came back (the daily quota may be used up)' }) });
    return res?.translation || '';
  } catch (error) {
    logUsage({ service: TRANSLATION_SERVICE, task: 'translate', ok: false, error: (error as Error)?.message });
    throw error;
  }
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
  // A phrase the dictionary calls an idiom or slang becomes that kind of card.
  kind: kind === 'phrase' && e.kindHint ? e.kindHint : kind,
  sourceSentence: sentence,
  collocations: e.collocations,
  audioSrc: e.audioUrl,
  ...(kind !== 'grammar' && levelOfFrequency(e.frequency) ? { level: levelOfFrequency(e.frequency) } : {}),
  ...(e.found ? {} : { notInDictionary: true }),
  selected: true,
  origin: { ...dictionaryOrigin(), ...(e.source ? { provider: e.source } : {}) },
});

const MAX_PHRASAL_CHECKED = 10;
const MAX_PHRASAL_KEPT = 4;

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

  // At most a few phrasal verbs per section, each kept only if a dictionary
  // knows it. More are checked than kept, since many "verb + particle" pairs
  // are not phrasal verbs ("lived in", "sat on").
  const skip = new Set(exclude.map(e => e.toLowerCase()));
  const phrasal = candidatePhrasalVerbs(text).filter(p => !skip.has(p.word)).slice(0, MAX_PHRASAL_CHECKED);

  const terms = [
    ...phrasal.map(p => ({ ...p, kind: 'phrase' as const })),
    ...hardWords.map(w => ({ ...w, kind: 'word' as const })),
  ];

  const cards = await runLimited(terms, 4, async term => {
    try {
      const e = await freeEnrich(term.word, term.kind === 'phrase');
      if (term.kind === 'phrase' && !e.found) return null;
      // The frequency that picked the word gives its level, so the level agrees
      // with the reason it was picked.
      const frequency = (frequencies || {})[term.word] ?? e.frequency;
      return enrichmentToCard(term.word, term.sentence, { ...e, frequency }, term.kind);
    } catch {
      // The lookup failed (no connection): a bare card, not one the
      // dictionary did not know.
      if (term.kind !== 'word') return null;
      const { notInDictionary: _unknown, ...bare } = enrichmentToCard(term.word, term.sentence, {
        found: false, headword: term.word, pronunciation: '', partOfSpeech: '', definitions: [], examples: [], translation: '', collocations: [],
        frequency: (frequencies || {})[term.word],
      }, 'word');
      return bare;
    }
  }, signal);

  const found = cards.filter((c): c is ExtractedWordCard => !!c);
  const phrases = found.filter(c => c.kind !== 'word').slice(0, MAX_PHRASAL_KEPT);
  const singles = found.filter(c => c.kind === 'word').slice(0, count);
  return [...phrases, ...singles];
};
