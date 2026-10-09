// File: /services/senseService.ts
// Reading with AI:
//   - the meaning a word or phrase has in the sentence it was met in. A
//     dictionary lists the commonest sense first, which is often not the one
//     in the book. Taps close together are sent as one request.
//   - the grammar of a sentence: its structures, explained in Persian, each
//     with a sentence-building exercise.

import type { ExtractedWordCard } from '../types';
import { callProxy } from './apiService';
import { AiRequestOptions, parseJsonFromAiResponse, providerFields } from './geminiService';

export interface SenseRequest {
  term: string; // as picked in the text ("took it into account")
  sentence: string;
}

export interface Sense {
  front: string; // dictionary form ("take into account")
  back: string; // Persian, for this sense
  definition?: string;
  partOfSpeech?: string;
  pronunciation?: string;
  kind?: 'word' | 'phrase' | 'idiom';
  notes?: string;
}

const SENSE_KINDS = ['word', 'phrase', 'idiom'];

export const buildSensePrompt = (items: SenseRequest[], level: string): string => `You help a Persian-speaking student at level "${level}" read an English book.
For each numbered item, give the meaning the English term has IN ITS SENTENCE (not its most common meaning).

${items.map((it, n) => `${n + 1}. term: ${JSON.stringify(it.term)}\n   sentence: ${JSON.stringify(it.sentence)}`).join('\n')}

For each item return an object with:
- "index": the item number.
- "front": the dictionary form of the term ("decide" for "decided", "take into account" for "took it into account"). Keep phrasal verbs, collocations and idioms whole.
- "kind": "word", "phrase" (phrasal verb or collocation) or "idiom".
- "back": a short, natural Persian translation of this sense (a few words).
- "definition": one short English definition of this sense.
- "partOfSpeech": as used here ("n.", "v.", "adj.", "adv.", "phrasal verb", "idiom").
- "pronunciation": IPA of the dictionary form.
- "notes": one short Persian note when this sense differs from the usual meaning of the term, otherwise "".

Return a JSON object {"senses": [...]}.`;

const SENSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    senses: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          index: { type: 'INTEGER' },
          front: { type: 'STRING' },
          kind: { type: 'STRING', enum: SENSE_KINDS },
          back: { type: 'STRING', description: 'Persian meaning in this sentence' },
          definition: { type: 'STRING' },
          partOfSpeech: { type: 'STRING' },
          pronunciation: { type: 'STRING' },
          notes: { type: 'STRING' },
        },
        required: ['index', 'front', 'back'],
      },
    },
  },
  required: ['senses'],
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

const listIn = (parsed: any, key: string): any[] | null => {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return null;
  if (Array.isArray(parsed[key])) return parsed[key];
  return (Object.values(parsed).find(Array.isArray) as any[] | undefined) || null;
};

// One meaning per item, in the items' order; null where the reply has none.
export const parseSenses = (parsed: any, count: number): (Sense | null)[] => {
  const list = listIn(parsed, 'senses');
  if (!list) throw new Error('The AI reply had no list of meanings.');
  const out: (Sense | null)[] = new Array(count).fill(null);
  list.forEach((raw, order) => {
    const back = text(raw?.back);
    if (!back) return;
    const n = Number(raw.index);
    const at = Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : order;
    if (at >= count || out[at]) return;
    const kind = text(raw.kind).toLowerCase();
    out[at] = {
      front: text(raw.front),
      back,
      definition: text(raw.definition) || undefined,
      partOfSpeech: text(raw.partOfSpeech) || undefined,
      pronunciation: text(raw.pronunciation) || undefined,
      kind: SENSE_KINDS.includes(kind) ? (kind as Sense['kind']) : undefined,
      notes: text(raw.notes) || undefined,
    };
  });
  return out;
};

export const sensesInContext = async (items: SenseRequest[], level: string, options?: AiRequestOptions): Promise<(Sense | null)[]> => {
  const response = await callProxy('gemini-generate', {
    ...providerFields(options),
    contents: buildSensePrompt(items, level),
    config: { responseMimeType: 'application/json', responseSchema: SENSE_SCHEMA },
  });
  return parseSenses(parseJsonFromAiResponse(response.text), items.length);
};

