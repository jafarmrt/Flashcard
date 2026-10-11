// File: /services/cardImprove.ts
// Improving many cards at once with an AI. AI requests cost money, so the
// user picks which parts of the cards to ask about, whether only empty parts
// or filled ones too, and which AI service to use. A few cards go in each
// request; nothing is saved until the user picks the changes to keep.

import type { Flashcard } from '../types';
import type { AiRequestOptions } from './geminiService';
import { parseJsonFromAiResponse } from './geminiService';
import { aiGenerate } from './aiClient';
import { aiOrigin } from './aiSettings';
import { extrasPromptLines, replyPlaces } from './cardExtras';

export { replyPlaces };
import { CardProposal, FIELD_NAMES, parseCardRefresh, proposalChanges, RefreshField, FieldChange } from './cardRefresh';

// The parts a batch can improve, in the order they are offered.
export const IMPROVE_FIELDS = [
  'back', 'notes', 'definition', 'exampleSentenceTarget', 'collocations',
  'synonyms', 'commonMistake', 'register', 'wordFamily', 'wordRoot', 'reference',
  'pronunciation', 'partOfSpeech', 'level',
] as const satisfies readonly RefreshField[];
export type ImproveField = (typeof IMPROVE_FIELDS)[number];

export const improveFieldName = (field: ImproveField): string => FIELD_NAMES[field];

// What is asked when nothing was picked yet: the parts a learner sees most.
export const DEFAULT_IMPROVE_FIELDS: ImproveField[] = ['back', 'notes', 'exampleSentenceTarget'];

export type ImproveMode = 'empty' | 'all';

// Cards per request. Asking to rewrite filled parts sends them along, so
// fewer cards fit.
export const improveBatchSize = (mode: ImproveMode, fields: ImproveField[]): number =>
  mode === 'empty' ? (fields.length <= 4 ? 10 : fields.length <= 8 ? 6 : 4) : fields.length > 6 ? 4 : 6;

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0);

// The parts of one card to ask about.
export const fieldsToAsk = (card: Flashcard, fields: ImproveField[], mode: ImproveMode): ImproveField[] =>
  mode === 'all' ? fields : fields.filter(f => isEmpty(card[f]));

// Cards worth a request: not grammar (they have their own fields), not
// deleted, and with something to ask.
export const improveCandidates = (cards: Flashcard[], fields: ImproveField[], mode: ImproveMode): Flashcard[] =>
  fields.length === 0 ? [] : cards.filter(c => !c.isDeleted && c.kind !== 'grammar' && fieldsToAsk(c, fields, mode).length > 0);

export const improveRequestCount = (cards: number, mode: ImproveMode, fields: ImproveField[]): number =>
  Math.ceil(cards / improveBatchSize(mode, fields));

// --- The request ---

// The reply's key for each part (the same keys the one-card refill uses).
const REPLY_KEY: Record<ImproveField, string> = {
  back: 'translation', notes: 'notes', definition: 'definitions', exampleSentenceTarget: 'examples',
  collocations: 'collocations', synonyms: 'synonyms', commonMistake: 'commonMistake', register: 'register',
  wordFamily: 'wordFamily', wordRoot: 'wordRoot', reference: 'reference', pronunciation: 'pronunciation', partOfSpeech: 'partOfSpeech', level: 'level',
};

const GUIDE: Partial<Record<ImproveField, string>> = {
  back: '"translation": the best short, natural Persian meaning (in the sense of the sentence when one is given)',
  notes: '"notes": a short Persian note that helps remember it (root, a similar Persian word, a usage tip)',
  definition: '"definitions": 1 or 2 short, clear English definitions',
  exampleSentenceTarget: '"examples": 2 short, natural English example sentences',
  collocations: '"collocations": up to 4 common expressions with it, each {"phrase": English, "meaning": Persian}',
  pronunciation: '"pronunciation": IPA between slashes, e.g. /ˈwɜːrd/',
  partOfSpeech: '"partOfSpeech": noun, verb, adjective, adverb, phrasal verb, idiom…',
  level: '"level": its CEFR level, one of A1 A2 B1 B2 C1 C2',
};

