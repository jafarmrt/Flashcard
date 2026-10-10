// File: /services/cardExtras.ts
// The richer parts of a card: words close in meaning and how they differ,
// a mistake Persian speakers often make with the term, its register, its
// word family and root. The AI fills them when it makes a card; older cards
// get them in batches from the words list.
//
// Also stubborn cards ("leeches"): a card forgotten again and again gets a
// fresh memory aid and a new example, since the old ones are not working.

import type { CardExtras, CardOrigin, Flashcard, Synonym, WordFamilyMember } from '../types';
import type { AiRequestOptions } from './geminiService';
import { parseJsonFromAiResponse } from './geminiService';
import { aiGenerate } from './aiClient';
import { aiOrigin } from './aiSettings';

export const EXTRA_FIELDS = ['synonyms', 'commonMistake', 'register', 'wordFamily', 'wordRoot'] as const;
export type ExtraField = (typeof EXTRA_FIELDS)[number];

export const EXTRA_NAMES: Record<ExtraField, string> = {
  synonyms: 'هم‌معنی‌ها و فرقشان',
  commonMistake: 'اشتباه رایج',
  register: 'سبک و کاربرد',
  wordFamily: 'خانوادهٔ واژه',
  wordRoot: 'ریشه',
};

// What the AI is asked for each term, in any prompt about single terms.
export const extrasPromptLines = (bullet = '-'): string => [
  `${bullet} "synonyms": up to 3 English words or phrases close in meaning, each {"word": English, "note": one short Persian sentence on how it differs from the term (more formal, stronger, only for people…)}. [] when nothing is close.`,
  `${bullet} "commonMistake": one short Persian sentence about a mistake Persian speakers really often make with this term (a wrong preposition, a false friend, mixing it up with a similar word, a literal translation from Persian), showing the wrong and the right English. "" when there is no well-known one; never invent one.`,
  `${bullet} "register": a few Persian words on its style: رسمی / خنثی / محاوره‌ای / عامیانه, British or American when that matters, and how common it is (پرکاربرد / رایج / کم‌کاربرد), e.g. "رسمی · بیشتر نوشتاری · کم‌کاربرد".`,
  `${bullet} "wordFamily": up to 4 other common words of the same family, each {"word": English, "partOfSpeech": "n.", "v.", "adj." or "adv.", "meaning": Persian}. [] when it has none (most idioms).`,
  `${bullet} "wordRoot": one short Persian sentence on its root, prefix or suffix when that helps to remember it ("in- یعنی نه، decisive یعنی قاطع"), otherwise "".`,
].join('\n');

const OBJECT_LIST = (props: Record<string, unknown>, required: string) => ({
  type: 'ARRAY',
  items: { type: 'OBJECT', properties: props, required: [required] },
});

