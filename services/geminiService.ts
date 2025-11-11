// This service now sends requests to our own secure proxy on Vercel
// instead of directly to the Google GenAI API. This protects the API key.

import { Flashcard } from '../types';

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

export interface InstructionalQuizQuestion {
  targetWord: string;
  sourceSentence: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
}

export const generateInstructionalQuiz = async (cards: Flashcard[]): Promise<InstructionalQuizQuestion[]> => {
    try {
        const targetWords = cards.map(c => c.front);
        const prompt = `You are an English teacher creating a multiple-choice quiz. For each word in the provided list, do the following:
1.  Write a clear sentence that uses the word in context. This will be the "sourceSentence".
2.  Create a fill-in-the-blank question by replacing the target word in the sentence with "__________". This will be the "questionText".
3.  Provide four options: the correct target word and three other plausible but incorrect English words that fit grammatically. The options should be an array of strings.
4.  Identify the correct answer.

Generate a quiz for these words: ${JSON.stringify(targetWords)}

Return the output as a single JSON object with a key "questions", which is an array of objects. Each object must have these keys: "targetWord", "sourceSentence", "questionText", "options", and "correctAnswer".
`;

        const response = await callProxy({
            model: "gemini-2.5-flash", // Use the faster model
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        questions: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    targetWord: { type: 'STRING' },
                                    sourceSentence: { type: 'STRING' },
                                    questionText: { type: 'STRING' },
                                    options: { type: 'ARRAY', items: { type: 'STRING' } },
                                    correctAnswer: { type: 'STRING' },
                                },
                                required: ["targetWord", "sourceSentence", "questionText", "options", "correctAnswer"]
                            }
                        }
                    },
                    required: ["questions"]
                }
            }
        });
        const jsonText = response.text.trim();
        const parsed = JSON.parse(jsonText);
        
        return parsed.questions || [];

    } catch (error) {
        console.error("Error generating instructional quiz:", error);
        return [];
    }
};
