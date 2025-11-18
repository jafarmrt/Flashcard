// This service now sends requests to our own secure proxy on Vercel
// instead of directly to the Google GenAI API. This protects the API key.

import { Flashcard } from '../types';
import { callProxy } from './apiService';

export interface PersianDetails {
  back: string; // Persian translation
  notes: string;
}

export interface PronunciationResult {
  score: number; // 0-100
  feedback: string; // Persian feedback
  correction?: string; // Optional IPA or phonetic correction
}

const parseJsonFromAiResponse = (text: string) => {
    let cleanText = text.trim();
    // Fix: The AI model sometimes wraps its JSON output in markdown.
    // This removes the markdown wrapper before parsing.
    if (cleanText.startsWith('```json')) {
        cleanText = cleanText.substring(7);
        if (cleanText.endsWith('```')) {
            cleanText = cleanText.slice(0, -3);
        }
    }
    if (!cleanText) {
        throw new Error("Received empty response from AI proxy.");
    }
    return JSON.parse(cleanText);
}


export const generatePersianDetails = async (englishWord: string): Promise<PersianDetails> => {
  try {
    const prompt = `You are an expert English language tutor for a native Persian speaker.
I will give you an English word or phrase.
Your task is to provide a Persian translation and a helpful note for a flashcard in JSON format.

The English word is: "${englishWord}"

Please provide the following:
1. "translation": The most common Persian translation.
2. "notes": A brief note or mnemonic in Persian to help remember the word. For example, mention a root word, a similar sounding Persian word, or a cultural context.`;

    const response = await callProxy('gemini-generate', {
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

    const parsed = parseJsonFromAiResponse(response.text);
    
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
        const result = await evaluatePronunciation(word, audioBase64, mimeType);
        return result.feedback;
    } catch(error) {
        return "Sorry, I couldn't analyze the pronunciation at this time.";
    }
};

export const evaluatePronunciation = async (word: string, audioBase64: string, mimeType: string): Promise<PronunciationResult> => {
    try {
        const audioPart = {
            inlineData: {
                mimeType: mimeType,
                data: audioBase64,
            },
        };
        const textPart = {
            text: `I am a Persian speaker learning English. This is my attempt at pronouncing the word "${word}".
            Please listen to the audio and evaluate it. Return a JSON object with:
            1. "score": A number between 0 and 100.
            2. "feedback": Concise, encouraging feedback in Persian.
            3. "correction": Optional IPA correction if needed.`
        };
        const response = await callProxy('gemini-generate', {
            model: 'gemini-2.5-pro', // Using Pro for better audio analysis
            contents: { parts: [textPart, audioPart] },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        score: { type: 'INTEGER' },
                        feedback: { type: 'STRING' },
                        correction: { type: 'STRING' }
                    },
                    required: ["score", "feedback"]
                }
            }
        });
        
        return parseJsonFromAiResponse(response.text);
    } catch(error) {
        console.error("Error evaluating pronunciation:", error);
        throw error;
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

        const response = await callProxy('gemini-generate', {
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
        
        const parsed = parseJsonFromAiResponse(response.text);
        
        return parsed.questions || [];

    } catch (error) {
        console.error("Error generating instructional quiz:", error);
        return [];
    }
};