// File: /services/cardRefresh.ts
// A second opinion on one card: ask a chosen AI service or dictionary to fill
// the card again, then show what would change next to what the card says now.
// Nothing is replaced until the user picks the fields to take.

import type { CardOrigin, CefrLevel, Collocation, Flashcard, Settings } from '../types';
import type { AiRequestOptions } from './geminiService';
import { parseJsonFromAiResponse } from './geminiService';
import { aiGenerate } from './aiClient';
import { aiOrigin, dictionaryOrigin, providerInfo, providerKey, providerList, providerOptions, providerProblem } from './aiSettings';
import { lookupDictionary } from './dictionaryService';
import { dictionaryList } from './dictSettings';
import { DictionaryId, dictionaryInfo, DICTIONARY_IDS } from './dictionaryCatalog';
import { freeEnrich } from './freeExtractionService';
import { CEFR, levelOfFrequency } from './wordLevel';

// The parts of a card a source can fill again.
export type RefreshField =
  | 'back' | 'notes' | 'pronunciation' | 'partOfSpeech' | 'definition' | 'exampleSentenceTarget'
  | 'collocations' | 'audioSrc' | 'level' | 'grammarPattern' | 'practicePrompt';

export const FIELD_NAMES: Record<RefreshField, string> = {
  back: 'معنی فارسی',
  notes: 'یادداشت',
  pronunciation: 'تلفظ',
  partOfSpeech: 'نقش دستوری',
  definition: 'تعریف انگلیسی',
  exampleSentenceTarget: 'جملهٔ مثال',
  collocations: 'ترکیب‌های رایج',
  audioSrc: 'صدای تلفظ',
  level: 'سطح',
  grammarPattern: 'ساختار گرامری',
  practicePrompt: 'تمرین جمله‌سازی',
};

const FIELD_ORDER: RefreshField[] = ['back', 'notes', 'grammarPattern', 'practicePrompt', 'pronunciation', 'partOfSpeech', 'level', 'definition', 'exampleSentenceTarget', 'collocations', 'audioSrc'];

export type CardContent = Pick<Flashcard, 'front' | 'back'> & Partial<Pick<Flashcard,
  'notes' | 'pronunciation' | 'partOfSpeech' | 'definition' | 'exampleSentenceTarget' | 'collocations' | 'audioSrc'
  | 'level' | 'grammarPattern' | 'practicePrompt' | 'kind' | 'sourceSentence' | 'origin'>>;

export type CardProposal = Partial<Pick<Flashcard, RefreshField>> & { origin: CardOrigin };

export interface RefreshSource {
  id: string; // "ai:groq", "dict:all", "dict:wiktionary"
  kind: 'ai' | 'dictionary';
  name: string;
  options?: AiRequestOptions; // AI only: this one service, no fallbacks
}

// The services the user can ask for one card: every AI service set up on
// this device (switched on, or with its own key), then all the dictionaries
// in order with a free translation, then each dictionary switched on.
// Gemini with the server's key stays available unless the user switched it off.
export const refreshSources = (settings: Partial<Settings>): RefreshSource[] => {
  const ai: RefreshSource[] = providerList(settings)
    .filter(entry => !providerProblem(settings, entry) && (entry.enabled || !!providerKey(settings, entry.id)))
    .map(entry => {
      const options = providerOptions(settings, entry);
      return { id: `ai:${entry.id}`, kind: 'ai', name: `${providerInfo(entry.id).name}${options.model ? ` · ${options.model}` : ''}`, options };
    });
  if (ai.length === 0) {
    const options = providerOptions(settings, { id: 'gemini', enabled: true });
    ai.push({ id: 'ai:gemini', kind: 'ai', name: `Gemini · ${options.model}`, options });
  }
  return [
    ...ai,
    { id: 'dict:all', kind: 'dictionary', name: 'دیکشنری‌ها به ترتیب تنظیمات، با ترجمهٔ رایگان' },
    ...dictionaryList(settings).filter(d => d.enabled).map((d): RefreshSource => ({ id: `dict:${d.id}`, kind: 'dictionary', name: dictionaryInfo(d.id).name })),
  ];
};

// --- AI ---

