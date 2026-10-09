// File: /services/grammarCards.ts
// Grammar cards from the app's own rules (services/grammarPatterns): the
// structure's name, form, Persian explanation and an exercise, with no AI.
// With an AI, the explanation can be made about the sentence it was met in.

import type { CardOrigin, ExtractedWordCard, Flashcard } from '../types';
import { aiGenerate } from './aiClient.js';
import { aiOrigin, rulesOrigin } from './aiSettings.js';
import { AiRequestOptions, parseJsonFromAiResponse } from './geminiService.js';
import { detectGrammar, GRAMMAR_RULES, ruleById, ruleForName, wordSpans, type GrammarRule } from './grammarPatterns.js';
import { splitSentences } from './textChunker.js';

export const ruleCard = (rule: GrammarRule, sentence?: string, now: Date = new Date()): ExtractedWordCard => ({
  front: rule.name,
  back: rule.explanation,
  kind: 'grammar',
  partOfSpeech: 'grammar',
  grammarPattern: rule.pattern,
  practicePrompt: rule.practicePrompt,
  exampleSentenceTarget: [rule.example],
  sourceSentence: sentence,
  grammarId: rule.id,
  definition: [],
  collocations: [],
  notes: '',
  selected: true,
  origin: rulesOrigin(now),
});

// The rule a card stands for: its own id, or the rule its name names.
export const ruleIdOfCard = (card: Pick<Flashcard, 'front' | 'kind' | 'grammarId' | 'grammarPattern'>): string | undefined =>
  card.grammarId || (card.kind === 'grammar' ? ruleForName(card.front, card.grammarPattern)?.id : undefined);

// Structures that already have a card, by rule id.
export const ruleIdsWithCards = (cards: Pick<Flashcard, 'front' | 'kind' | 'grammarId' | 'grammarPattern' | 'isDeleted'>[]): Set<string> => {
  const ids = new Set<string>();
  for (const card of cards) {
    if (card.isDeleted) continue;
    const id = ruleIdOfCard(card);
    if (id) ids.add(id);
  }
  return ids;
};

// The structures of a text, each once, where it is first met; at most `max`,
// none whose rule is in `skip`.
export const ruleCardsInText = (text: string, max: number, skip: Set<string> = new Set(), now: Date = new Date()): ExtractedWordCard[] => {
  const out: ExtractedWordCard[] = [];
  const seen = new Set(skip);
  for (const paragraph of text.split(/\n+/)) {
    for (const sentence of splitSentences(paragraph)) {
      for (const match of detectGrammar(sentence, wordSpans(sentence))) {
        if (seen.has(match.id)) continue;
        const rule = ruleById(match.id);
        if (!rule) continue;
        seen.add(match.id);
        out.push(ruleCard(rule, sentence.trim(), now));
        if (out.length >= max) return out;
      }
    }
  }
  return out;
};

export const RULE_COUNT = GRAMMAR_RULES.length;

// --- The explanation for one sentence, by an AI ---

export interface SentenceExplanation {
  explanation: string; // Persian, about this sentence
  origin: CardOrigin;
}

export const buildExplainPrompt = (rule: GrammarRule, sentence: string): string => `A Persian-speaking student of English met the structure ${JSON.stringify(rule.name)} (form: ${JSON.stringify(rule.pattern)}) in this sentence:
${JSON.stringify(sentence)}

In Persian, in two or three short sentences, explain how the structure is built and what it means IN THIS SENTENCE: name the words that make it, and give the sentence's meaning in Persian. Use natural Persian; keep English words of the sentence in English.
Return a JSON object {"explanation": "..."}.`;

export async function explainInSentence(rule: GrammarRule, sentence: string, options?: AiRequestOptions): Promise<SentenceExplanation> {
  const reply = await aiGenerate(options, {
    contents: buildExplainPrompt(rule, sentence),
    config: {
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { explanation: { type: 'STRING', description: 'Persian' } }, required: ['explanation'] },
    },
  }, 'grammar');
  const parsed = parseJsonFromAiResponse(reply.text);
  const explanation = typeof parsed?.explanation === 'string' ? parsed.explanation.trim() : '';
  if (!explanation) throw new Error('The AI reply had no explanation.');
  return { explanation, origin: aiOrigin(reply.used) };
}
