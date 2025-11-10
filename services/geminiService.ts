// This service now sends requests to our own secure proxy on Vercel
// instead of directly to the Google GenAI API. This protects the API key.

export interface PersianDetails {
  back: string; // Persian translation
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


export const generatePersianDetails = async (englishWord: string): Promise<PersianDetails> => {
  try {
    const prompt = `You are an expert English language tutor for a native Persian speaker.
I will give you an English word or phrase.
Your task is to provide a Persian translation and a helpful note for a flashcard in JSON format.

The English word is: "${englishWord}"

Please provide the following:
1. "translation": The most common Persian translation.
2. "notes": A brief note or mnemonic in Persian to help remember the word. For example, mention a root word, a similar sounding Persian word, or a cultural context.`;

    const response = await callProxy({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: 'OBJECT',
          properties: {
            translation: { type: 'STRING', description: 'The Persian translation of the English word.' },
            notes: { type: 'STRING', description: 'A helpful note or mnemonic in Persian.' },
          },
          required: ["translation", "notes"],
        },
      },
    });

    const jsonText = response.text.trim();
    const parsed = JSON.parse(jsonText);
    
    return {
      back: parsed.translation || '',
      notes: parsed.notes || '',
    };
  } catch (error) {
    console.error("Error generating Persian details via proxy:", error);
    return {
      back: "Could not generate translation.",
      notes: "Could not generate notes.",
    };
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