export const buildCardRefreshPrompt = (card: CardContent): string => {
  const grammar = card.kind === 'grammar';
  const context = card.sourceSentence?.trim();
  return `You make flashcards for a native Persian speaker who is learning English.
Fill in the flashcard below again, from scratch. The learner doubts what the card says now, so do not copy it; give your own answer.

${grammar ? 'Grammar structure' : 'English term'}: "${card.front}"
${card.kind && !grammar ? `Kind: ${card.kind}\n` : ''}${context ? `It was met in this sentence: "${context}"
Give the meaning it has IN THIS SENTENCE, not just its most common meaning.
` : ''}${grammar && card.grammarPattern ? `Pattern written on the card: ${card.grammarPattern}\n` : ''}
Reply with one JSON object:
- "translation": ${grammar ? 'a short Persian explanation of what the structure means and when it is used' : 'the Persian meaning (a few words, the best fit)'}
- "notes": a short Persian note that helps remember it (root, a similar Persian word, a usage tip)
${grammar ? `- "pattern": the structure as a short formula, e.g. "had + past participle"
- "practice": a Persian instruction asking the learner to write one English sentence with this structure
` : `- "pronunciation": IPA between slashes, e.g. /ˈwɜːrd/
- "partOfSpeech": noun, verb, adjective, adverb, phrasal verb, idiom…
- "level": its CEFR level, one of A1 A2 B1 B2 C1 C2
- "collocations": up to 4 common expressions with it, each {"phrase": English, "meaning": Persian}
`}- "definitions": 1 or 2 short English definitions
- "examples": 2 short natural English example sentences`;
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const texts = (v: unknown, max: number): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map(text).filter(Boolean).slice(0, max);

export const parseCardRefresh = (parsed: any, card: Pick<CardContent, 'kind'>): Omit<CardProposal, 'origin'> => {
  const p = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const out: Omit<CardProposal, 'origin'> = {};
  const set = <K extends RefreshField>(key: K, value: Flashcard[K] | undefined) => {
    const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    if (!empty) out[key] = value;
  };
  set('back', text(p.translation));
  set('notes', text(p.notes));
  set('definition', texts(p.definitions, 3));
  set('exampleSentenceTarget', texts(p.examples, 3));
  if (card.kind === 'grammar') {
    set('grammarPattern', text(p.pattern));
    set('practicePrompt', text(p.practice));
  } else {
    set('pronunciation', text(p.pronunciation));
    set('partOfSpeech', text(p.partOfSpeech));
    const level = text(p.level).toUpperCase();
    if ((CEFR as string[]).includes(level)) out.level = level as CefrLevel;
    const collocations: Collocation[] = (Array.isArray(p.collocations) ? p.collocations : [])
      .map((c: any) => (typeof c === 'string' ? { phrase: text(c) } : { phrase: text(c?.phrase), ...(text(c?.meaning) ? { meaning: text(c.meaning) } : {}) }))
      .filter((c: Collocation) => c.phrase)
      .slice(0, 4);
    set('collocations', collocations);
  }
  return out;
};

export const refreshWithAi = async (card: CardContent, options: AiRequestOptions, now: Date = new Date(), send?: Parameters<typeof aiGenerate>[3]): Promise<CardProposal> => {
  // Only the chosen service: its own answer is what the user asked for.
  const { fallbacks: _ignored, ...only } = options;
  const reply = await aiGenerate(only, {
    contents: buildCardRefreshPrompt(card),
    config: { responseMimeType: 'application/json' },
  }, 'details', send);
  const proposal = parseCardRefresh(parseJsonFromAiResponse(reply.text), card);
  if (Object.keys(proposal).length === 0) throw new Error('The AI sent nothing for this card.');
  return { ...proposal, origin: aiOrigin(reply.used, now) };
};

// --- Dictionaries ---

export const refreshWithDictionary = async (card: CardContent, which: 'all' | DictionaryId, now: Date = new Date()): Promise<CardProposal> => {
  if (which === 'all') {
    const e = await freeEnrich(card.front);
    if (!e || (!e.found && !e.translation)) throw new Error('not found');
    const level = levelOfFrequency(e.frequency);
    return {
      ...(e.translation ? { back: e.translation } : {}),
      ...(e.pronunciation ? { pronunciation: e.pronunciation } : {}),
      ...(e.partOfSpeech ? { partOfSpeech: e.partOfSpeech } : {}),
      ...(e.definitions.length ? { definition: e.definitions.slice(0, 3) } : {}),
      ...(e.examples.length ? { exampleSentenceTarget: e.examples.slice(0, 3) } : {}),
      ...(e.collocations.length ? { collocations: e.collocations.slice(0, 6) } : {}),
      ...(e.audioUrl ? { audioSrc: e.audioUrl } : {}),
      ...(level ? { level } : {}),
      origin: { ...dictionaryOrigin(now), ...(e.source ? { provider: e.source } : {}) },
    };
  }
  const d = await lookupDictionary(card.front, { source: which });
  return {
    ...(d.pronunciation && d.pronunciation !== '//' ? { pronunciation: d.pronunciation } : {}),
    ...(d.partOfSpeech ? { partOfSpeech: d.partOfSpeech } : {}),
    ...(d.definitions.length ? { definition: d.definitions.slice(0, 3) } : {}),
    ...(d.exampleSentences.length ? { exampleSentenceTarget: d.exampleSentences.slice(0, 3) } : {}),
    ...(d.audioUrl ? { audioSrc: d.audioUrl } : {}),
    origin: { by: 'dictionary', provider: d.source || dictionaryInfo(which).name, at: now.toISOString() },
  };
};

const dictionaryOf = (source: RefreshSource): 'all' | DictionaryId => {
  const id = source.id.replace(/^dict:/, '');
  return DICTIONARY_IDS.includes(id as DictionaryId) ? (id as DictionaryId) : 'all';
};

export const refreshCard = (card: CardContent, source: RefreshSource): Promise<CardProposal> =>
  source.kind === 'ai'
    ? refreshWithAi(card, source.options || {})
    : refreshWithDictionary(card, dictionaryOf(source));

// What went wrong, in words the user can act on.
export const refreshErrorText = (error: unknown, source: RefreshSource): string => {
  const message = String((error as Error)?.message || '');
  if (source.kind === 'dictionary' && /needs an API key/i.test(message)) return `«${source.name}» کلید می‌خواهد. کلیدش را در تنظیمات، بخش دیکشنری‌ها، وارد کن.`;
  if (source.kind === 'dictionary' && /not found|404/i.test(message)) return `«${source.name}» این واژه را پیدا نکرد.`;
  if (/429|quota|rate/i.test(message)) return `سهمیهٔ ${source.name} فعلاً تمام شده. سرویس دیگری را امتحان کن.`;
  if (/401|403|key/i.test(message)) return `کلید ${source.name} درست نیست. در تنظیمات نگاهش کن.`;
  return `${source.name} جواب نداد. سرویس دیگری را امتحان کن.`;
};

// --- Comparing ---

export const shownValue = (field: RefreshField, value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (field === 'collocations') return (value as Collocation[]).map(c => (c.meaning ? `${c.phrase} = ${c.meaning}` : c.phrase)).join('\n');
  if (Array.isArray(value)) return value.map(String).join('\n');
  return String(value).trim();
};

export interface FieldChange {
  field: RefreshField;
  current: string;
  proposed: string;
}

// The fields where the source says something the card does not.
export const proposalChanges = (card: Partial<CardContent>, proposal: CardProposal): FieldChange[] =>
  FIELD_ORDER
    .filter(field => proposal[field] !== undefined)
    .map(field => ({ field, current: shownValue(field, card[field]), proposed: shownValue(field, proposal[field]) }))
    .filter(change => change.proposed && change.proposed !== change.current);

// The card with the picked fields taken from the proposal. When the meaning
// is taken, the card is now that source's: its origin says so.
export const applyProposal = <T extends Partial<CardContent>>(card: T, proposal: CardProposal, fields: RefreshField[]): T => {
  const next: T = { ...card };
  for (const field of fields) {
    if (proposal[field] !== undefined) (next as any)[field] = proposal[field];
  }
  if (fields.includes('back') && proposal.back !== undefined) next.origin = proposal.origin;
  return next;
};

// "make a decision = تصمیم گرفتن", one per line, as typed in the card form.
export const parseCollocations = (value: string): Collocation[] =>
  value.split('\n').map(line => {
    const at = line.indexOf('=');
    const phrase = (at >= 0 ? line.slice(0, at) : line).trim();
    const meaning = at >= 0 ? line.slice(at + 1).trim() : '';
    return meaning ? { phrase, meaning } : { phrase };
  }).filter(c => c.phrase);

const SCHEDULE_FIELDS = ['repetition', 'easinessFactor', 'interval', 'dueDate', 'stability', 'difficulty', 'lastReviewed', 'lapses'] as const;

// An edited card's new content on one of a review session's copies of it,
// each copy keeping its own schedule (an undo still restores the earlier one).
export const withEditedContent = (copy: Flashcard, saved: Flashcard): Flashcard => {
  if (copy.id !== saved.id) return copy;
  const next: Flashcard = { ...saved };
  for (const field of SCHEDULE_FIELDS) (next as any)[field] = copy[field];
  return next;
};
