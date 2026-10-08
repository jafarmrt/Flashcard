// File: /services/geminiService.ts
// Handles Gemini API calls via backend server proxy with support for custom API keys and models.

import { Flashcard, ExtractedWordCard } from '../types';
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

export interface AiRequestOptions {
  aiProvider?: 'gemini' | 'openai-compatible';
  aiBaseUrl?: string;
  customApiKey?: string;
  model?: string;
}

const parseJsonFromAiResponse = (text: string) => {
  let cleanText = text.trim();
  // Fix: Strip markdown wrapper if present
  if (cleanText.startsWith('```json')) {
    cleanText = cleanText.substring(7);
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.slice(0, -3);
    }
  } else if (cleanText.startsWith('```')) {
    cleanText = cleanText.substring(3);
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.slice(0, -3);
    }
  }
  cleanText = cleanText.trim();
  if (!cleanText) {
    throw new Error("Received empty response from AI proxy.");
  }
  return JSON.parse(cleanText);
};

export const testAiConnection = async (options?: AiRequestOptions): Promise<{ ok: boolean; message: string }> => {
  try {
    const res = await callProxy('test-ai-key', {
      aiProvider: options?.aiProvider || 'gemini',
      aiBaseUrl: options?.aiBaseUrl || undefined,
      customApiKey: options?.customApiKey || undefined,
      model: options?.model || (options?.aiProvider === 'openai-compatible' ? 'llama-3.3-70b-versatile' : 'gemini-2.5-flash'),
    });
    if (res && res.text) {
      return { ok: true, message: `Connected successfully (${options?.model || 'default'})` };
    }
    return { ok: true, message: 'Connected successfully!' };
  } catch (error) {
    return { ok: false, message: (error as Error).message || 'Connection failed' };
  }
};

