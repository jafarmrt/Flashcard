// This service asks the dictionaries (through the server) and fetches their
// pronunciation audio.

import { callProxy } from './apiService';
import { activeDictionaryRequest } from './dictSettings';
import type { DictionaryId } from './dictionaryCatalog';

export interface DictionaryResult {
    headword: string;
    pronunciation: string;
    partOfSpeech: string;
    definitions: string[];
    exampleSentences: string[];
    audioUrl?: string;
    source?: string; // the dictionary that answered
}

// The user's dictionaries in their order, or only `source`. `timeoutMs` is how
// long each dictionary may take before the next one is asked.
export const lookupDictionary = async (word: string, options: { source?: DictionaryId; timeoutMs?: number } = {}): Promise<DictionaryResult> => {
    const entry = await callProxy('dictionary-lookup', { word, ...options, dictionaries: activeDictionaryRequest() });
    return {
        headword: entry.headword || word,
        pronunciation: entry.pronunciation || '',
        partOfSpeech: entry.partOfSpeech || '',
        definitions: entry.definitions || [],
        exampleSentences: entry.examples || [],
        audioUrl: entry.audioUrl,
        source: entry.source,
    };
};

// Tries one dictionary (or the translation service) with the keys being typed.
export const testDictionary = async (source: DictionaryId | 'mymemory', dictionaries: object): Promise<{ ok: boolean; message: string }> => {
    try {
        const res = await callProxy('test-dictionary', { source, dictionaries });
        return { ok: true, message: res?.message || 'ok' };
    } catch (error) {
        const message = String((error as Error)?.message || '');
        if (/needs an API key/i.test(message)) return { ok: false, message: 'کلید ندارد؛ کلید را وارد کن.' };
        if (/refused the key/i.test(message)) return { ok: false, message: 'کلید پذیرفته نشد؛ درستی کلید و نام دیکشنری را نگاه کن.' };
        if (/quota/i.test(message)) return { ok: false, message: 'جواب نداد؛ شاید سهمیهٔ امروز تمام شده باشد.' };
        return { ok: false, message: 'جواب نداد؛ از سرور برنامه در دسترس نیست. کمی بعد دوباره امتحان کن.' };
    }
};

// --- Audio Fetcher ---
export const fetchAudioData = async (url: string): Promise<string> => {
  // Sound already kept in the card (recorded, or saved earlier) plays as it is.
  if (/^(data|blob):/i.test(url)) return url;
  const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fetch-audio', url: url })
  });
  if (!response.ok) {
    throw new Error('Failed to fetch audio file via proxy');
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};