// Gathers requests made close together and sends them as one: a reader
// tapping five words in a paragraph makes one AI call, not five.
export class SenseBatcher {
  private queue: { item: SenseRequest; resolve: (s: Sense | null) => void; reject: (e: unknown) => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private send: (items: SenseRequest[]) => Promise<(Sense | null)[]>,
    private waitMs = 700,
    private maxPerRequest = 6,
  ) {}

  request(item: SenseRequest): Promise<Sense | null> {
    return new Promise((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      if (this.timer) clearTimeout(this.timer);
      if (this.queue.length >= this.maxPerRequest) this.flush();
      else this.timer = setTimeout(() => this.flush(), this.waitMs);
    });
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.maxPerRequest);
      this.send(batch.map(b => b.item)).then(
        senses => batch.forEach((b, i) => b.resolve(senses[i] ?? null)),
        error => batch.forEach(b => b.reject(error)),
      );
    }
  }

  // Leaving the reader: waiting requests are dropped.
  cancel() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.queue.splice(0).forEach(b => b.resolve(null));
  }
}

// --- A sentence's grammar ---

export interface GrammarPoint {
  name: string; // "Past perfect"
  pattern: string; // "had + past participle"
  explanation: string; // Persian
  practicePrompt: string; // Persian: write your own sentence with it
  example?: string;
}

export interface SentenceAnalysis {
  translation: string; // Persian
  structures: GrammarPoint[];
}

export const buildSentencePrompt = (sentence: string, level: string): string => `You are an English grammar tutor for a Persian-speaking student at level "${level}".

Sentence: ${JSON.stringify(sentence)}

Return a JSON object with:
- "translation": a natural Persian translation of the whole sentence.
- "structures": the 1-3 grammar structures of this sentence most worth learning at this level (skip trivial ones). For each:
  - "name": a short English name ("Past perfect", "Inversion after 'Not only'").
  - "pattern": the form ("had + past participle").
  - "explanation": 2-3 sentences in Persian: what the structure does in this sentence and when to use it.
  - "practicePrompt": a short Persian instruction asking the student to write their own English sentence with this structure.
  - "example": one new English example sentence.`;

const SENTENCE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    translation: { type: 'STRING' },
    structures: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          pattern: { type: 'STRING' },
          explanation: { type: 'STRING', description: 'Persian' },
          practicePrompt: { type: 'STRING', description: 'Persian' },
          example: { type: 'STRING' },
        },
        required: ['name', 'pattern', 'explanation', 'practicePrompt'],
      },
    },
  },
  required: ['translation', 'structures'],
};

export const parseSentenceAnalysis = (parsed: any): SentenceAnalysis => {
  if (!parsed || typeof parsed !== 'object') throw new Error('The AI reply was not an analysis of the sentence.');
  const list = Array.isArray(parsed.structures) ? parsed.structures : [];
  return {
    translation: text(parsed.translation),
    structures: list
      .map((raw: any): GrammarPoint => ({
        name: text(raw?.name),
        pattern: text(raw?.pattern),
        explanation: text(raw?.explanation),
        practicePrompt: text(raw?.practicePrompt),
        example: text(raw?.example) || undefined,
      }))
      .filter((g: GrammarPoint) => g.name && g.explanation),
  };
};

export const analyzeSentence = async (sentence: string, level: string, options?: AiRequestOptions): Promise<SentenceAnalysis> => {
  const response = await callProxy('gemini-generate', {
    ...providerFields(options),
    contents: buildSentencePrompt(sentence, level),
    config: { responseMimeType: 'application/json', responseSchema: SENTENCE_SCHEMA },
  });
  return parseSentenceAnalysis(parseJsonFromAiResponse(response.text));
};

// Grammar cards from an analysis: the explanation on the back, the form and
// the exercise on the card, the sentence as where it was met.
export const grammarCards = (analysis: SentenceAnalysis, sentence: string): ExtractedWordCard[] =>
  analysis.structures.map(g => ({
    front: g.name,
    back: g.explanation,
    kind: 'grammar',
    partOfSpeech: 'grammar',
    grammarPattern: g.pattern || undefined,
    practicePrompt: g.practicePrompt || undefined,
    exampleSentenceTarget: g.example ? [g.example] : [],
    sourceSentence: sentence,
    definition: [],
    collocations: [],
    notes: '',
    selected: true,
  }));