export const generatePersianDetails = async (englishWord: string, options?: AiRequestOptions): Promise<PersianDetails> => {
  try {
    const prompt = `You are an expert English language tutor for a native Persian speaker.
I will give you an English word or phrase.
Your task is to provide a Persian translation and a helpful note for a flashcard in JSON format.

The English word is: "${englishWord}"

Please provide the following:
1. "translation": The most common Persian translation.
2. "notes": A brief note or mnemonic in Persian to help remember the word. For example, mention a root word, a similar sounding Persian word, or a cultural context.`;

    const response = await callProxy('gemini-generate', {
      aiProvider: options?.aiProvider || 'gemini',
      aiBaseUrl: options?.aiBaseUrl || undefined,
      model: options?.model || (options?.aiProvider === 'openai-compatible' ? 'llama-3.3-70b-versatile' : "gemini-2.5-flash"),
      customApiKey: options?.customApiKey || undefined,
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

export const getPronunciationFeedback = async (
  word: string,
  audioBase64: string,
  mimeType: string,
  options?: AiRequestOptions
): Promise<string> => {
  try {
    const result = await evaluatePronunciation(word, audioBase64, mimeType, options);
    return result.feedback;
  } catch (error) {
    return "Sorry, I couldn't analyze the pronunciation at this time.";
  }
};

export const evaluatePronunciation = async (
  word: string,
  audioBase64: string,
  mimeType: string,
  options?: AiRequestOptions
): Promise<PronunciationResult> => {
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
      model: options?.model || 'gemini-2.5-pro',
      customApiKey: options?.customApiKey || undefined,
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
  } catch (error) {
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

export const generateInstructionalQuiz = async (cards: Flashcard[], options?: AiRequestOptions): Promise<InstructionalQuizQuestion[]> => {
  try {
    const targetWords = cards.map(c => c.front);
    const prompt = `You are an English teacher creating a multiple-choice quiz. For each word in the provided list, do the following:
1. Write a clear sentence that uses the word in context. This will be the "sourceSentence".
2. Create a fill-in-the-blank question by replacing the target word in the sentence with "__________". This will be the "questionText".
3. Provide four options: the correct target word and three other plausible but incorrect English words that fit grammatically. The options should be an array of strings.
4. Identify the correct answer.

Generate a quiz for these words: ${JSON.stringify(targetWords)}

Return the output as a single JSON object with a key "questions", which is an array of objects. Each object must have these keys: "targetWord", "sourceSentence", "questionText", "options", and "correctAnswer".
`;

    const response = await callProxy('gemini-generate', {
      model: options?.model || "gemini-2.5-flash",
      customApiKey: options?.customApiKey || undefined,
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

export interface ExtractVocabularyParams {
  text: string;
  level: string; // 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'IELTS' | 'TOEFL' | string
  count?: number;
  options?: AiRequestOptions;
}

export const extractVocabularyFromText = async (
  params: ExtractVocabularyParams
): Promise<ExtractedWordCard[]> => {
  const { text, level, count = 10, options } = params;
  
  const prompt = `You are an expert linguistics tutor helping a Persian-speaking student learn English.
Analyze the following text and extract up to ${count} valuable, high-impact vocabulary items, phrasal verbs, or idioms tailored specifically for a learner at level: "${level}".

CRITICAL INSTRUCTIONS:
1. Target level: "${level}". Focus on words that are neither too trivial nor overwhelmingly difficult for this specific level.
2. For each extracted word:
   - "front": The base English word or phrase (e.g. "reluctant", "take into account", "resilient").
   - "back": Accurate, natural Persian translation(s).
   - "pronunciation": Standard IPA pronunciation (e.g. "/rɪˈlʌk.tənt/").
   - "partOfSpeech": Part of speech in English (e.g. "adj.", "v.", "phrasal verb", "n.").
   - "definition": An array containing 1-2 concise, clear English definitions.
   - "exampleSentenceTarget": An array with 1-2 example sentences, prioritizing the exact or adapted sentence from the provided text where the word appears.
   - "notes": A brief, engaging Persian memory aid, mnemonic tip, Persian phonetic similarity, or root explanation to help remember the word.

Input Text:
"""
${text}
"""

Return a JSON object containing a "words" array.`;

  try {
    const response = await callProxy('gemini-generate', {
      aiProvider: options?.aiProvider || 'gemini',
      aiBaseUrl: options?.aiBaseUrl || undefined,
      model: options?.model || (options?.aiProvider === 'openai-compatible' ? 'llama-3.3-70b-versatile' : 'gemini-2.5-flash'),
      customApiKey: options?.customApiKey || undefined,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            words: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  front: { type: 'STRING', description: 'English target word or phrase' },
                  back: { type: 'STRING', description: 'Persian translation' },
                  pronunciation: { type: 'STRING', description: 'IPA pronunciation' },
                  partOfSpeech: { type: 'STRING', description: 'Part of speech' },
                  definition: { 
                    type: 'ARRAY', 
                    items: { type: 'STRING' },
                    description: 'English definitions' 
                  },
                  exampleSentenceTarget: { 
                    type: 'ARRAY', 
                    items: { type: 'STRING' },
                    description: 'Contextual example sentences' 
                  },
                  notes: { type: 'STRING', description: 'Persian mnemonic or tip' },
                },
                required: ['front', 'back']
              }
            }
          },
          required: ['words']
        }
      }
    });

    const parsed = parseJsonFromAiResponse(response.text);
    const words: ExtractedWordCard[] = (parsed.words || []).map((w: any) => ({
      front: w.front || '',
      back: w.back || '',
      pronunciation: w.pronunciation || '',
      partOfSpeech: w.partOfSpeech || '',
      definition: Array.isArray(w.definition) ? w.definition : (w.definition ? [String(w.definition)] : []),
      exampleSentenceTarget: Array.isArray(w.exampleSentenceTarget) ? w.exampleSentenceTarget : (w.exampleSentenceTarget ? [String(w.exampleSentenceTarget)] : []),
      notes: w.notes || '',
      selected: true,
    }));

    return words;
  } catch (error) {
    console.error('Error extracting vocabulary from text with AI:', error);
    throw error;
  }
};