// The same fields in a response schema.
export const EXTRAS_SCHEMA_PROPERTIES = {
  synonyms: OBJECT_LIST({ word: { type: 'STRING' }, note: { type: 'STRING', description: 'Persian: how it differs' } }, 'word'),
  commonMistake: { type: 'STRING', description: 'Persian; empty when none' },
  register: { type: 'STRING', description: 'Persian: style and how common' },
  wordFamily: OBJECT_LIST({ word: { type: 'STRING' }, partOfSpeech: { type: 'STRING' }, meaning: { type: 'STRING', description: 'Persian' } }, 'word'),
  wordRoot: { type: 'STRING', description: 'Persian; empty when not helpful' },
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The extra sections in one item of an AI reply; empty ones are left out.
// The term itself never counts as its own synonym or family member.
export const parseExtras = (raw: any, front = ''): CardExtras => {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out: CardExtras = {};
  const synonyms: Synonym[] = (Array.isArray(r.synonyms) ? r.synonyms : [])
    .map((s: any): Synonym => (typeof s === 'string' ? { word: text(s) } : { word: text(s?.word), ...(text(s?.note) ? { note: text(s.note) } : {}) }))
    .filter((s: Synonym) => s.word && !same(s.word, front))
    .slice(0, 4);
  if (synonyms.length) out.synonyms = synonyms;
  const family: WordFamilyMember[] = (Array.isArray(r.wordFamily) ? r.wordFamily : [])
    .map((m: any): WordFamilyMember => (typeof m === 'string' ? { word: text(m) } : {
      word: text(m?.word),
      ...(text(m?.partOfSpeech) ? { partOfSpeech: text(m.partOfSpeech) } : {}),
      ...(text(m?.meaning) ? { meaning: text(m.meaning) } : {}),
    }))
    .filter((m: WordFamilyMember) => m.word && !same(m.word, front))
    .slice(0, 5);
  if (family.length) out.wordFamily = family;
  for (const key of ['commonMistake', 'register', 'wordRoot'] as const) {
    const value = text(r[key]);
    // "none", "—" and the like mean there is nothing to say.
    if (value && !/^(none|n\/a|-+|—|ندارد|هیچ)\.?$/i.test(value)) out[key] = value;
  }
  return out;
};

export const hasExtras = (card: CardExtras): boolean =>
  !!(card.synonyms?.length || card.wordFamily?.length || card.commonMistake || card.register || card.wordRoot);

// Cards the batch fill should still ask about: not grammar, never asked.
export const lacksExtras = (card: Flashcard): boolean =>
  !card.isDeleted && card.kind !== 'grammar' && !card.extrasAt && !hasExtras(card);

// --- Text form, as typed in the card form and written in a CSV ---

// "large = رسمی‌تر" one per line
export const synonymsText = (list: Synonym[] = [], sep = '\n'): string =>
  list.map(s => (s.note ? `${s.word} = ${s.note}` : s.word)).join(sep);

export const parseSynonymsText = (value: string, sep: string | RegExp = '\n'): Synonym[] =>
  value.split(sep).map(line => {
    const at = line.indexOf('=');
    const word = (at >= 0 ? line.slice(0, at) : line).trim();
    const note = at >= 0 ? line.slice(at + 1).trim() : '';
    return note ? { word, note } : { word };
  }).filter(s => s.word);

// "decision (n.) = تصمیم" one per line
export const familyText = (list: WordFamilyMember[] = [], sep = '\n'): string =>
  list.map(m => `${m.word}${m.partOfSpeech ? ` (${m.partOfSpeech})` : ''}${m.meaning ? ` = ${m.meaning}` : ''}`).join(sep);

export const parseFamilyText = (value: string, sep: string | RegExp = '\n'): WordFamilyMember[] =>
  value.split(sep).map(line => {
    const at = line.indexOf('=');
    const head = (at >= 0 ? line.slice(0, at) : line).trim();
    const meaning = at >= 0 ? line.slice(at + 1).trim() : '';
    const pos = head.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const word = (pos ? pos[1] : head).trim();
    return { word, ...(pos && pos[2].trim() ? { partOfSpeech: pos[2].trim() } : {}), ...(meaning ? { meaning } : {}) };
  }).filter(m => m.word);

// --- Filling older cards, a few per request ---

export const EXTRAS_BATCH = 8;

type ExtrasCard = Pick<Flashcard, 'front' | 'back'> & Partial<Pick<Flashcard, 'kind' | 'sourceSentence' | 'partOfSpeech'>>;

export const buildExtrasPrompt = (cards: ExtrasCard[]): string => `You enrich flashcards for a native Persian speaker who is learning English.
For each numbered English term (with the Persian meaning on its card, and the sentence it was met in when known), give:
${extrasPromptLines('  -')}

${cards.map((c, n) => `${n + 1}. term: ${JSON.stringify(c.front)}${c.partOfSpeech ? ` (${c.partOfSpeech})` : ''}; meaning on the card: ${JSON.stringify(c.back)}${c.sourceSentence ? `\n   sentence: ${JSON.stringify(c.sourceSentence)}` : ''}`).join('\n')}

Answer for the meaning on the card. Return a JSON object {"cards": [{"index": item number, ...the fields}]}.`;

const listIn = (parsed: any): any[] | null => {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return null;
  if (Array.isArray(parsed.cards)) return parsed.cards;
  return (Object.values(parsed).find(Array.isArray) as any[] | undefined) || null;
};

// One result per card, in order; null where the reply says nothing about it.
export const parseExtrasReply = (parsed: any, cards: Pick<Flashcard, 'front'>[]): (CardExtras | null)[] => {
  const list = listIn(parsed);
  if (!list) throw new Error('The AI reply had no list of cards.');
  const out: (CardExtras | null)[] = new Array(cards.length).fill(null);
  list.forEach((raw, order) => {
    const n = Number(raw?.index);
    const at = Number.isInteger(n) && n >= 1 && n <= cards.length ? n - 1 : order;
    if (at >= cards.length || out[at]) return;
    out[at] = parseExtras(raw, cards[at].front);
  });
  return out;
};

export const extrasForCards = async (
  cards: ExtrasCard[],
  options?: AiRequestOptions,
  send?: Parameters<typeof aiGenerate>[3],
): Promise<{ extras: (CardExtras | null)[]; origin: CardOrigin }> => {
  const reply = await aiGenerate(options, {
    contents: buildExtrasPrompt(cards),
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          cards: {
            type: 'ARRAY',
            items: { type: 'OBJECT', properties: { index: { type: 'INTEGER' }, ...EXTRAS_SCHEMA_PROPERTIES }, required: ['index'] },
          },
        },
        required: ['cards'],
      },
    },
  }, 'details', send);
  return { extras: parseExtrasReply(parseJsonFromAiResponse(reply.text), cards), origin: aiOrigin(reply.used) };
};

