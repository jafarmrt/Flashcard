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
    // Never return a message as if it were a translation: it would be saved on the card.
    console.error("Error generating Persian details via proxy:", error);
    throw error;
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
  exclude?: string[]; // terms that already have a card
  includeGrammar?: boolean;
  options?: AiRequestOptions;
}

const KINDS = ['word', 'phrase', 'idiom', 'grammar'] as const;

export const buildExtractionPrompt = ({ text, level, count = 10, exclude = [], includeGrammar = true }: ExtractVocabularyParams): string => `You are an expert linguistics tutor helping a Persian-speaking student learn English.
Analyze the following text and extract up to ${count} valuable, high-impact items for a learner at level: "${level}".
Items can be single words ("word"), multi-word phrases such as phrasal verbs and collocations ("phrase"), idioms ("idiom")${includeGrammar ? ', and at most 2 notable grammar structures ("grammar")' : ''}.

CRITICAL INSTRUCTIONS:
1. Target level: "${level}". Skip items that are trivial for this level or far beyond it.
2. Give meanings for the sense used IN THIS TEXT, not the most common sense of the word.
3. ${exclude.length ? `The student already has cards for these; do NOT include them: ${JSON.stringify(exclude)}.` : 'Do not repeat the same item twice.'}
4. For each item:
   - "kind": one of ${JSON.stringify(includeGrammar ? KINDS : KINDS.filter(k => k !== 'grammar'))}.
   - "front": the base form ("reluctant", "take into account"). For grammar, a short name of the structure ("Past perfect").
   - "back": accurate, natural Persian translation of the item as used in the text.
   - "pronunciation": IPA ("/rɪˈlʌk.tənt/"); empty for grammar.
   - "partOfSpeech": "adj.", "v.", "n.", "phrasal verb", "idiom" or "grammar".
   - "definition": 1-2 concise English definitions (for grammar: what the structure expresses).
   - "sourceSentence": the EXACT sentence of the text where the item appears, copied verbatim.
   - "exampleSentenceTarget": 1-2 NEW example sentences (not the source sentence).
   - "collocations": 3-5 other common expressions that use this item, each with "phrase" and its Persian "meaning" (e.g. for "decision": "make a decision", "tough decision"). Empty for grammar.
   - "notes": a brief Persian memory aid, root explanation or usage tip.${includeGrammar ? `
   - For grammar only: "grammarPattern" (the form, e.g. "had + past participle") and "practicePrompt" (a short Persian instruction asking the student to write their own English sentence with this structure).` : ''}

Input Text:
"""
${text}
"""

Return a JSON object containing a "words" array.`;

const toStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : (v ? [String(v)] : []);

export const parseExtractedItems = (parsed: any): ExtractedWordCard[] =>
  (Array.isArray(parsed?.words) ? parsed.words : [])
    .filter((w: any) => w && typeof w.front === 'string' && w.front.trim())
    .map((w: any): ExtractedWordCard => ({
      front: w.front.trim(),
      back: w.back || '',
      pronunciation: w.pronunciation || '',
      partOfSpeech: w.partOfSpeech || '',
      definition: toStringArray(w.definition),
      exampleSentenceTarget: toStringArray(w.exampleSentenceTarget),
      notes: w.notes || '',
      kind: KINDS.includes(w.kind) ? w.kind : (String(w.front).trim().includes(' ') ? 'phrase' : 'word'),
      sourceSentence: typeof w.sourceSentence === 'string' && w.sourceSentence.trim() ? w.sourceSentence.trim() : undefined,
      collocations: (Array.isArray(w.collocations) ? w.collocations : [])
        .map((c: any) => (typeof c === 'string' ? { phrase: c } : { phrase: String(c?.phrase || ''), meaning: c?.meaning ? String(c.meaning) : undefined }))
        .filter((c: { phrase: string }) => c.phrase.trim()),
      grammarPattern: w.grammarPattern || undefined,
      practicePrompt: w.practicePrompt || undefined,
      selected: true,
    }));

export const extractVocabularyFromText = async (
  params: ExtractVocabularyParams
): Promise<ExtractedWordCard[]> => {
  const { options } = params;
  const prompt = buildExtractionPrompt(params);

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
                  kind: { type: 'STRING', enum: [...KINDS], description: 'word, phrase, idiom or grammar' },
                  front: { type: 'STRING', description: 'English target word, phrase or structure name' },
                  back: { type: 'STRING', description: 'Persian translation' },
                  pronunciation: { type: 'STRING', description: 'IPA pronunciation' },
                  partOfSpeech: { type: 'STRING', description: 'Part of speech' },
                  definition: { type: 'ARRAY', items: { type: 'STRING' }, description: 'English definitions' },
                  sourceSentence: { type: 'STRING', description: 'Exact sentence of the input text' },
                  exampleSentenceTarget: { type: 'ARRAY', items: { type: 'STRING' }, description: 'New example sentences' },
                  collocations: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        phrase: { type: 'STRING' },
                        meaning: { type: 'STRING', description: 'Persian meaning' },
                      },
                      required: ['phrase'],
                    },
                  },
                  notes: { type: 'STRING', description: 'Persian mnemonic or tip' },
                  grammarPattern: { type: 'STRING', description: 'Grammar only: the form' },
                  practicePrompt: { type: 'STRING', description: 'Grammar only: Persian practice instruction' },
                },
                required: ['kind', 'front', 'back']
              }
            }
          },
          required: ['words']
        }
      }
    });

    return parseExtractedItems(parseJsonFromAiResponse(response.text));
  } catch (error) {
    console.error('Error extracting vocabulary from text with AI:', error);
    throw error;
  }
};
