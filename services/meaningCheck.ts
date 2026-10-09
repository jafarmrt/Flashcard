// File: /services/meaningCheck.ts
// An AI reads cards against the sentences they came from and says whether
// each Persian meaning fits; where it does not, it suggests one. Nothing is
// changed until the user accepts a suggestion. Twenty cards per request.

import type { CardOrigin, Flashcard } from '../types';
import { aiGenerate } from './aiClient';
import { aiOrigin } from './aiSettings';
import { AiRequestOptions, parseJsonFromAiResponse } from './geminiService';

export const MEANING_CHECK_BATCH = 20;

export interface MeaningVerdict {
  cardId: string;
  ok: boolean;
  suggestion?: string; // a better Persian meaning, when not ok
  note?: string; // why, in Persian
}

type CheckedCard = Pick<Flashcard, 'id' | 'front' | 'back' | 'partOfSpeech' | 'sourceSentence'>;

export const buildMeaningCheckPrompt = (cards: CheckedCard[]): string => `You check flashcards made for a Persian-speaking student of English.
Each item has an English term, the Persian meaning written on the card, and the sentence of a book where the student met the term.
Decide whether the Persian meaning is right for the term AS USED IN THAT SENTENCE (when there is no sentence, for the term's main sense).

${cards.map((c, n) => `${n + 1}. term: ${JSON.stringify(c.front)}${c.partOfSpeech ? ` (${c.partOfSpeech})` : ''}
   card meaning: ${JSON.stringify(c.back || '')}
   sentence: ${JSON.stringify(c.sourceSentence || '')}`).join('\n')}

For each item return:
- "index": the item number.
- "ok": true when the card's meaning is right (small wording differences are fine), false when it is wrong, misleading, empty, or the sense of another meaning of the term.
- "suggestion": when not ok, a short natural Persian meaning for this sense (a few words); otherwise "".
- "note": when not ok, one short Persian sentence saying what was wrong; otherwise "".

Return a JSON object {"results": [...]}.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          index: { type: 'INTEGER' },
          ok: { type: 'BOOLEAN' },
          suggestion: { type: 'STRING', description: 'Persian' },
          note: { type: 'STRING', description: 'Persian' },
        },
        required: ['index', 'ok'],
      },
    },
  },
  required: ['results'],
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// One verdict per card the reply names; a card it skips gets none.
export const parseMeaningVerdicts = (parsed: any, cards: CheckedCard[]): MeaningVerdict[] => {
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.results) ? parsed.results
    : (Object.values(parsed || {}).find(Array.isArray) as any[] | undefined);
  if (!list) throw new Error('The AI reply had no list of results.');
  const out = new Map<string, MeaningVerdict>();
  list.forEach((raw: any, order: number) => {
    const n = Number(raw?.index);
    const at = Number.isInteger(n) && n >= 1 && n <= cards.length ? n - 1 : order;
    const card = cards[at];
    if (!card || out.has(card.id)) return;
    const ok = raw?.ok === true || raw?.ok === 'true';
    const suggestion = text(raw?.suggestion);
    const note = text(raw?.note);
    // "Not ok" with nothing better to offer, or a suggestion that is the
    // same meaning, is no finding.
    if (!ok && (!suggestion || suggestion === (card.back || '').trim())) {
      out.set(card.id, { cardId: card.id, ok: false, ...(note ? { note } : {}) });
      return;
    }
    out.set(card.id, ok ? { cardId: card.id, ok: true } : { cardId: card.id, ok: false, suggestion, ...(note ? { note } : {}) });
  });
  return cards.map(c => out.get(c.id)).filter((v): v is MeaningVerdict => !!v);
};

export async function checkMeanings(cards: CheckedCard[], options?: AiRequestOptions): Promise<{ verdicts: MeaningVerdict[]; origin: CardOrigin }> {
  const batch = cards.slice(0, MEANING_CHECK_BATCH);
  const reply = await aiGenerate(options, {
    contents: buildMeaningCheckPrompt(batch),
    config: { responseMimeType: 'application/json', responseSchema: SCHEMA },
  }, 'check');
  return { verdicts: parseMeaningVerdicts(parseJsonFromAiResponse(reply.text), batch), origin: aiOrigin(reply.used) };
}
