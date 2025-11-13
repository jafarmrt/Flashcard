// This service handles fetching and parsing data from external dictionary APIs.

// A helper function to call our secure proxy
const callProxy = async (action: 'dictionary-free' | 'dictionary-mw', payload: object) => {
    const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Proxy request failed for ${action}`);
    }
    return response.json();
};

export interface DictionaryResult {
    pronunciation: string;
    partOfSpeech: string;
    definitions: string[];
    exampleSentences: string[];
    audioUrl?: string;
}

// --- Free Dictionary API (dictionaryapi.dev) ---
export const fetchFromFreeDictionary = async (word: string): Promise<DictionaryResult> => {
    const data = await callProxy('dictionary-free', { word });

    if (!Array.isArray(data) || data.length === 0) {
        throw new Error("Word not found in Free Dictionary.");
    }

    const entry = data[0];
    const phonetic = entry.phonetics?.find((p: any) => p.text && p.audio)?.text || entry.phonetic || '';
    const audioUrl = entry.phonetics?.find((p: any) => p.audio)?.audio;
    
    const definitions: string[] = [];
    const exampleSentences: string[] = [];
    let partOfSpeech = '';

    entry.meanings?.forEach((meaning: any) => {
        if (!partOfSpeech) {
             partOfSpeech = meaning.partOfSpeech || '';
        }
        meaning.definitions?.forEach((def: any) => {
            if (def.definition) {
                definitions.push(def.definition);
            }
            if (def.example) {
                exampleSentences.push(def.example);
            }
        });
    });

    return {
        pronunciation: phonetic,
        partOfSpeech: partOfSpeech,
        definitions: definitions,
        exampleSentences: exampleSentences,
        audioUrl: audioUrl,
    };
};

// --- Merriam-Webster API (dictionaryapi.com) ---
const getMwAudioUrl = (audio: string): string | undefined => {
    if (!audio) return undefined;
    let subdir = '';
    if (audio.startsWith('bix')) {
        subdir = 'bix';
    } else if (audio.startsWith('gg')) {
        subdir = 'gg';
    } else if (/^[0-9_]/.test(audio.charAt(0))) {
        subdir = 'number';
    } else {
        subdir = audio.charAt(0);
    }
    return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${subdir}/${audio}.mp3`;
};

// Helper to recursively find example sentences in MW's complex structure
const findMwExamples = (obj: any, examples: string[]) => {
    if (Array.isArray(obj)) {
        if (obj[0] === 'vis') { // 'vis' marks a "verbal illustration" (example)
            obj[1].forEach((item: any) => {
                if (item.t) {
                    // Clean the example text from formatting tags
                    const exampleText = item.t.replace(/{it}|{\/it}|{ldquo}|{rdquo}/g, '').replace(/ {dx}.*?{\/dx}/g, '');
                    examples.push(exampleText);
                }
            });
        } else {
            obj.forEach(item => findMwExamples(item, examples));
        }
    } else if (typeof obj === 'object' && obj !== null) {
        Object.values(obj).forEach(value => findMwExamples(value, examples));
    }
};


export const fetchFromMerriamWebster = async (word: string): Promise<DictionaryResult> => {
    const data = await callProxy('dictionary-mw', { word });
    
    if (!Array.isArray(data) || data.length === 0 || typeof data[0] !== 'object') {
        throw new Error("Word not found in Merriam-Webster.");
    }
    
    const entry = data[0];
    const pronunciation = entry.hwi?.prs?.[0]?.mw || '';
    const audioFile = entry.hwi?.prs?.[0]?.sound?.audio;

    const definitions = entry.shortdef || [];
    const exampleSentences: string[] = [];
    if (entry.def) {
        findMwExamples(entry.def, exampleSentences);
    }


    return {
        pronunciation: `/${pronunciation}/`,
        partOfSpeech: entry.fl || '',
        definitions: definitions,
        exampleSentences: exampleSentences,
        audioUrl: getMwAudioUrl(audioFile),
    };
};

// --- Audio Fetcher ---
export const fetchAudioData = async (url: string): Promise<string> => {
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