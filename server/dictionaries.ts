// File: /server/dictionaries.ts
// One lookup per dictionary, each turned into the same DictionaryEntry, and
// the chain that asks them in the user's order (services/dictionaryCatalog).
// `fetchImpl` is injectable so the parsing can be tested without the network.

import { DEFAULT_DICTIONARY_ORDER, DictionaryId, DictionaryRequest, dictionaryInfo } from '../services/dictionaryCatalog.js';
import { lemmaCandidates } from '../services/lemma.js';

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
}>;

export const defaultFetch: FetchLike = (url, init) => fetch(url, init as RequestInit) as any;

export const DEFAULT_TIMEOUT_MS = 3000;

export interface DictionaryEntry {
  headword: string;
  pronunciation: string;
  partOfSpeech: string;
  definitions: string[];
  examples: string[];
  audioUrl?: string;
  source?: string; // the dictionary's name
  kindHint?: 'idiom' | 'slang'; // the dictionary labels the term so
}

export interface LookupContext {
  keys: DictionaryRequest['keys'];
  fetchImpl: FetchLike;
  timeoutMs: number; // for each request
  deadline: number; // Date.now() after which no dictionary is asked
}

// The whole lookup stays well inside a serverless function's time limit.
export const LOOKUP_BUDGET_MS = 20_000;

// A keyed dictionary without a key (typed on the device or set on the server).
export class MissingKeyError extends Error {
  constructor(id: DictionaryId) {
    super(`${dictionaryInfo(id).name} needs an API key.`);
    this.name = 'MissingKeyError';
  }
}

const UA = 'LinguaCards/1.0 (https://github.com/jafarmrt/Flashcard)';
const norm = (s: string) => s.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
const stripHtml = (s: string) => String(s || '')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

// A dictionary that did not answer (down, timed out, busy, or the lookup ran
// out of time): the chain moves to the next dictionary instead of asking
// this one for every other form of the word.
export class UnreachableError extends Error {
  constructor(message = 'The dictionary did not answer.') {
    super(message);
    this.name = 'UnreachableError';
  }
}

// A key the dictionary would not take (wrong, or not subscribed).
export class RefusedKeyError extends Error {
  constructor(detail: string) {
    super(`The dictionary refused the key (${detail}).`);
    this.name = 'RefusedKeyError';
  }
}

// null: the dictionary answered and does not know the term.
const getJson = async (ctx: LookupContext, url: string, { headers = {}, keyed = false }: { headers?: Record<string, string>; keyed?: boolean } = {}): Promise<any | null> => {
  const left = ctx.deadline - Date.now();
  if (left <= 0) throw new UnreachableError('The lookup ran out of time.');
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await ctx.fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(Math.min(ctx.timeoutMs, left)) });
  } catch {
    throw new UnreachableError();
  }
  if (!res.ok) {
    if (keyed && (res.status === 401 || res.status === 403)) throw new RefusedKeyError(String(res.status));
    if (res.status === 404 || res.status === 400) return null;
    throw new UnreachableError(`The dictionary answered ${res.status}.`);
  }
  try {
    // Merriam-Webster answers a wrong key with plain text, not JSON.
    if (typeof (res as { text?: unknown }).text === 'function') {
      const body: string = await (res as unknown as { text: () => Promise<string> }).text();
      try {
        return JSON.parse(body);
      } catch {
        if (keyed && /invalid api key|not subscribed/i.test(body)) throw new RefusedKeyError('invalid key');
        return null;
      }
    }
    return await res.json();
  } catch (e) {
    if (e instanceof RefusedKeyError) throw e;
    return null; // not JSON
  }
};

// The idiom or slang label a dictionary puts on a definition.
const labelOf = (definitions: string[], partOfSpeech: string): DictionaryEntry['kindHint'] => {
  const all = `${partOfSpeech} ${definitions.slice(0, 2).join(' ')}`.toLowerCase();
  if (/\bslang\b/.test(all)) return 'slang';
  if (/\bidiom(atic)?\b/.test(all)) return 'idiom';
  return undefined;
};

// --- Free Dictionary (dictionaryapi.dev) -----------------------------------

export function parseFreeDictionary(data: any[]): DictionaryEntry | null {
  const entry = data?.[0];
  if (!entry) return null;
  const phonetics: any[] = entry.phonetics || [];
  const definitions: string[] = [];
  const examples: string[] = [];
  let partOfSpeech = '';
  for (const meaning of entry.meanings || []) {
    if (!partOfSpeech) partOfSpeech = meaning.partOfSpeech || '';
    for (const def of meaning.definitions || []) {
      if (def.definition) definitions.push(def.definition);
      if (def.example) examples.push(def.example);
    }
  }
  if (definitions.length === 0) return null;
  return {
    headword: entry.word || '',
    pronunciation: phonetics.find(p => p.text && p.audio)?.text || entry.phonetic || phonetics.find(p => p.text)?.text || '',
    partOfSpeech,
    definitions: definitions.slice(0, 4),
    examples: examples.slice(0, 3),
    audioUrl: phonetics.find(p => p.audio)?.audio || undefined,
  };
}

