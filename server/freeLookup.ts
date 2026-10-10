// File: /server/freeLookup.ts
// Free lookups used when AI is not available (or to complete a card):
//   - the user's dictionaries, in their order (server/dictionaries)
//   - Datamuse: word frequency and common neighbouring words (collocations)
//   - MyMemory: a Persian translation
// `fetchImpl` is injectable so the parsing can be tested without the network.

import { STOPWORDS } from '../services/freeCandidates.js';
import { lemmaCandidates } from '../services/lemma.js';
import type { DictionaryRequest } from '../services/dictionaryCatalog.js';
import { defaultFetch, DictionaryEntry, FetchLike, lookupChain } from './dictionaries.js';

export { lemmaCandidates };

const timeout = (ms: number) => AbortSignal.timeout(ms);

export type { DictionaryEntry };

export interface FreeEnrichment extends DictionaryEntry {
  found: boolean;
  translation: string;
  collocations: { phrase: string }[];
  frequency?: number | null; // per million words, for the word's level
}

// --- Dictionary -------------------------------------------------------------

// The user's dictionaries in their order (server/dictionaries), the word as
// written and then its base forms.
export async function lookupDictionary(word: string, fetchImpl: FetchLike = defaultFetch, request?: DictionaryRequest, timeoutMs?: number): Promise<DictionaryEntry | null> {
  return lookupChain(word, { request, fetchImpl, timeoutMs });
}

// --- Frequency --------------------------------------------------------------

const frequencyCache = new Map<string, number | null>();

const parseFrequency = (item: any): number | null => {
  const tag = (item?.tags || []).find((t: string) => t.startsWith('f:'));
  const value = tag ? parseFloat(tag.slice(2)) : NaN;
  return Number.isFinite(value) ? value : null;
};

// Occurrences per million words (Datamuse); null when unknown. A word whose
// lookup failed (timeout, rate limit) is left out, so callers can tell a
// failure from a rare word.
export async function lookupFrequencies(words: string[], fetchImpl: FetchLike = defaultFetch, concurrency = 8): Promise<Record<string, number | null>> {
  const unique = Array.from(new Set(words.map(w => w.toLowerCase().trim()).filter(Boolean))).slice(0, 400);
  const result: Record<string, number | null> = {};
  const queue = unique.filter(w => {
    if (frequencyCache.has(w)) { result[w] = frequencyCache.get(w)!; return false; }
    return true;
  });
  const worker = async () => {
    for (let w = queue.shift(); w !== undefined; w = queue.shift()) {
      try {
        const res = await fetchImpl(`https://api.datamuse.com/words?sp=${encodeURIComponent(w)}&md=f&max=1`, { signal: timeout(4000) });
        if (res.ok) {
          const data = await res.json();
          const item = Array.isArray(data) ? data.find((d: any) => d.word?.toLowerCase() === w) : null;
          const freq = item ? parseFrequency(item) : null;
          frequencyCache.set(w, freq);
          result[w] = freq;
        }
      } catch {
        // left out, and not cached: a network failure says nothing about the word
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return result;
}

// --- Collocations -----------------------------------------------------------

const isUsefulNeighbour = (w: string) => /^[a-z]{3,}$/.test(w) && !STOPWORDS.has(w);

// Common expressions the word is used in: frequent words right before it
// ("make a decision" -> "difficult decision") and right after it.
export async function lookupCollocations(term: string, fetchImpl: FetchLike = defaultFetch, perSide = 3): Promise<{ phrase: string }[]> {
  const word = term.trim().toLowerCase();
  if (!/^[a-z-]+$/.test(word)) return []; // Datamuse neighbours only work for single words
  const get = async (rel: 'rel_bgb' | 'rel_bga'): Promise<string[]> => {
    try {
      const res = await fetchImpl(`https://api.datamuse.com/words?${rel}=${encodeURIComponent(word)}&max=20`, { signal: timeout(4000) });
      if (!res.ok) return [];
      const data = await res.json();
      return (Array.isArray(data) ? data : []).map((d: any) => String(d.word || '').toLowerCase()).filter(isUsefulNeighbour).slice(0, perSide);
    } catch {
      return [];
    }
  };
  const [before, after] = await Promise.all([get('rel_bgb'), get('rel_bga')]);
  return [...before.map(w => ({ phrase: `${w} ${word}` })), ...after.map(w => ({ phrase: `${word} ${w}` }))];
}

// --- Translation ------------------------------------------------------------

// English -> Persian through MyMemory (free, no key). An email address (typed
// in the settings, else MYMEMORY_EMAIL) raises the daily quota.
export async function freeTranslate(text: string, fetchImpl: FetchLike = defaultFetch, emailAddress?: string): Promise<string> {
  const q = text.trim().slice(0, 450);
  if (!q) return '';
  const address = emailAddress || process.env.MYMEMORY_EMAIL;
  const email = address ? `&de=${encodeURIComponent(address)}` : '';
  try {
    const res = await fetchImpl(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en|fa${email}`, { signal: timeout(5000) });
    if (!res.ok) return '';
    const data = await res.json();
    const translated = String(data?.responseData?.translatedText || '').trim();
    if (Number(data?.responseStatus) !== 200 || !translated || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(translated)) return '';
    if (translated.toLowerCase() === q.toLowerCase()) return ''; // untranslated echo
    return translated;
  } catch {
    return '';
  }
}

// --- Everything for one term ------------------------------------------------

// `onlyIfFound`: stop after the dictionary when it does not know the term,
// so checking a possible phrasal verb spends no translation quota.
export async function freeEnrich(term: string, fetchImpl: FetchLike = defaultFetch, onlyIfFound = false, request?: DictionaryRequest, timeoutMs?: number): Promise<FreeEnrichment> {
  const dictionary = await lookupDictionary(term, fetchImpl, request, timeoutMs);
  const headword = dictionary?.headword || term.trim().toLowerCase();
  if (!dictionary && onlyIfFound) {
    return { found: false, headword, pronunciation: '', partOfSpeech: '', definitions: [], examples: [], translation: '', collocations: [] };
  }
  const single = /^[a-z][a-z'-]*$/.test(headword);
  const [translation, collocations, frequencies] = await Promise.all([
    freeTranslate(headword, fetchImpl, request?.keys?.mymemory),
    lookupCollocations(headword, fetchImpl),
    single ? lookupFrequencies([headword], fetchImpl, 1) : Promise.resolve({} as Record<string, number | null>),
  ]);
  return {
    found: !!dictionary,
    headword,
    pronunciation: dictionary?.pronunciation || '',
    partOfSpeech: dictionary?.partOfSpeech || (term.trim().includes(' ') ? 'phrase' : ''),
    definitions: dictionary?.definitions || [],
    examples: dictionary?.examples || [],
    audioUrl: dictionary?.audioUrl,
    ...(dictionary?.source ? { source: dictionary.source } : {}),
    ...(dictionary?.kindHint ? { kindHint: dictionary.kindHint } : {}),
    translation,
    collocations,
    ...(single && typeof frequencies[headword] === 'number' ? { frequency: frequencies[headword] } : {}),
  };
}
