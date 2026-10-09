// File: /services/practiceCheck.ts
// The learner writes their own sentence with a grammar card's structure.
// The app's rules say at once whether the structure is there; an AI (when
// one is set up) points out mistakes with a short Persian explanation and a
// corrected sentence. The result suggests how to rate the card.

import type { Flashcard, PerformanceRating } from '../types';
import { aiGenerate } from './aiClient';
import { AiRequestOptions, parseJsonFromAiResponse } from './geminiService';
import { grammarIdsIn, ruleById, ruleForName, type GrammarRule } from './grammarPatterns';

type GrammarCard = Pick<Flashcard, 'front' | 'grammarPattern' | 'grammarId' | 'practicePrompt'>;

// The app's rule for a grammar card, when it has one.
export const ruleOfCard = (card: GrammarCard): GrammarRule | undefined =>
  (card.grammarId ? ruleById(card.grammarId) : undefined) || ruleForName(card.front, card.grammarPattern);

// Whether the sentence uses the card's structure; undefined when the app has
// no rule for it.
export const ruleCheck = (card: GrammarCard, sentence: string): boolean | undefined => {
  const rule = ruleOfCard(card);
  if (!rule || !sentence.trim()) return undefined;
  return grammarIdsIn(sentence).includes(rule.id);
};

export interface PracticeMistake {
  wrong: string;
  right: string;
  why: string; // Persian
}

export interface PracticeFeedback {
  usesStructure: boolean;
  correct: boolean; // grammatical and natural enough
  corrected: string; // the sentence fixed (the same sentence when it was right)
  feedback: string; // one or two Persian sentences
  mistakes: PracticeMistake[];
}

export const buildPracticePrompt = (card: GrammarCard, sentence: string): string => `You are an English teacher for a Persian-speaking student.
The student practises this grammar structure: ${JSON.stringify(card.front)}${card.grammarPattern ? ` (form: ${JSON.stringify(card.grammarPattern)})` : ''}.
${card.practicePrompt ? `The exercise (in Persian): ${JSON.stringify(card.practicePrompt)}\n` : ''}The student wrote: ${JSON.stringify(sentence)}

Return a JSON object with:
- "usesStructure": true when the sentence really uses that structure.
- "correct": true when the sentence is grammatical and natural (ignore capital letters and a missing final full stop).
- "corrected": the sentence corrected with as few changes as possible, using the structure; the same sentence when it is already right.
- "mistakes": up to 3 objects {"wrong": the wrong words, "right": the fix, "why": one short Persian explanation}.
- "feedback": one or two short, encouraging Persian sentences about the sentence.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    usesStructure: { type: 'BOOLEAN' },
    correct: { type: 'BOOLEAN' },
    corrected: { type: 'STRING' },
    feedback: { type: 'STRING', description: 'Persian' },
    mistakes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { wrong: { type: 'STRING' }, right: { type: 'STRING' }, why: { type: 'STRING', description: 'Persian' } },
        required: ['wrong', 'right', 'why'],
      },
    },
  },
  required: ['usesStructure', 'correct', 'corrected', 'feedback'],
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const yes = (v: unknown) => v === true || v === 'true';

export const parsePracticeFeedback = (parsed: any, sentence: string): PracticeFeedback => {
  if (!parsed || typeof parsed !== 'object') throw new Error('The AI reply was not a check of the sentence.');
  const mistakes = (Array.isArray(parsed.mistakes) ? parsed.mistakes : [])
    .map((m: any) => ({ wrong: text(m?.wrong), right: text(m?.right), why: text(m?.why) }))
    .filter((m: PracticeMistake) => m.wrong || m.right)
    .slice(0, 3);
  return {
    usesStructure: yes(parsed.usesStructure),
    correct: yes(parsed.correct),
    corrected: text(parsed.corrected) || sentence.trim(),
    feedback: text(parsed.feedback),
    mistakes,
  };
};

export async function checkPracticeWithAi(card: GrammarCard, sentence: string, options?: AiRequestOptions): Promise<PracticeFeedback> {
  const reply = await aiGenerate(options, {
    contents: buildPracticePrompt(card, sentence),
    config: { responseMimeType: 'application/json', responseSchema: SCHEMA },
  }, 'practice');
  return parsePracticeFeedback(parseJsonFromAiResponse(reply.text), sentence);
}

// The rating the result suggests: right and with the structure, Good; the
// structure with mistakes, Hard; without the structure, Again. With no AI,
// the rule alone decides; with neither, nothing is suggested.
export const suggestRating = (rule: boolean | undefined, ai?: PracticeFeedback | null): PerformanceRating | undefined => {
  if (ai) {
    if (!ai.usesStructure) return 'AGAIN';
    return ai.correct && ai.mistakes.length === 0 ? 'GOOD' : 'HARD';
  }
  // The rules can miss a structure written another way, so on their own they
  // suggest only a pass.
  return rule ? 'GOOD' : undefined;
};
