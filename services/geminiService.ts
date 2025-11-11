import { Flashcard } from '../types';

// Helper to call our secure proxy for Gemini API requests
async function callProxy(action: 'gemini-generate', payload: object): Promise<any> {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Request failed');
    }
    return response.json();
}

/**
 * Converts a Blob object to a base64 encoded string.
 */
export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // The result is a data URL like "data:audio/webm;base64,..."
      // We only need the base64 part.
      const base64String = (reader.result as string).split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * Generates Persian translation and notes for an English word using the AI model.
 */
export async function generatePersianDetails(englishWord: string): Promise<{ back: string; notes: string }> {
    const prompt = `For the English word "${englishWord}", provide a concise one-word Persian translation and a simple, helpful mnemonic or note in Persian for memorization. Return the response as a JSON object with two keys: "back" (the Persian translation) and "notes" (the mnemonic). Example for "happy": {"back": "خوشحال", "notes": "مثل حس خوب بعد از خوردن یک غذای خوشمزه"}`;

    const response = await callProxy('gemini-generate', {
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json",
        },
    });
    
    try {
        const result = JSON.parse(response.text);
        return {
            back: result.back || '',
            notes: result.notes || '',
        };
    } catch (e) {
        console.error("Failed to parse AI response for details:", response.text, e);
        throw new Error("AI response was not valid JSON.");
    }
}

/**
 * Gets pronunciation feedback for an audio recording of a word.
 */
export async function getPronunciationFeedback(word: string, audioBase64: string, mimeType: string): Promise<string> {
    const prompt = `Analyze the provided audio recording of the English word "${word}". Provide brief, constructive feedback on the pronunciation. Focus on one key area for improvement. If it's good, say so. Keep it under 15 words.`;

    const audioPart = {
        inlineData: {
            mimeType: mimeType,
            data: audioBase64,
        },
    };

    const textPart = { text: prompt };

    const response = await callProxy('gemini-generate', {
        model: 'gemini-2.5-pro', // A model that can handle audio
        contents: { parts: [textPart, audioPart] },
        config: {},
    });

    return response.text.trim();
}

/**
 * Defines the structure for a question in the instructional quiz.
 */
export interface InstructionalQuizQuestion {
    sourceSentence: string;
    questionText: string;
    options: string[];
    correctAnswer: string;
}

/**
 * Generates an instructional quiz based on a list of flashcards.
 */
export async function generateInstructionalQuiz(cards: Flashcard[]): Promise<InstructionalQuizQuestion[]> {
    if (cards.length < 4) {
        throw new Error("Need at least 4 cards to generate a quiz.");
    }

    const cardList = cards.map(c => `"${c.front}": "${c.back}"`).join('\n');

    const prompt = `Based on this list of English-to-Persian vocabulary:\n${cardList}\n\nGenerate a multiple-choice quiz of ${cards.length} questions. Each question should test one of the English words. Provide an English "sourceSentence" where the word is used in context, a "questionText" that asks for the correct Persian translation, four "options" (one correct, three plausible distractors from the provided list), and the "correctAnswer". Return the result as a JSON array of objects, where each object has keys: "sourceSentence", "questionText", "options", "correctAnswer". Ensure options are shuffled for each question.`;

    const response = await callProxy('gemini-generate', {
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json",
        },
    });

    try {
        const result = JSON.parse(response.text);
        if (Array.isArray(result)) {
            // Basic validation to ensure the response shape is correct
            return result.filter(q => q.sourceSentence && q.questionText && q.options && q.correctAnswer);
        }
        return [];
    } catch (e) {
        console.error("Failed to parse AI response for quiz:", response.text, e);
        throw new Error("AI quiz response was not valid JSON.");
    }
}