async function freeDictionary(term: string, ctx: LookupContext): Promise<DictionaryEntry | null> {
  const data = await getJson(ctx, `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(norm(term))}`, { headers: { 'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${UA}` } });
  return Array.isArray(data) && data.length > 0 ? parseFreeDictionary(data) : null;
}

// --- Wiktionary --------------------------------------------------------------

// "simple past of carry", "plural of monastery": the entry only points to
// another form, which is asked next.
const FORM_OF = /^(\(.*?\)\s*)?((simple )?past( tense)?|past participle|present participle|plural|third-person singular|alternative (form|spelling)|obsolete (form|spelling)|misspelling|comparative|superlative)\b.*\bof\b/i;

export function parseWiktionary(data: any, term: string): DictionaryEntry | null {
  const sections: any[] = Array.isArray(data?.en) ? data.en : [];
  const definitions: string[] = [];
  const examples: string[] = [];
  let partOfSpeech = '';
  for (const section of sections) {
    for (const def of section?.definitions || []) {
      const text = stripHtml(def?.definition);
      if (!text || FORM_OF.test(text) || /form-of-definition/.test(String(def?.definition || ''))) continue;
      if (!partOfSpeech) partOfSpeech = String(section.partOfSpeech || '').toLowerCase();
      definitions.push(text);
      const parsed = Array.isArray(def.parsedExamples) ? def.parsedExamples.map((x: any) => x?.example) : [];
      for (const ex of [...parsed, ...(Array.isArray(def.examples) ? def.examples : [])]) {
        const clean = stripHtml(ex);
        if (clean && !examples.includes(clean)) examples.push(clean);
      }
    }
  }
  if (definitions.length === 0) return null;
  return {
    headword: norm(term),
    pronunciation: '',
    partOfSpeech,
    definitions: definitions.slice(0, 4),
    examples: examples.slice(0, 3),
    kindHint: labelOf(definitions, partOfSpeech),
  };
}

async function wiktionary(term: string, ctx: LookupContext): Promise<DictionaryEntry | null> {
  const title = encodeURIComponent(norm(term).replace(/ /g, '_'));
  const data = await getJson(ctx, `https://en.wiktionary.org/api/rest_v1/page/definition/${title}`);
  return data ? parseWiktionary(data, term) : null;
}

// --- Merriam-Webster (Learner's and Collegiate) -----------------------------

// "{bc}a {sx|large||} amount {it}of{/it}" -> "a large amount of"
export const cleanMwText = (s: string) => String(s || '')
  .replace(/\{(?:sx|a_link|d_link|i_link|et_link|mat|dxt)\|([^|}]*)[^}]*\}/g, '$1')
  .replace(/\{dx\}.*?\{\/dx\}/g, '')
  .replace(/\{[^}]*\}/g, '')
  .replace(/\s+/g, ' ')
  .replace(/^[\s:]+/, '')
  .trim();

