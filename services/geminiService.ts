// This service now sends requests to our own secure proxy on Vercel
// instead of directly to the Google GenAI API. This protects the API key.

export interface FlashcardDetails {
  back: string; // Persian translation
  pronunciation: string;
  partOfSpeech: string;
  definition: string;
  exampleSentenceTarget: string;
  notes: string;
}

// A helper function to call our secure proxy
const callProxy = async (body: object) => {
    const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'gemini-generate', ...body }),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Proxy request failed');
    }
    return response.json();
};


export const generateFlashcardDetails = async (englishWord: string): Promise<FlashcardDetails> => {
  try {
    const prompt = `You are an expert English language tutor for a native Persian speaker.
I will give you an English word or phrase.
Your task is to provide all the necessary details for a language learning flashcard in a JSON format.

The English word is: "${englishWord}"

Please provide the following:
1. "translation": The Persian translation.
2. "pronunciation": The phonetic pronunciation, preferably in IPA format (e.g., /həˈloʊ/).
3. "partOfSpeech": The grammatical part of speech (e.g., "Noun", "Verb", "Adjective").
4. "definition": A simple English definition of the word, suitable for a language learner.
5. "exampleSentence": A simple example sentence in English using the word.
6. "notes": A brief note or mnemonic in Persian to help remember the word.`;

    const response = await callProxy({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: 'OBJECT',
          properties: {
            translation: { type: 'STRING', description: 'The Persian translation of the English word.' },
            pronunciation: { type: 'STRING', description: 'The IPA phonetic pronunciation.' },
            partOfSpeech: { type: 'STRING', description: 'The grammatical part of speech.' },
            definition: { type: 'STRING', description: 'A simple English definition for the word.' },
            exampleSentence: { type: 'STRING', description: 'An example sentence in English.' },
            notes: { type: 'STRING', description: 'A helpful note or mnemonic in Persian.' },
          },
          required: ["translation", "pronunciation", "partOfSpeech", "definition", "exampleSentence", "notes"],
        },
      },
    });

    const jsonText = response.text.trim();
    const parsed = JSON.parse(jsonText);
    
    return {
      back: parsed.translation || '',
      pronunciation: parsed.pronunciation || '',
      partOfSpeech: parsed.partOfSpeech || '',
      definition: parsed.definition || '',
      exampleSentenceTarget: parsed.exampleSentence || '',
      notes: parsed.notes || '',
    };
  } catch (error) {
    console.error("Error generating flashcard details via proxy:", error);
    return {
      back: "Could not generate translation.",
      pronunciation: "",
      partOfSpeech: "",
      definition: "",
      exampleSentenceTarget: "Could not generate an example sentence.",
      notes: "",
    };
  }
};

// Helper function to encode bytes to base64
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper function to decode base64 to bytes
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export const generateAudio = async (text: string): Promise<string | undefined> => {
    try {
        const response = await callProxy({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Zephyr' },
                    },
                },
            },
        });
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
            const pcmData = decode(base64Audio);
            
            // Create a WAV file header and combine it with the PCM data
            const sampleRate = 24000;
            const numChannels = 1;
            const bitsPerSample = 16;
            const dataSize = pcmData.length;
            const blockAlign = (numChannels * bitsPerSample) / 8;
            const byteRate = sampleRate * blockAlign;
            const buffer = new ArrayBuffer(44 + dataSize);
            const view = new DataView(buffer);

            const writeString = (view: DataView, offset: number, string: string) => {
              for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
              }
            };
            
            writeString(view, 0, 'RIFF');
            view.setUint32(4, 36 + dataSize, true);
            writeString(view, 8, 'WAVE');
            writeString(view, 12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true); // PCM format
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, byteRate, true);
            view.setUint16(32, blockAlign, true);
            view.setUint16(34, bitsPerSample, true);
            writeString(view, 36, 'data');
            view.setUint32(40, dataSize, true);
            new Uint8Array(buffer, 44).set(pcmData);

            const wavBytes = new Uint8Array(buffer);
            const base64Wav = encode(wavBytes);
            return `data:audio/wav;base64,${base64Wav}`;
        }
        return undefined;
    } catch (error) {
        console.error("Error generating audio:", error);
        return undefined;
    }
};

export const getGrammarExplanation = async (sentence: string): Promise<string> => {
    try {
        const prompt = `You are an expert English grammar teacher for a native Persian speaker.
        Explain the grammar of the following English sentence in simple, clear terms.
        Provide the explanation in Persian. Be concise and focus on the main grammatical points.
        Sentence: "${sentence}"`;
        
        const response = await callProxy({
            model: "gemini-2.5-flash",
            contents: prompt,
        });
        return response.text;
    } catch (error) {
        console.error("Error generating grammar explanation:", error);
        return "Sorry, I couldn't generate a grammar explanation at this time.";
    }
};

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = (reader.result as string).split(',')[1];
      resolve(base64data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const getPronunciationFeedback = async (word: string, audioBase64: string, mimeType: string): Promise<string> => {
    try {
        const audioPart = {
            inlineData: {
                mimeType: mimeType,
                data: audioBase64,
            },
        };
        const textPart = {
            text: `I am a Persian speaker learning English. This is my attempt at pronouncing the word "${word}".
            Please listen to the audio and provide simple, concise, and encouraging feedback in Persian.
            For example: "تلفظ عالی بود!" or "خوب بود، اما سعی کن صدای 'r' را واضح‌تر بگویی."`
        };
        const response = await callProxy({
            model: 'gemini-2.5-pro',
            contents: { parts: [textPart, audioPart] },
        });
        return response.text;
    } catch(error) {
        console.error("Error generating pronunciation feedback:", error);
        return "Sorry, I couldn't analyze the pronunciation at this time.";
    }
};

export const generateQuizOptions = async (cardFront: string, cardBack: string): Promise<string[]> => {
    try {
        const prompt = `You are a quiz generator for a Persian speaker learning English.
        The English word is "${cardFront}". The correct Persian translation is "${cardBack}".
        Your task is to create 3 other plausible but incorrect Persian translations for "${cardFront}".
        These incorrect options should be common mistakes or similar-sounding words.
        Return ONLY a JSON array of 3 strings. Do not include the correct answer in the array.
        Example output for the word "happy": ["سریع", "کتاب", "آبی"]`;
        
        const response = await callProxy({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: 'ARRAY',
                    items: { type: 'STRING' }
                }
            }
        });
        const jsonText = response.text.trim();
        const options = JSON.parse(jsonText);
        return Array.isArray(options) ? options.slice(0, 3) : [];
    } catch (error) {
        console.error("Error generating quiz options:", error);
        return [];
    }
};