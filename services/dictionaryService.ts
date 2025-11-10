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
    definition: string;
    exampleSentence: string;
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
    const meaning = entry.meanings?.[0];
    const definition = meaning?.definitions?.[0];

    return {
        pronunciation: phonetic,
        partOfSpeech: meaning?.partOfSpeech || '',
        definition: definition?.definition || '',
        exampleSentence: definition?.example || '',
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


export const fetchFromMerriamWebster = async (word: string): Promise<DictionaryResult> => {
    const data = await callProxy('dictionary-mw', { word });
    
    if (!Array.isArray(data) || data.length === 0 || typeof data[0] !== 'object') {
        throw new Error("Word not found in Merriam-Webster.");
    }
    
    const entry = data[0];
    const pronunciation = entry.hwi?.prs?.[0]?.mw || '';
    const audioFile = entry.hwi?.prs?.[0]?.sound?.audio;

    // Extract example sentence - it can be nested inside definitions.
    let example = '';
    const sense = entry.def?.[0]?.sseq?.[0]?.[0]?.[1];
    if (sense?.dt?.[1]?.[1]?.[0]?.t) {
       example = sense.dt[1][1][0].t.replace(/{it}|{\/it}/g, ''); // remove italic tags
    }

    return {
        pronunciation: `/${pronunciation}/`,
        partOfSpeech: entry.fl || '',
        definition: entry.shortdef?.[0] || '',
        exampleSentence: example,
        audioUrl: getMwAudioUrl(audioFile),
    };
};

// --- Audio Fetcher ---
export const fetchAudioData = async (url: string): Promise<string> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch audio file');
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};
