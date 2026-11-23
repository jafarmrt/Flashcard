// File: /services/quizExplain.ts
// «چرا؟» after a wrong answer in the quiz: one or two Persian sentences on
// why the right word fits the gap and the picked one does not. Asked only
// when the learner wants it; the meanings of both words are already shown
// from the cards, which is free.

import { aiGenerate } from './aiClient';
import type { AiRequestOptions } from './geminiService';

export const buildWhyPrompt = (q: { questionText: string; correct: string; correctBack?: string; chosen: string; chosenBack?: string }): string =>
  `A Persian-speaking student of English filled the gap in this sentence with the wrong word.

Sentence: ${JSON.stringify(q.questionText)}
Right word: ${JSON.stringify(q.correct)}${q.correctBack ? ` (their card says: ${q.correctBack})` : ''}
Word they chose: ${JSON.stringify(q.chosen)}${q.chosenBack ? ` (their card says: ${q.chosenBack})` : ''}

In Persian, in at most two short sentences, say why the right word fits here and the chosen one does not (meaning, part of speech, or the words it goes with). Write the English words in English. No greeting, no praise, no list: only the explanation.`;

export const explainChoice = async (
  q: Parameters<typeof buildWhyPrompt>[0],
  options?: AiRequestOptions,
  send?: Parameters<typeof aiGenerate>[3],
): Promise<string> => {
  const reply = await aiGenerate(options, { contents: buildWhyPrompt(q) }, 'details', send);
  const text = (reply.text || '').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('The AI sent no explanation.');
  return text;
};
