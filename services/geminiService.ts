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
        const prompt = `You are an expert Instructional Designer and Applied Linguist specializing in English vocabulary acquisition. Your task is to create a set of high-quality, multiple-choice quiz questions based on a provided list of target words. For each target word, you must follow this two-phase process strictly:

**Phase 1: Context Generation**
1.  **Analyze the Word:** For the given English [Target Word], identify its most common meaning and part of speech.
2.  **Create a Source Sentence:** Write a clear, concise, and educational English sentence that uses the [Target Word] in its most common context. This sentence should provide strong contextual clues to the word's meaning.

**Phase 2: Question Design**
1.  **Use the Cloze Template:** Take the source sentence you just created and replace the [Target Word] with a blank (__________), forming the main question text.
2.  **Engineer Distractors:** Create three plausible but incorrect English distractor options. These distractors, along with the correct [Target Word], must all be the same part of speech and grammatically fit the blank. The distractors must be a clever mix of:
    *   **Antonym:** The opposite of the target word.
    *   **Close Semantic Competitor:** A word with a similar but incorrect meaning in context.
    *   **Phonetic/Orthographic Similarity:** A word that looks or sounds similar.
    *   **Contextual Mismatch:** A word that is plausible in general but doesn't fit the specific sentence context.
3.  **Finalize the Question:** Assemble the question, the four options (including the correct answer), and identify the correct option. Randomize the position of the correct answer among the four options.

**Input:**
You will be given a JSON array of English target words.

**Output Format (MANDATORY):**
You MUST return a single JSON object containing a key "questions" which is an array of JSON objects. Each object in the array must strictly adhere to the following structure:

{
  "targetWord": "string",
  "sourceSentence": "string",
  "questionText": "string",
  "options": ["string", "string", "string", "string"],
  "correctAnswer": "string"
}

Example for one question:
{
  "targetWord": "Ephemeral",
  "sourceSentence": "The beauty of the cherry blossoms is ephemeral, lasting only for a week or two.",
  "questionText": "The beauty of the cherry blossoms is __________, lasting only for a week or two.",
  "options": ["Permanent", "Delicate", "Ephemeral", "Empirical"],
  "correctAnswer": "Ephemeral"
}

Now, generate the questions for the following list of words:
${JSON.stringify(targetWords)}
`;

        const response = await callProxy({
            model: "gemini-2.5-pro",
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