const mwAudioUrl = (audio?: string): string | undefined => {
  if (!audio) return undefined;
  const subdir = audio.startsWith('bix') ? 'bix' : audio.startsWith('gg') ? 'gg' : /^[0-9_]/.test(audio) ? 'number' : audio.charAt(0);
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${subdir}/${audio}.mp3`;
};

// Every ["text", "..."] and example ("vis") inside a definition tree.
const mwTexts = (node: any, defs: string[], examples: string[]) => {
  if (Array.isArray(node)) {
    if (node[0] === 'text' && typeof node[1] === 'string') {
      const t = cleanMwText(node[1]);
      if (t) defs.push(t);
      return;
    }
    if (node[0] === 'vis' && Array.isArray(node[1])) {
      for (const item of node[1]) if (item?.t) examples.push(cleanMwText(item.t));
      return;
    }
    node.forEach(n => mwTexts(n, defs, examples));
  } else if (node && typeof node === 'object') {
    Object.values(node).forEach(v => mwTexts(v, defs, examples));
  }
};

const mwHeadword = (entry: any) => norm(String(entry?.hwi?.hw || entry?.meta?.id || '').replace(/\*/g, '').replace(/:\d+$/, ''));

// The entry for the term itself, or (for a phrase) the run-on phrase inside a
// longer entry: "kick the bucket" lives under "bucket". A phrase the
// dictionary only lists under another word's entry is never given that
// word's definitions.
export function parseMerriamWebster(data: any[], term: string, name: string): DictionaryEntry | null {
  const entries = (Array.isArray(data) ? data : []).filter(e => e && typeof e === 'object');
  if (entries.length === 0) return null; // unknown: MW sends a list of suggestions (strings)
  const want = norm(term);
  const pron = (entry: any) => {
    const p = entry?.hwi?.prs?.[0];
    const text = p?.ipa || p?.mw || '';
    return { pronunciation: text ? `/${text}/` : '', audioUrl: mwAudioUrl(p?.sound?.audio) };
  };

  const whole = entries.find(e => mwHeadword(e) === want)
    || (!want.includes(' ') ? entries.find(e => (e.meta?.stems || []).map((s: string) => norm(s)).includes(want)) : undefined);
  if (whole) {
    const defs: string[] = (whole.shortdef || []).map(cleanMwText).filter(Boolean);
    const examples: string[] = [];
    mwTexts(whole.def, [], examples);
    if (defs.length === 0) mwTexts(whole.def, defs, []);
    if (defs.length === 0) return null;
    return {
      headword: mwHeadword(whole) || want,
      ...pron(whole),
      partOfSpeech: whole.fl || '',
      definitions: defs.slice(0, 4),
      examples: examples.filter(Boolean).slice(0, 3),
      source: name,
      kindHint: labelOf(defs, whole.fl || ''),
    };
  }

  for (const entry of entries) {
    for (const dro of [...(entry.dros || []), ...(entry.uros || [])]) {
      const phrase = norm(cleanMwText(String(dro?.drp || dro?.ure || '')).replace(/\*/g, ''));
      if (phrase !== want) continue;
      const defs: string[] = [];
      const examples: string[] = [];
      mwTexts(dro.def, defs, examples);
      if (defs.length === 0) continue;
      const gram = String(dro.gram || dro.fl || '');
      return {
        headword: want,
        pronunciation: '',
        partOfSpeech: gram || 'phrase',
        definitions: defs.slice(0, 4),
        examples: examples.filter(Boolean).slice(0, 3),
        source: name,
        kindHint: labelOf(defs, gram),
      };
    }
  }
  return null;
}

const MW_ENV: Record<'mw-learners' | 'mw-collegiate', string> = { 'mw-learners': 'MW_LEARNERS_API_KEY', 'mw-collegiate': 'MW_API_KEY' };
const MW_REF: Record<'mw-learners' | 'mw-collegiate', string> = { 'mw-learners': 'learners', 'mw-collegiate': 'collegiate' };

export const mwKey = (id: 'mw-learners' | 'mw-collegiate', keys: DictionaryRequest['keys']) => keys?.[id] || process.env[MW_ENV[id]] || '';

async function merriamWebster(id: 'mw-learners' | 'mw-collegiate', term: string, ctx: LookupContext): Promise<DictionaryEntry | null> {
  const key = mwKey(id, ctx.keys);
  if (!key) throw new MissingKeyError(id);
  const data = await getJson(ctx, `https://www.dictionaryapi.com/api/v3/references/${MW_REF[id]}/json/${encodeURIComponent(norm(term))}?key=${encodeURIComponent(key)}`, { keyed: true });
  return Array.isArray(data) ? parseMerriamWebster(data, term, dictionaryInfo(id).name) : null;
}

// --- Datamuse ----------------------------------------------------------------

export function parseDatamuse(data: any, term: string): DictionaryEntry | null {
  const item = Array.isArray(data) ? data[0] : null;
  if (!item?.defs || norm(String(item.word || '')) !== norm(term)) return null;
  const definitions: string[] = [];
  let partOfSpeech = '';
  for (const d of item.defs as string[]) {
    const [tag, text] = d.split('\t');
    if (!partOfSpeech) partOfSpeech = tag === 'n' ? 'noun' : tag === 'v' ? 'verb' : tag === 'adj' ? 'adjective' : tag === 'adv' ? 'adverb' : '';
    definitions.push((text || d).trim());
  }
  if (definitions.length === 0) return null;
  return {
    // Datamuse defines inflected forms under their dictionary form ("carried" -> "carry").
    headword: typeof item.defHeadword === 'string' && item.defHeadword ? item.defHeadword : item.word,
    pronunciation: item.tags?.find((t: string) => t.startsWith('ipa:'))?.replace('ipa:', '') || '',
    partOfSpeech,
    definitions: definitions.slice(0, 4),
    examples: [],
  };
}

