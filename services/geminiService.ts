// File: /services/geminiService.ts
// Handles Gemini API calls via backend server proxy with support for custom API keys and models.

import { Flashcard, ExtractedWordCard, CardOrigin, CardKind, CefrLevel } from '../types';
import { CARD_KINDS, parseCardKind } from './cardKinds';
import { callProxy } from './apiService';
import { aiGenerate, providerFields } from './aiClient';
import { aiOrigin } from './aiSettings';
import { ruleForName } from './grammarPatterns';

export { providerFields };

export interface PersianDetails {
  back: string; // Persian translation
  notes: string;
  origin?: CardOrigin; // the service that answered
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
  fallbacks?: AiRequestOptions[]; // tried in order when this one fails (services/aiClient)
}


// Models wrap JSON in code fences, add a sentence before it, or stop early.
// Take the first JSON object or array found in the reply.
export const parseJsonFromAiResponse = (text: string) => {
  const clean = String(text || '').replace(/```(?:json)?/gi, '').trim();
  if (!clean) throw new Error('The AI sent an empty reply.');
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.search(/[[{]/);
    const end = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(clean.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new Error('The AI reply was not valid JSON.');
  }
};

export const testAiConnection = async (options?: AiRequestOptions): Promise<{ ok: boolean; message: string }> => {
  try {
    const res = await callProxy('test-ai-key', {
      ...providerFields(options),
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

    const response = await aiGenerate(options, {
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
    }, 'details');

    const parsed = parseJsonFromAiResponse(response.text);
    
    return {
      back: parsed.translation || '',
      notes: parsed.notes || '',
      origin: aiOrigin(response.used),
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
    // Only Gemini hears audio: the other services are not asked.
    const response = await aiGenerate({ ...options, aiProvider: 'gemini', fallbacks: undefined }, {
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
    }, 'pronunciation');
    
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

    const response = await aiGenerate(options, {
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
    }, 'quiz');
    
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
  kinds?: CardKind[]; // what to look for (services/cardKinds); all when unset
  options?: AiRequestOptions;
}

const KINDS = CARD_KINDS;
export const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const parseLevel = (value: unknown): CefrLevel | undefined => {
  const level = String(value || '').trim().toUpperCase();
  return (CEFR_LEVELS as string[]).includes(level) ? (level as CefrLevel) : undefined;
};

// How each kind is described to the AI.
const KIND_GUIDE: Record<CardKind, string> = {
  word: '"word": a single hard word.',
  phrase: '"phrase": a phrasal verb or other multi-word verb ("give up", "come across", "put up with"), also when its parts are split ("took it into account").',
  collocation: '"collocation": a fixed word partnership a learner would not guess and should learn whole ("make a decision", "heavy rain", "bitterly cold", "pay attention").',
  idiom: '"idiom": a figurative expression whose meaning is not the sum of its words ("spill the beans", "a blessing in disguise").',
  expression: '"expression": a fixed or conversational expression, saying or discourse marker ("no wonder", "by the way", "it goes without saying", "to make matters worse").',
  slang: '"slang": informal or slang usage, including an ordinary word used in a slang sense ("broke" = without money, "ghost someone").',
  grammar: '"grammar": a hard or notable grammar structure ("Had I known…" inversion, mixed conditional, cleft sentence, participle clause).',
};

// The kinds asked for: the chosen ones (single words always), grammar only
// when it is included.
export const wantedKinds = ({ includeGrammar = true, kinds }: Pick<ExtractVocabularyParams, 'includeGrammar' | 'kinds'>): CardKind[] =>
  (kinds && kinds.length ? KINDS.filter(k => k === 'word' || kinds.includes(k)) : [...KINDS])
    .filter(k => k !== 'grammar' || includeGrammar);

export const buildExtractionPrompt = ({ text, level, count = 10, exclude = [], includeGrammar = true, kinds }: ExtractVocabularyParams): string => {
  const wanted = wantedKinds({ includeGrammar, kinds });
  const grammar = wanted.includes('grammar');
  const multi = wanted.filter(k => k !== 'word' && k !== 'grammar');
  return `You are an expert linguistics tutor helping a Persian-speaking student learn English.
Analyze the following text and extract up to ${count} valuable, high-impact items for a learner at level: "${level}".

Look for these kinds of items:
${wanted.map(k => `- ${KIND_GUIDE[k]}`).join('\n')}

CRITICAL INSTRUCTIONS:
1. Target level: "${level}". Skip items that are trivial for this level or far beyond it.${multi.length ? `
2. Read EVERY sentence for multi-word items (${multi.join(', ')}) before choosing single words. A multi-word item is worth a card when its meaning is not obvious from its words, even when every word in it is easy ("put up with", "make up for"). When the text has them, at least half of the items should be multi-word items; never return only single words if the text contains such items.` : ''}
3. Give meanings for the sense used IN THIS TEXT, not the most common sense of the word.
4. ${exclude.length ? `The student already has cards for these; do NOT include them: ${JSON.stringify(exclude)}.` : 'Do not repeat the same item twice.'}${grammar ? `
5. At most 2 grammar items, and only structures that are hard for this level.` : ''}
6. For each item:
   - "kind": one of ${JSON.stringify(wanted)}.
   - "front": the base or dictionary form ("reluctant", "take into account", "spill the beans"). For grammar, a short name of the structure ("Past perfect").
   - "back": accurate, natural Persian translation of the item as used in the text (for idioms and slang, the Persian equivalent meaning, not a word-for-word translation).
   - "pronunciation": IPA ("/rɪˈlʌk.tənt/"); empty for grammar.
   - "partOfSpeech": "adj.", "v.", "n.", "phrasal verb", "collocation", "idiom", "expression", "slang" or "grammar".
   - "level": the CEFR level of the item: "A1", "A2", "B1", "B2", "C1" or "C2".
   - "definition": 1-2 concise English definitions (for grammar: what the structure expresses).
   - "sourceSentence": the EXACT sentence of the text where the item appears, copied verbatim.
   - "exampleSentenceTarget": 1-2 NEW example sentences (not the source sentence).
   - "collocations": 3-5 other common expressions that use this item, each with "phrase" and its Persian "meaning" (e.g. for "decision": "make a decision", "tough decision"). Empty for grammar.
   - "notes": a brief Persian memory aid, root explanation or usage tip (for slang: how informal it is and where it is used).${grammar ? `
   - For grammar only: "grammarPattern" (the form, e.g. "had + past participle") and "practicePrompt" (a short Persian instruction asking the student to write their own English sentence with this structure).` : ''}

Input Text:
"""
${text}
"""

Return a JSON object containing a "words" array.`;
};

const toStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : (v ? [String(v)] : []);

// The list of items in a parsed reply: {"words": [...]}, a bare array, or an
// object whose only array uses another key ("items", "vocabulary", ...).
const itemList = (parsed: any): any[] | null => {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return null;
  if (Array.isArray(parsed.words)) return parsed.words;
  const arrays = Object.values(parsed).filter(Array.isArray) as any[][];
  return arrays.length > 0 ? arrays[0] : null;
};

// Throws when the reply holds no list at all, so the caller can fall back
// to the free dictionaries instead of silently finding nothing.
export const parseExtractedItems = (parsed: any): ExtractedWordCard[] => {
  const list = itemList(parsed);
  if (!list) throw new Error('The AI reply had no list of words.');
  return list
    .filter((w: any) => w && typeof w.front === 'string' && w.front.trim())
    .map((w: any): ExtractedWordCard => {
      const kind = parseCardKind(w.kind) || (String(w.front).trim().includes(' ') ? 'phrase' : 'word');
      return {
        front: w.front.trim(),
        back: typeof w.back === 'string' ? w.back.trim() : '',
        pronunciation: w.pronunciation || '',
        partOfSpeech: w.partOfSpeech || '',
        definition: toStringArray(w.definition),
        exampleSentenceTarget: toStringArray(w.exampleSentenceTarget),
        notes: w.notes || '',
        kind,
        sourceSentence: typeof w.sourceSentence === 'string' && w.sourceSentence.trim() ? w.sourceSentence.trim() : undefined,
        collocations: (Array.isArray(w.collocations) ? w.collocations : [])
          .map((c: any) => (typeof c === 'string' ? { phrase: c } : { phrase: String(c?.phrase || ''), meaning: c?.meaning ? String(c.meaning) : undefined }))
          .filter((c: { phrase: string }) => c.phrase.trim()),
        grammarPattern: w.grammarPattern || undefined,
        practicePrompt: w.practicePrompt || undefined,
        ...(kind !== 'grammar' && parseLevel(w.level) ? { level: parseLevel(w.level) } : {}),
        ...(kind === 'grammar' && ruleForName(String(w.front), w.grammarPattern) ? { grammarId: ruleForName(String(w.front), w.grammarPattern)!.id } : {}),
        selected: true,
      };
    });
};

export const extractVocabularyFromText = async (
  params: ExtractVocabularyParams
): Promise<ExtractedWordCard[]> => {
  const { options } = params;
  const prompt = buildExtractionPrompt(params);
  const wanted = wantedKinds(params);

  try {
    const response = await aiGenerate(options, {
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
                  kind: { type: 'STRING', enum: wanted, description: wanted.join(', ') },
                  front: { type: 'STRING', description: 'English target word, phrase or structure name' },
                  back: { type: 'STRING', description: 'Persian translation' },
                  pronunciation: { type: 'STRING', description: 'IPA pronunciation' },
                  partOfSpeech: { type: 'STRING', description: 'Part of speech' },
                  level: { type: 'STRING', enum: [...CEFR_LEVELS], description: 'CEFR level' },
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
    }, 'extract');

    const origin = aiOrigin(response.used);
    // A model may still send a kind that was switched off: it is left out.
    return parseExtractedItems(parseJsonFromAiResponse(response.text))
      .filter(card => wanted.includes(card.kind || 'word'))
      .map(card => ({ ...card, origin }));
  } catch (error) {
    console.error('Error extracting vocabulary from text with AI:', error);
    throw error;
  }
};