const EXTRA_KEYS = ['synonyms', 'commonMistake', 'register', 'wordFamily', 'wordRoot', 'reference'] as const;

const shown = (value: unknown): string => JSON.stringify(value);

export const buildImprovePrompt = (cards: Flashcard[], fields: ImproveField[], mode: ImproveMode): string => {
  const guides = fields.filter(f => GUIDE[f]).map(f => `- ${GUIDE[f]}`);
  const extras = fields.filter(f => (EXTRA_KEYS as readonly string[]).includes(f));
  const extraLines = extrasPromptLines().split('\n').filter(line => extras.some(f => line.includes(`"${f}"`)));
  const items = cards.map((c, n) => {
    const ask = fieldsToAsk(c, fields, mode);
    const now = ask.filter(f => !isEmpty(c[f])).map(f => `   now ${REPLY_KEY[f]}: ${shown(c[f])}`);
    return [
      `${n + 1}. term: ${shown(c.front)}${c.back && !ask.includes('back') ? ` (Persian meaning on the card: ${shown(c.back)})` : ''}`,
      ...(c.sourceSentence ? [`   sentence: ${shown(c.sourceSentence)}`] : []),
      `   give: ${ask.map(f => REPLY_KEY[f]).join(', ')}`,
      ...now,
    ].join('\n');
  });
  return `You improve flashcards for a native Persian speaker who is learning English.
For each numbered card, give ONLY the parts listed after "give".${mode === 'all' ? ` Where the card already has a value ("now"), correct it and make it clearer and more natural; when it is already good, return it unchanged.` : ''}

The parts:
${[...guides, ...extraLines].join('\n')}

${items.join('\n\n')}

Return a JSON object {"cards": [{"index": card number, ...the parts}]}.`;
};

export interface CardImprovement {
  card: Flashcard;
  proposal: CardProposal;
  changes: FieldChange[]; // only the picked parts that would change
}

const listIn = (parsed: any): any[] | null => {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return null;
  if (Array.isArray(parsed.cards)) return parsed.cards;
  return (Object.values(parsed).find(Array.isArray) as any[] | undefined) || null;
};

// What the reply says for each card, limited to what was asked of it.
export const parseImproveReply = (
  parsed: any, cards: Flashcard[], fields: ImproveField[], mode: ImproveMode, origin: CardProposal['origin'],
): CardImprovement[] => {
  const list = listIn(parsed);
  if (!list) throw new Error('The AI reply had no list of cards.');
  const out: CardImprovement[] = [];
  replyPlaces(list, cards.length).forEach((at, order) => {
    if (at === null) return;
    const raw = list[order];
    const card = cards[at];
    const asked = fieldsToAsk(card, fields, mode);
    const all = parseCardRefresh(raw, card);
    const proposal: CardProposal = { origin };
    for (const f of asked) if (all[f] !== undefined) (proposal as any)[f] = all[f];
    const changes = proposalChanges(card, proposal).filter(c => (asked as RefreshField[]).includes(c.field));
    if (changes.length) out.push({ card, proposal, changes });
  });
  return out;
};

export const improveBatch = async (
  cards: Flashcard[], fields: ImproveField[], mode: ImproveMode, options: AiRequestOptions,
  send?: Parameters<typeof aiGenerate>[3],
): Promise<CardImprovement[]> => {
  // Only the chosen service, so the cost is the one the user picked.
  const { fallbacks: _ignored, ...only } = options;
  const reply = await aiGenerate(only, {
    contents: buildImprovePrompt(cards, fields, mode),
    config: { responseMimeType: 'application/json' },
  }, 'details', send);
  return parseImproveReply(parseJsonFromAiResponse(reply.text), cards, fields, mode, aiOrigin(reply.used));
};
