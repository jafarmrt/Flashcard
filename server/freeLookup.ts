// File: /server/freeLookup.ts
// Free, key-less lookups used when AI is not available (or to complete a card):
//   - dictionaryapi.dev: definitions, IPA, audio, examples (Datamuse as fallback)
//   - Datamuse: word frequency and common neighbouring words (collocations)
//   - MyMemory: a Persian translation
// `fetchImpl` is injectable so the parsing can be tested without the network.

import { STOPWORDS } from '../services/freeCandidates.js';
import { lemmaCandidates } from '../services/lemma.js';

export { lemmaCandidates };

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
}>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init as RequestInit) as any;

const timeout = (ms: number) => AbortSignal.timeout(ms);

export interface DictionaryEntry {
  headword: string;
  pronunciation: string;
  partOfSpeech: string;
  definitions: string[];
  examples: string[];
  audioUrl?: string;
}

export interface FreeEnrichment extends DictionaryEntry {
  found: boolean;
  translation: string;
  collocations: { phrase: string }[];
}

// --- Dictionary -------------------------------------------------------------

async function fetchFreeDictionary(word: string, fetchImpl: FetchLike): Promise<any[] | null> {
  const cleanWord = encodeURIComponent(word.trim().toLowerCase());
  try {
    const res = await fetchImpl(`https://api.dictionaryapi.dev/api/v2/entries/en/${cleanWord}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LinguaCards/1.0', Accept: 'application/json' },
      signal: timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {
    // unreachable or unknown
  }
  return null;
}

// Raw dictionaryapi.dev-shaped entries: dictionaryapi.dev first, Datamuse definitions as fallback.
export async function fetchDictionaryEntries(word: string, fetchImpl: FetchLike = defaultFetch): Promise<any[] | null> {
  return (await fetchFreeDictionary(word, fetchImpl)) || fetchDatamuseDefinitions(word, fetchImpl);
}

async function fetchDatamuseDefinitions(word: string, fetchImpl: FetchLike): Promise<any[] | null> {
  const cleanWord = encodeURIComponent(word.trim().toLowerCase());
  try {
    const res = await fetchImpl(`https://api.datamuse.com/words?sp=${cleanWord}&md=dp&max=1`, { signal: timeout(3000) });
    if (!res.ok) return null;
    const dmData = await res.json();
    const item = Array.isArray(dmData) ? dmData[0] : null;
    if (!item?.defs || item.word?.toLowerCase() !== word.trim().toLowerCase()) return null;
    // Datamuse defines inflected forms under their dictionary form ("carried" -> "carry").
    const headword = typeof item.defHeadword === 'string' && item.defHeadword ? item.defHeadword : item.word;
    const defMap: Record<string, string[]> = {};
    for (const d of item.defs as string[]) {
      const [tag, text] = d.split('\t');
      const pos = tag === 'n' ? 'noun' : tag === 'v' ? 'verb' : tag === 'adj' ? 'adjective' : tag === 'adv' ? 'adverb' : 'general';
      (defMap[pos] ||= []).push(text || d);
    }
    return [{
      word: headword,
      phonetic: item.tags?.find((t: string) => t.startsWith('ipa:'))?.replace('ipa:', '') || '',
      phonetics: [],
      meanings: Object.entries(defMap).map(([partOfSpeech, list]) => ({
        partOfSpeech,
        definitions: list.map(definition => ({ definition })),
      })),
    }];
  } catch {
    return null;
  }
}

export function parseDictionaryEntries(data: any[]): DictionaryEntry {
  const entry = data[0] || {};
  const phonetics: any[] = entry.phonetics || [];
  const definitions: string[] = [];
  const examples: string[] = [];
  let partOfSpeech = '';
  for (const meaning of entry.meanings || []) {
    if (!partOfSpeech) partOfSpeech = meaning.partOfSpeech || '';
    for (const def of meaning.definitions || []) {
      if (def.definition) definitions.push(def.definition);
      if (def.example) examples.push(def.example);
    }
  }
  return {
    headword: entry.word || '',
    pronunciation: phonetics.find(p => p.text && p.audio)?.text || entry.phonetic || phonetics.find(p => p.text)?.text || '',
    partOfSpeech,
    definitions: definitions.slice(0, 4),
    examples: examples.slice(0, 3),
    audioUrl: phonetics.find(p => p.audio)?.audio || undefined,
  };
}

// The word as written, then its base forms. The full dictionary is asked for
// every form before the thinner Datamuse definitions are used, which define
// "carried" without ever trying "carry".
export async function lookupDictionary(word: string, fetchImpl: FetchLike = defaultFetch): Promise<DictionaryEntry | null> {
  const forms = lemmaCandidates(word);
  for (const form of forms) {
    const data = await fetchFreeDictionary(form, fetchImpl);
    if (data) {
      const parsed = parseDictionaryEntries(data);
      return { ...parsed, headword: parsed.headword || form };
    }
  }
  for (const form of forms) {
    const data = await fetchDatamuseDefinitions(form, fetchImpl);
    if (data) {
      const parsed = parseDictionaryEntries(data);
      return { ...parsed, headword: parsed.headword || form };
    }
  }
  return null;
}

// --- Frequency --------------------------------------------------------------

const frequencyCache = new Map<string, number | null>();

const parseFrequency = (item: any): number | null => {
  const tag = (item?.tags || []).find((t: string) => t.startsWith('f:'));
  const value = tag ? parseFloat(tag.slice(2)) : NaN;
  return Number.isFinite(value) ? value : null;
};

// Occurrences per million words (Datamuse); null when unknown.
export async function lookupFrequencies(words: string[], fetchImpl: FetchLike = defaultFetch, concurrency = 8): Promise<Record<string, number | null>> {
  const unique = Array.from(new Set(words.map(w => w.toLowerCase().trim()).filter(Boolean))).slice(0, 400);
  const result: Record<string, number | null> = {};
  const queue = unique.filter(w => {
    if (frequencyCache.has(w)) { result[w] = frequencyCache.get(w)!; return false; }
    return true;
  });
  const worker = async () => {
    for (let w = queue.shift(); w !== undefined; w = queue.shift()) {
      let freq: number | null = null;
      try {
        const res = await fetchImpl(`https://api.datamuse.com/words?sp=${encodeURIComponent(w)}&md=f&max=1`, { signal: timeout(4000) });
        if (res.ok) {
          const data = await res.json();
          const item = Array.isArray(data) ? data.find((d: any) => d.word?.toLowerCase() === w) : null;
          freq = item ? parseFrequency(item) : null;
          frequencyCache.set(w, freq);
        }
      } catch {
        // leave unknown, do not cache network failures
      }
      result[w] = freq;
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

// English -> Persian through MyMemory (free, no key; MYMEMORY_EMAIL raises the daily quota).
export async function freeTranslate(text: string, fetchImpl: FetchLike = defaultFetch): Promise<string> {
  const q = text.trim().slice(0, 450);
  if (!q) return '';
  const email = process.env.MYMEMORY_EMAIL ? `&de=${encodeURIComponent(process.env.MYMEMORY_EMAIL)}` : '';
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
export async function freeEnrich(term: string, fetchImpl: FetchLike = defaultFetch, onlyIfFound = false): Promise<FreeEnrichment> {
  const dictionary = await lookupDictionary(term, fetchImpl);
  const headword = dictionary?.headword || term.trim().toLowerCase();
  if (!dictionary && onlyIfFound) {
    return { found: false, headword, pronunciation: '', partOfSpeech: '', definitions: [], examples: [], translation: '', collocations: [] };
  }
  const [translation, collocations] = await Promise.all([
    freeTranslate(headword, fetchImpl),
    lookupCollocations(headword, fetchImpl),
  ]);
  return {
    found: !!dictionary,
    headword,
    pronunciation: dictionary?.pronunciation || '',
    partOfSpeech: dictionary?.partOfSpeech || (term.trim().includes(' ') ? 'phrase' : ''),
    definitions: dictionary?.definitions || [],
    examples: dictionary?.examples || [],
    audioUrl: dictionary?.audioUrl,
    translation,
    collocations,
  };
}