// The card with the sections it lacks taken from a result; what the card
// already has (maybe typed by hand) stays.
export const withExtras = (card: Flashcard, extras: CardExtras | null, now: Date = new Date()): Flashcard => {
  const next: Flashcard = { ...card, extrasAt: now.toISOString(), updatedAt: now.toISOString() };
  if (!extras) return next;
  if (!card.synonyms?.length && extras.synonyms?.length) next.synonyms = extras.synonyms;
  if (!card.wordFamily?.length && extras.wordFamily?.length) next.wordFamily = extras.wordFamily;
  for (const key of ['commonMistake', 'register', 'wordRoot'] as const) {
    if (!card[key] && extras[key]) next[key] = extras[key];
  }
  return next;
};

// --- Stubborn cards ---

// Forgotten this many times after being learned.
export const LEECH_LAPSES = 4;
// A fresh aid is offered again only after this many more lapses.
const LEECH_AGAIN_AFTER = 2;

export const isLeech = (card: Pick<Flashcard, 'lapses' | 'isDeleted'>): boolean =>
  !card.isDeleted && (card.lapses || 0) >= LEECH_LAPSES;

export const needsLeechHelp = (card: Pick<Flashcard, 'lapses' | 'isDeleted' | 'leechHelpLapses'>): boolean =>
  isLeech(card) && (card.leechHelpLapses === undefined || (card.lapses || 0) - card.leechHelpLapses >= LEECH_AGAIN_AFTER);

export interface LeechHelp {
  why: string; // Persian: what likely makes it hard
  mnemonic: string; // Persian: a new memory aid
  example: string; // a new short English sentence
  exampleMeaning?: string; // its Persian translation
  origin?: CardOrigin;
}

export const buildLeechPrompt = (card: Pick<Flashcard, 'front' | 'back' | 'kind' | 'notes' | 'exampleSentenceTarget' | 'sourceSentence' | 'lapses'>): string => `A native Persian speaker learning English keeps forgetting this flashcard (forgotten ${card.lapses || 0} times). What the card says is not sticking, so help in a NEW way.

${card.kind === 'grammar' ? 'Grammar structure' : 'English term'}: ${JSON.stringify(card.front)}
Persian meaning on the card: ${JSON.stringify(card.back)}
${card.sourceSentence ? `Met in: ${JSON.stringify(card.sourceSentence)}\n` : ''}${card.notes ? `Memory aid already on the card (do NOT repeat it): ${JSON.stringify(card.notes)}\n` : ''}${card.exampleSentenceTarget?.length ? `Examples already on the card (do not reuse): ${JSON.stringify(card.exampleSentenceTarget)}\n` : ''}
Reply with one JSON object:
- "why": one short Persian sentence on what most likely makes it hard (a similar word it gets mixed up with, a meaning far from Persian, a spelling…)
- "mnemonic": a new, vivid Persian memory aid: a picture, a sound-alike Persian word, a little story, or splitting the word into parts. Two sentences at most.
- "example": one new short English sentence that makes the meaning obvious, about everyday life
- "exampleMeaning": its Persian translation`;

export const parseLeechHelp = (parsed: any): LeechHelp => {
  const p = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const help: LeechHelp = { why: text(p.why), mnemonic: text(p.mnemonic), example: text(p.example), ...(text(p.exampleMeaning) ? { exampleMeaning: text(p.exampleMeaning) } : {}) };
  if (!help.mnemonic && !help.example) throw new Error('The AI sent no memory aid.');
  return help;
};

export const leechHelpFor = async (card: Flashcard, options?: AiRequestOptions, send?: Parameters<typeof aiGenerate>[3]): Promise<LeechHelp> => {
  const reply = await aiGenerate(options, {
    contents: buildLeechPrompt(card),
    config: { responseMimeType: 'application/json' },
  }, 'details', send);
  return { ...parseLeechHelp(parseJsonFromAiResponse(reply.text)), origin: aiOrigin(reply.used) };
};

// The card with the new aid kept: it becomes the card's note (the old one
// stays below it) and the example comes first. Kept or not, the card is not
// offered again until it is forgotten a couple more times.
export const applyLeechHelp = (card: Flashcard, help: LeechHelp | null, now: Date = new Date()): Flashcard => {
  const next: Flashcard = { ...card, leechHelpLapses: card.lapses || 0, updatedAt: now.toISOString() };
  if (!help) return next;
  const aid = [help.mnemonic, help.why].filter(Boolean).join('\n');
  if (aid) next.notes = card.notes?.trim() ? `${aid}\n\n${card.notes.trim()}` : aid;
  if (help.example) {
    const rest = (card.exampleSentenceTarget || []).filter(e => !same(e, help.example));
    next.exampleSentenceTarget = [help.example, ...rest].slice(0, 3);
  }
  return next;
};