async function datamuse(term: string, ctx: LookupContext): Promise<DictionaryEntry | null> {
  const data = await getJson(ctx, `https://api.datamuse.com/words?sp=${encodeURIComponent(norm(term))}&md=dp&max=1`);
  return parseDatamuse(data, term);
}

// --- Urban Dictionary --------------------------------------------------------

const cleanUrban = (s: string) => String(s || '').replace(/[[\]]/g, '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();

export function parseUrban(data: any, term: string): DictionaryEntry | null {
  const want = norm(term);
  const list: any[] = (Array.isArray(data?.list) ? data.list : [])
    .filter((d: any) => norm(String(d?.word || '')) === want && d.definition)
    .sort((a: any, b: any) => ((b.thumbs_up || 0) - (b.thumbs_down || 0)) - ((a.thumbs_up || 0) - (a.thumbs_down || 0)));
  if (list.length === 0) return null;
  return {
    headword: want,
    pronunciation: '',
    partOfSpeech: 'slang',
    definitions: list.slice(0, 2).map(d => cleanUrban(d.definition).slice(0, 300)),
    examples: list.slice(0, 2).map(d => cleanUrban(d.example).slice(0, 200)).filter(Boolean),
    kindHint: 'slang',
  };
}

async function urban(term: string, ctx: LookupContext): Promise<DictionaryEntry | null> {
  const data = await getJson(ctx, `https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(norm(term))}`);
  return parseUrban(data, term);
}

// --- One dictionary, and the chain -------------------------------------------

export async function lookupOne(id: DictionaryId, term: string, ctx: LookupContext): Promise<DictionaryEntry | null> {
  let entry: DictionaryEntry | null;
  switch (id) {
    case 'free-dictionary': entry = await freeDictionary(term, ctx); break;
    case 'wiktionary': entry = await wiktionary(term, ctx); break;
    case 'mw-learners':
    case 'mw-collegiate': entry = await merriamWebster(id, term, ctx); break;
    case 'datamuse': entry = await datamuse(term, ctx); break;
    case 'urban': entry = await urban(term, ctx); break;
    default: entry = null;
  }
  return entry ? { ...entry, headword: entry.headword || norm(term), source: entry.source || dictionaryInfo(id).name } : null;
}

export interface ChainOptions {
  request?: DictionaryRequest;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  // Filled in by the chain: a dictionary did not answer or refused its key,
  // so the result may not be what the same choice gives next time.
  report?: { incomplete?: boolean };
}

const contextOf = ({ request, fetchImpl = defaultFetch, timeoutMs = DEFAULT_TIMEOUT_MS }: ChainOptions): LookupContext =>
  ({ keys: request?.keys, fetchImpl, timeoutMs, deadline: Date.now() + LOOKUP_BUDGET_MS });

// The word as written, then its base forms, in each dictionary in turn: a
// dictionary is asked for every form before the next one is asked, so a
// thinner one later in the list never answers for "carried" when an earlier
// one knows "carry". A keyed dictionary without a key, one that refuses its
// key and one that does not answer are skipped. When the answer has no
// pronunciation, the next dictionaries are asked for it.
export async function lookupChain(word: string, options: ChainOptions = {}): Promise<DictionaryEntry | null> {
  const order = options.request?.order ?? DEFAULT_DICTIONARY_ORDER;
  const ctx = contextOf(options);
  const forms = lemmaCandidates(word);
  for (let i = 0; i < order.length; i++) {
    for (const form of forms) {
      let entry: DictionaryEntry | null = null;
      try {
        entry = await lookupOne(order[i], form, ctx);
      } catch (e) {
        if (!(e instanceof MissingKeyError) && options.report) options.report.incomplete = true;
        break; // the next dictionary
      }
      if (!entry) continue;
      if (!entry.pronunciation && !entry.headword.includes(' ')) {
        for (const later of order.slice(i + 1, i + 3)) {
          const extra = await lookupOne(later, entry.headword, ctx).catch(() => null);
          if (extra?.pronunciation) {
            entry = { ...entry, pronunciation: extra.pronunciation, audioUrl: entry.audioUrl || extra.audioUrl };
            break;
          }
        }
      }
      return entry;
    }
  }
  return null;
}

// One dictionary only (the card editor's "fill again from…"), with base forms.
export async function lookupSingle(id: DictionaryId, word: string, options: ChainOptions = {}): Promise<DictionaryEntry | null> {
  const ctx = contextOf(options);
  for (const form of lemmaCandidates(word)) {
    const entry = await lookupOne(id, form, ctx);
    if (entry) return entry;
  }
  return null;
}
