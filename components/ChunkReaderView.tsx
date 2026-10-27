import React, { useEffect, useMemo, useRef, useState } from 'react';
import { extractKinds, KIND_LABEL } from '../services/cardKinds';
import { Chapter, ChapterText, ExtractedWordCard, Flashcard, Settings, Source, TextNote } from '../types';
import { newNote, noteQuote, notesAtWords, notesOfSection, savedTranslation } from '../services/notes';
import { ProxyError } from '../services/apiService';
import { aiOrigin, aiRequestOptions } from '../services/aiSettings';
import { extractFromLongText, ExtractionSource, isPermanentAiError } from '../services/extractionPipeline';
import { lemmaCandidates, tokensOf } from '../services/lemma';
import { enrichmentToCard, freeEnrich, FreeEnrichment } from '../services/freeExtractionService';
import { cardsInText, isChunkOpen } from '../services/library';
import { isKnownTerm, knownMatch } from '../services/knownWords';
import { masteryStage, STAGE_NAMES } from '../services/masteryService';
import { cardForTerm, indexCards } from '../services/cardLookup';
import { phraseRanges, rangeText, readerSection, sentenceOf } from '../services/readerText';
import { analyzeSentence, grammarCards, Sense, SenseBatcher, sensesInContext } from '../services/senseService';
import { detectGrammar, ruleById } from '../services/grammarPatterns';
import { explainInSentence, ruleCard, ruleIdsWithCards } from '../services/grammarCards';
import { normalizeTerm } from '../services/vocabMerge';
import { isBelowLevel } from '../services/wordLevel';
import { isSpeechSupported, speakText, stopSpeech } from '../services/ttsService';
import { piecesOf, type ReadAloudVoice } from '../services/readAloud';
import { translateText, type Translation } from '../services/translate';
import { useReadAloud } from '../hooks/useReadAloud';
import { CHUNK_COMPLETE_XP, isChestSection } from '../services/xpRules';
import { fa, Icon } from './common/ui';
import { Range, ReaderText } from './reader/ReaderText';
import { SelectionBar, SelectionTask, sheetClass } from './reader/SelectionBar';
import { PageColumns, usePagination } from './reader/BookPages';
import { TextEditor } from './reader/TextEditor';

interface ChunkReaderViewProps {
  source: Source;
  chapter: Chapter;
  chunks: string[];
  index: number;
  chapterCount: number;
  settings: Settings;
  cards: Flashcard[]; // every card not deleted
  knownTerms: string[]; // the "I know it" list
  onSaveCards: (cards: ExtractedWordCard[]) => Promise<void>;
  // Finishing a section; then back to the book (default), on to the next
  // section (reading on in book mode), or stay (the chapter's last page).
  onComplete: (then?: CompleteThen) => void | Promise<void>;
  onBack: () => void;
  onOpenChunk: (index: number, entry?: ReaderEntry) => void;
  entry?: ReaderEntry; // where in the section to open (book mode)
  onReviewChapter?: () => void;
  nextChapter?: { title: string; open: () => void };
  onEditText?: (text: string) => Promise<void>; // the reader corrected or cut the section's text
  notes?: TextNote[]; // the reader's notes and kept translations in this chapter
  onSaveNote?: (note: TextNote) => Promise<void> | void; // added, changed or removed (isDeleted)
  onMarkKnown: (term: string) => void;
  onUnmarkKnown: (term: string) => void;
  onUpdateSettings: (changes: Partial<Settings>) => void;
  showToast: (message: string) => void;
}

export type CompleteThen = 'library' | 'next' | 'stay';
// Where a section opens: its first page, its last (paging back from the next
// section), the page of a word, or where the reader left it on this device.
export type ReaderEntry = { kind: 'start' | 'end' | 'resume' } | { kind: 'word'; word: number };

// Book mode: type sizes, and the paper (night is the dark theme's paper).
export const READER_FONT_SIZES = [16, 18, 20, 22, 25];
const DEFAULT_FONT_STEP = 1;
type Paper = NonNullable<Settings['readerPaper']>;
const PAPER: Record<Paper, { label: string; page: string; swatch: string }> = {
  cream: { label: 'کرم', page: 'bg-[#FBF6EC] text-[#2E2A24]', swatch: 'bg-[#FBF6EC]' },
  white: { label: 'سفید', page: 'bg-white text-slate-800', swatch: 'bg-white' },
  night: { label: 'شب', page: 'dark bg-[#18191C] text-[#DAD5C8]', swatch: 'bg-[#18191C]' },
};
// The place on the page, kept on this device: the first word of the page.
const placeKey = (chapterId: string, chunk: number) => `lc_reader_at:${chapterId}:${chunk}`;
const savedPlace = (chapterId: string, chunk: number): number => {
  try { return Math.max(0, Number(localStorage.getItem(placeKey(chapterId, chunk))) || 0); } catch { return 0; }
};

// `uid` stays with an item while its term changes (the dictionary's headword,
// then the AI's form in this sentence); `key` is its term, normalised.
// `forms` are words of the text tapped for it ("running" for "run"),
// `ranges` the words picked for a phrase, `at` the word it was tapped on.
type Item = ExtractedWordCard & {
  uid: string;
  key: string;
  forms: string[];
  ranges?: [number, number][];
  at?: number;
  loading?: boolean;
  senseLoading?: boolean;
  inContext?: boolean; // the meaning was chosen for this sentence
};


// English inside a Persian message, kept apart so it neither reorders the
// sentence nor turns the whole message left-to-right.
const ltr = (text: string) => `\u2068${text}\u2069`;

let uids = 0;
const newUid = () => `i${++uids}`;
const toItem = (card: ExtractedWordCard, extra: Partial<Item> = {}): Item => ({ ...card, uid: newUid(), key: normalizeTerm(card.front), forms: [], ...extra });
const cardOf = ({ uid: _u, key: _k, forms: _f, ranges: _r, at: _a, loading: _l, senseLoading: _s, inContext: _c, ...card }: Item): ExtractedWordCard => card;

// How well the user knows a word that has a card: new (seed, sprout),
// learning (sapling, tree) or learned (rooted).
type Mastery = 'new' | 'learning' | 'learned';
const masteryOf = (card: Flashcard): Mastery => {
  const stage = masteryStage(card);
  return stage <= 1 ? 'new' : stage <= 3 ? 'learning' : 'learned';
};
const MASTERY: Record<Mastery, { label: string; underline: string; dot: string }> = {
  new: { label: 'تازه', underline: 'underline decoration-sky-500 decoration-2 underline-offset-4', dot: 'bg-sky-500' },
  learning: { label: 'در حال یادگیری', underline: 'underline decoration-violet-500 decoration-2 underline-offset-4', dot: 'bg-violet-500' },
  learned: { label: 'بلد', underline: 'underline decoration-emerald-500 decoration-2 underline-offset-4', dot: 'bg-emerald-500' },
};

// Sections of a chapter in the header; a long chapter gets a list instead.
const MAX_SECTION_BUTTONS = 12;
// Hard words shown before reading a section.
const PRE_READ_WORDS = 8;
// The longest pick that gets a meaning; a longer one is a sentence.
const MAX_PHRASE_WORDS = 8;
// Words an AI voice reads in one request (about 35 s of speech); the first
// piece is shorter so reading starts sooner.
const AI_PIECE_WORDS = 90;
const AI_FIRST_PIECE_WORDS = 35;

// A tap on one of these words inside a grammar structure opens the
// structure; a tap on any other word of it looks the word up.
const FUNCTION_WORDS = new Set(('am is are was were be been being have has had having will would shall should can could may might must '
  + 'do does did if unless who whom whose which where when wish wishes wished used to than the so such that too enough not only but '
  + 'also as though better rather it never rarely seldom hardly scarcely barely little nowhere no sooner more less get got getting').split(' '));
const isFunctionWord = (word: string) => {
  const w = word.toLowerCase().replace(/’/g, "'");
  return w.includes("'") || FUNCTION_WORDS.has(w);
};
const GRAMMAR_MARK = 'border-b-2 border-dotted border-rose-400 dark:border-rose-500';

// One section of a chapter: read it, pick its hard words (AI, free
// dictionaries, a tap on a word, or a drag over a phrase), turn them into
// cards, then finish the section.
export const ChunkReaderView: React.FC<ChunkReaderViewProps> = ({
  source: book, chapter, chunks, index, chapterCount, settings, cards, knownTerms, onSaveCards, onComplete, onBack, onOpenChunk,
  onMarkKnown, onUnmarkKnown, onUpdateSettings, showToast, entry = { kind: 'resume' } as ReaderEntry, onReviewChapter, nextChapter,
  onEditText, notes = [], onSaveNote,
}) => {
  const chunk = chunks[index] || '';
  const section = useMemo(() => readerSection(chunk), [chunk]);
  // The reader's notes on this section, where their words are now.
  const placedNotes = useMemo(() => notesOfSection(section, notes, chapter.id, index), [section, notes, chapter.id, index]);
  const notesAt = useMemo(() => notesAtWords(section.words.length, placedNotes), [section, placedNotes]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [selection, setSelection] = useState<Range | null>(null);
  const [busy, setBusy] = useState<SelectionTask | null>(null);
  const [sentenceResult, setSentenceResult] = useState<{ range: Range; translation?: string; by?: string; structures?: { uid: string; name: string }[] } | null>(null);
  // Notes: the one being written, and the word whose notes are open.
  const [noteDraft, setNoteDraft] = useState<{ range: Range; kind: TextNote['kind']; text: string; by?: string; note?: TextNote } | null>(null);
  const [notesOpenAt, setNotesOpenAt] = useState<number | null>(null);
  const [source, setSource] = useState<ExtractionSource>(settings.extractionSource || 'ai');
  const [loading, setLoading] = useState(false);
  const [preRead, setPreRead] = useState<{ state: 'loading' | 'shown' | 'closed'; uids: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Persian translations of paragraphs the reader asked for, by paragraph.
  const [translations, setTranslations] = useState<Record<number, { loading?: boolean; result?: Translation; open?: boolean }>>({});
  const abortRef = useRef<AbortController | null>(null);
  const pending = useRef(new Set<string>());
  // An item merged into another (two forms of one word) points to it.
  const alias = useRef(new Map<string, string>());
  // The AI failed for good (no key, wrong key) in this section: senses and
  // grammar stop asking it; one message says so.
  const aiOff = useRef(false);
  const aiWarned = useRef(false);
  const done = chapter.completed.includes(index);
  const level = settings.userLevel || 'B2';
  const aiOptions = useMemo(() => aiRequestOptions(settings), [settings]);
  const useAi = source === 'ai';

  // Reading aloud, sentence by sentence with the device's voice, or a few
  // sentences at a time with an AI voice; a pause goes on from where it was.
  // A device without speech of its own can only use the AI voice.
  const voice: ReadAloudVoice = settings.readAloudVoice === 'ai' || !isSpeechSupported() ? 'ai' : 'device';
  const pieces = useMemo(() => (voice === 'ai' ? piecesOf(section, AI_PIECE_WORDS, AI_FIRST_PIECE_WORDS) : piecesOf(section)), [section, voice]);
  const readAloud = useReadAloud({
    pieces, textKey: chunk, voice, settings,
    onAiFailed: error => {
      console.warn('AI voice failed:', error);
      if (alive.current) showToast(`صدای هوش مصنوعی جواب نداد؛ با صدای دستگاه ادامه می‌دهم.${error instanceof Error && error.message ? ` ${ltr(error.message)}` : ''}`);
    },
  });
  const readingPiece = readAloud.status !== 'idle' ? pieces[readAloud.index] : undefined;

  const batcher = useRef<SenseBatcher | null>(null);
  const optionsRef = useRef(aiOptions);
  optionsRef.current = aiOptions;
  if (!batcher.current) batcher.current = new SenseBatcher(list => sensesInContext(list, level, optionsRef.current));

  // Leaving the section stops a running search, waiting AI requests and
  // reading aloud; answers that come later are dropped quietly.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; abortRef.current?.abort(); batcher.current?.cancel(); stopSpeech(); }, []);

  const existingFronts = useMemo(() => cards.map(c => c.front), [cards]);
  const deckKeys = useMemo(() => new Set(existingFronts.map(normalizeTerm)), [existingFronts]);
  // Any base form with a card counts: "decided" has a card when "decide" has.
  const hasCard = (term: string) => {
    const key = normalizeTerm(term);
    return deckKeys.has(key) || (!key.includes(' ') && lemmaCandidates(key).some(form => deckKeys.has(normalizeTerm(form))));
  };
  const knownSet = useMemo(() => new Set(knownTerms), [knownTerms]);
  const cardIndex = useMemo(() => indexCards(cards), [cards]);

  // Words of this section that already have a card; finishing the section
  // adds this place to them.
  const metAgain = useMemo(() => {
    const listed = new Set(items.map(it => it.key));
    return cardsInText(chunk, existingFronts.filter(front => !listed.has(normalizeTerm(front))).map(front => ({ front }))).length;
  }, [chunk, existingFronts, items]);

  // Each word's colour by how well its card is known. Words on the "I know
  // it" list stay plain.
  const masteryAt = useMemo(() => {
    const at: (Mastery | undefined)[] = new Array(section.words.length);
    const singles = new Map<string, Mastery>();
    for (const { card } of cardsInText<Flashcard>(chunk, cards)) {
      const key = normalizeTerm(card.front);
      if (key.includes(' ')) {
        for (const [a, b] of phraseRanges(section, key)) for (let i = a; i <= b; i++) at[i] ??= masteryOf(card);
      } else if (!singles.has(key)) singles.set(key, masteryOf(card));
    }
    for (const w of section.words) {
      if (isKnownTerm(w.text, knownSet)) { at[w.i] = undefined; continue; }
      if (at[w.i]) continue;
      at[w.i] = lemmaCandidates(w.text).map(form => singles.get(normalizeTerm(form))).find(Boolean);
    }
    return at;
  }, [chunk, cards, section, knownSet]);
  const masteryShown = useMemo(() => new Set(masteryAt.filter(Boolean)) as Set<Mastery>, [masteryAt]);

  // The structures the app's grammar rules find: per word, the rules it is
  // part of; per sentence, the rules found in it.
  const grammarFound = useMemo(() => {
    const at: string[][] = section.words.map(() => []);
    const bySentence: string[][] = section.sentences.map(() => []);
    section.sentences.forEach((s, n) => {
      const words = section.words.slice(s.first, s.last + 1);
      for (const match of detectGrammar(section.text, words)) {
        if (!bySentence[n].includes(match.id)) bySentence[n].push(match.id);
        for (const k of match.marks) {
          const w = words[k];
          if (w && !at[w.i].includes(match.id)) at[w.i].push(match.id);
        }
      }
    });
    return { at, bySentence };
  }, [section]);
  const showGrammar = !settings.hideGrammar;
  const rulesInDeck = useMemo(() => ruleIdsWithCards(cards), [cards]);

  // Each word's item in the list, if any: a phrase where it occurs, a single
  // word in any of its forms.
  const itemAt = useMemo(() => {
    const at: (string | undefined)[] = new Array(section.words.length);
    const singles = new Map<string, string>();
    for (const it of items) {
      if (it.kind === 'grammar') continue;
      const ranges = [...(it.ranges || []), ...(it.key.includes(' ') ? phraseRanges(section, it.front) : [])];
      for (const [a, b] of ranges) for (let i = a; i <= b; i++) at[i] = it.uid;
      if (!it.key.includes(' ')) {
        singles.set(it.key, it.uid);
        for (const form of it.forms) singles.set(normalizeTerm(form), it.uid);
      }
    }
    for (const w of section.words) {
      if (at[w.i] !== undefined) continue;
      at[w.i] = singles.get(normalizeTerm(w.text)) ?? lemmaCandidates(w.text).map(f => singles.get(normalizeTerm(f))).find(Boolean);
    }
    return at;
  }, [items, section]);

  const resolve = (uid: string | null) => {
    let id = uid;
    for (let n = 0; id && alias.current.has(id) && n < 10; n++) id = alias.current.get(id)!;
    return id;
  };
  const detail = items.find(it => it.uid === resolve(selectedUid));

  // Replaces an item; if its term is now another item's, the two become one.
  const settle = (uid: string, patch: (it: Item) => Item) => setItems(prev => {
    const it = prev.find(p => p.uid === uid);
    if (!it) return prev;
    const next = patch(it);
    const twin = prev.find(p => p.uid !== uid && p.key === next.key && !p.loading);
    if (twin) {
      alias.current.set(uid, twin.uid);
      return prev.filter(p => p.uid !== uid).map(p => (p.uid === twin.uid ? {
        ...p,
        forms: Array.from(new Set([...p.forms, ...next.forms])),
        ranges: [...(p.ranges || []), ...(next.ranges || [])],
        at: p.at ?? next.at,
      } : p));
    }
    return prev.map(p => (p.uid === uid ? next : p));
  });
  const drop = (uid: string) => {
    setItems(prev => prev.filter(p => p.uid !== uid));
    setSelectedUid(s => (s === uid ? null : s));
  };

  const aiFailed = (error: unknown, what: string) => {
    console.warn(`${what} failed:`, error);
    if (isPermanentAiError(error)) aiOff.current = true;
    if (aiWarned.current || !alive.current) return;
    aiWarned.current = true;
    showToast(`هوش مصنوعی جواب نداد؛ ${what === 'sense' ? 'معنی دیکشنری ماند' : what === 'explain' ? 'توضیح عمومی برنامه ماند' : what === 'translate' ? 'ترجمهٔ رایگان به جایش آمد' : 'دوباره امتحان کن'}.${error instanceof Error && error.message ? ` ${ltr(error.message)}` : ''}`);
  };

  // The AI's meaning in this sentence over the dictionary's. When the AI
  // names another term ("look up" for a tap on "look"), the dictionary's
  // sound, examples and expressions belonged to the old one and go.
  const withSense = (it: Item, s: Sense): Item => {
    const front = s.front && tokensOf(s.front).length <= MAX_PHRASE_WORDS ? s.front : it.front;
    const changed = normalizeTerm(front) !== normalizeTerm(it.front);
    const inDeck = hasCard(front);
    return {
      ...it,
      front,
      key: normalizeTerm(front),
      back: s.back,
      definition: s.definition ? [s.definition, ...(changed ? [] : (it.definition || []).filter(d => d !== s.definition))].slice(0, 2) : changed ? [] : it.definition,
      partOfSpeech: s.partOfSpeech || it.partOfSpeech,
      pronunciation: changed ? s.pronunciation || '' : it.pronunciation || s.pronunciation,
      // The AI's kind, except that a phrase it calls a "word" stays a phrase.
      kind: it.kind === 'grammar' || !s.kind || (s.kind === 'word' && tokensOf(front).length > 1) ? it.kind : s.kind,
      notes: s.notes || (changed ? '' : it.notes),
      collocations: changed ? [] : it.collocations,
      exampleSentenceTarget: changed ? [] : it.exampleSentenceTarget,
      audioSrc: changed ? undefined : it.audioSrc,
      level: s.level || (changed ? undefined : it.level),
      notInDictionary: changed ? undefined : it.notInDictionary,
      origin: s.origin || aiOrigin(aiOptions),
      inContext: true,
      loading: false,
      senseLoading: false,
      alreadyInDeck: inDeck,
      selected: inDeck ? false : it.selected,
    };
  };

  // A tapped word or a picked phrase: the dictionary answers first (fast,
  // kept on this device); with AI on, the meaning in this sentence follows.
  const lookUp = async (from: number, to: number) => {
    const single = from === to;
    const term = single ? section.words[from].text.toLowerCase().replace(/’/g, "'") : rangeText(section, from, to);
    const surface = term.toLowerCase();
    if (pending.current.has(surface)) return;
    const sentence = sentenceOf(section, from)?.text || '';
    // A word with a card shows the card at once: the meaning the user is
    // learning, also offline. It used to go to the dictionary like a new
    // word, so the sheet showed another meaning, or nothing when the
    // dictionary could not be reached.
    const own = cardForTerm(cardIndex, surface);
    if (own) {
      const item = toItem({ front: own.front, back: own.back, kind: own.kind || (single ? 'word' : 'phrase'), sourceSentence: sentence, selected: false, alreadyInDeck: true }, {
        forms: single ? [surface] : [], ranges: single ? undefined : [[from, to]], at: from,
      });
      setItems(prev => [...prev, item]);
      setSelectedUid(item.uid);
      setSelection(null);
      return;
    }
    pending.current.add(surface);
    const inDeck = hasCard(surface);
    const wantSense = useAi && !aiOff.current && !inDeck;
    const temp = toItem({ front: term, back: '…', kind: single ? 'word' : 'phrase', sourceSentence: sentence, selected: !inDeck, alreadyInDeck: inDeck }, {
      forms: single ? [surface] : [], ranges: single ? undefined : [[from, to]], at: from, loading: true,
    });
    setItems(prev => [...prev, temp]);
    setSelectedUid(temp.uid);
    setSelection(null);
    const sense = wantSense
      ? batcher.current!.request({ term, sentence }).catch(error => { aiFailed(error, 'sense'); return null; })
      : Promise.resolve(null);
    try {
      let entry: FreeEnrichment | null = null;
      let unreachable = false;
      try {
        entry = await freeEnrich(surface);
      } catch (error) {
        console.warn('Dictionary lookup failed:', error);
        unreachable = true;
      }
      if (!alive.current) return;
      const known = !!entry && (entry.found || !!entry.translation);
      if (known) {
        settle(temp.uid, it => {
          const card = enrichmentToCard(surface, sentence, entry!, it.kind);
          const front = single ? card.front : term; // a dictionary headword for a phrase is the phrase itself
          const deck = hasCard(front) || inDeck;
          return { ...it, ...card, front, key: normalizeTerm(front), loading: false, senseLoading: wantSense, alreadyInDeck: deck, selected: !deck };
        });
        setSaved(false);
      } else if (!wantSense) {
        showToast(unreachable ? 'جست‌وجوی واژه ناموفق بود. اتصال را بررسی کن.' : `واژهٔ «${ltr(term)}» در دیکشنری پیدا نشد.`);
        drop(temp.uid);
        return;
      }
      const s = await sense;
      if (!alive.current) return;
      if (s) {
        settle(temp.uid, it => withSense(it, s));
        setSaved(false);
      } else if (!known) {
        showToast(unreachable ? 'جست‌وجوی واژه ناموفق بود. اتصال را بررسی کن.' : `معنی «${ltr(term)}» پیدا نشد.`);
        drop(temp.uid);
      } else {
        settle(temp.uid, it => ({ ...it, senseLoading: false }));
      }
    } finally {
      pending.current.delete(surface);
    }
  };

  // A structure the rules found: its card from the app's own explanation;
  // with AI, an explanation about this very sentence follows.
  const openRule = (id: string, wordIndex?: number) => {
    const rule = ruleById(id);
    if (!rule) return;
    setSentenceResult(null);
    setSelection(null);
    const twin = items.find(it => it.kind === 'grammar' && (it.grammarId === id || it.key === normalizeTerm(rule.name)));
    if (twin) { setSelectedUid(twin.uid); return; }
    const sentence = wordIndex !== undefined ? sentenceOf(section, wordIndex)?.text : undefined;
    const deck = rulesInDeck.has(id) || hasCard(rule.name);
    const wantAi = useAi && !aiOff.current && !deck && !!sentence;
    const item = toItem({ ...ruleCard(rule, sentence), selected: !deck, alreadyInDeck: deck }, { senseLoading: wantAi });
    setItems(prev => [...prev, item]);
    setSelectedUid(item.uid);
    if (!deck) setSaved(false);
    if (!wantAi) return;
    explainInSentence(rule, sentence!, aiOptions)
      .then(r => { if (alive.current) settle(item.uid, it => ({ ...it, back: r.explanation, notes: rule.explanation, origin: r.origin, inContext: true, senseLoading: false })); })
      .catch(error => {
        aiFailed(error, 'explain');
        if (alive.current) settle(item.uid, it => ({ ...it, senseLoading: false }));
      });
  };

  const tapWord = (i: number) => {
    setSentenceResult(null);
    setSelection(null);
    // A word with a note opens the note; the note offers the word's meaning.
    if (notesAt[i]?.length) {
      setSelectedUid(null);
      setNoteDraft(null);
      setNotesOpenAt(i);
      return;
    }
    setNotesOpenAt(null);
    const rules = showGrammar ? grammarFound.at[i] : [];
    if (rules.length > 0 && isFunctionWord(section.words[i].text)) {
      openRule(rules[0], i);
      return;
    }
    const existing = itemAt[i];
    if (existing) {
      setSelectedUid(existing);
      setItems(prev => prev.map(p => (p.uid === existing && p.at === undefined ? { ...p, at: i } : p)));
      return;
    }
    lookUp(i, i);
  };

  // The sentences a pick lies in, as written.
  const sentencesOf = (range: Range) => {
    const a = section.sentences[section.words[range.from].sentence];
    const b = section.sentences[section.words[range.to].sentence];
    return chunk.slice(a.start, b.end).replace(/\s+/g, ' ').trim();
  };

  const pick = (range: Range) => {
    setSelection(range);
    setSelectedUid(null);
    setNotesOpenAt(null);
    setNoteDraft(null);
    setSentenceResult(r => (r && r.range.from === range.from && r.range.to === range.to ? r : null));
  };

  const grow = (side: -1 | 1) => {
    if (!selection) return;
    pick({ from: Math.max(0, selection.from + (side < 0 ? -1 : 0)), to: Math.min(section.words.length - 1, selection.to + (side > 0 ? 1 : 0)) });
  };

  const wholeSentence = (range: Range) => {
    const first = section.sentences[section.words[range.from].sentence].first;
    const last = section.sentences[section.words[range.to].sentence].last;
    pick({ from: first, to: last });
  };

  const translateSelection = async (picked: Range | null = selection) => {
    if (!picked) return;
    const range = picked;
    setBusy('translate');
    try {
      const result = await translateText(sentencesOf(range), useAi && !aiOff.current, aiOptions);
      if (result.aiError && result.text) aiFailed(new Error(result.aiError), 'translate');
      const translation = result.text;
      const by = result.by === 'ai' ? result.service || 'AI' : 'MyMemory';
      if (!translation) showToast('ترجمه نیامد. کمی بعد دوباره امتحان کن.');
      else setSentenceResult(r => ({ ...(r?.range.from === range.from && r.range.to === range.to ? r : {}), range, translation, by }));
    } catch (error) {
      console.error('Translation failed:', error);
      showToast('ترجمه ناموفق بود. اتصال را بررسی کن.');
    } finally {
      setBusy(null);
    }
  };

  // The grammar of the picked sentence: its structures join the list as
  // grammar items, each with a Persian explanation and an exercise.
  const analyzeSelection = async () => {
    if (!selection) return;
    const range = selection;
    const sentence = sentencesOf(range);
    setBusy('grammar');
    try {
      const analysis = await analyzeSentence(sentence, level, aiOptions);
      const found = grammarCards(analysis, sentence).map(card => {
        const deck = hasCard(card.front);
        return toItem({ ...card, origin: card.origin || aiOrigin(aiOptions), alreadyInDeck: deck, selected: !deck });
      });
      const have = new Map<string, Item>(items.map(it => [it.key, it]));
      const fresh = found.filter(it => !have.has(it.key));
      setItems(prev => [...prev, ...fresh]);
      const shown = found.map(it => have.get(it.key) || it);
      setSentenceResult({ range, translation: analysis.translation || undefined, structures: shown.map(it => ({ uid: it.uid, name: it.front })) });
      if (found.length === 0) showToast('ساختار دستوری مهمی در این جمله پیدا نشد.');
      if (fresh.length) setSaved(false);
    } catch (error) {
      aiFailed(error, 'grammar');
    } finally {
      setBusy(null);
    }
  };

  const extract = async (perSection: number, includeGrammar: boolean): Promise<Item[]> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      // Items already in the list are not asked for again.
      const listed = items.filter(it => !it.loading).map(it => it.front);
      const result = await extractFromLongText({
        text: chunk,
        level,
        perSection,
        source,
        existingFronts: [...existingFronts, ...listed],
        knownRuleIds: [...rulesInDeck, ...items.map(it => it.grammarId).filter((id): id is string => !!id)],
        knownTerms,
        includeGrammar,
        kinds: extractKinds(settings),
        aiOptions,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return [];
      const listedKeys = new Set(listed.map(normalizeTerm));
      const fresh = result.cards
        .filter(c => !listedKeys.has(normalizeTerm(c.front)))
        // A word the AI chose but rates below the learner's level is listed but
        // not picked. Free dictionaries already pick by level, so theirs stay.
        .map(c => toItem({ ...c, selected: !c.alreadyInDeck && !(c.kind === 'word' && c.origin?.by === 'ai' && isBelowLevel(c.level, level)) }));
      if (result.fallbackSections > 0) {
        showToast(`هوش مصنوعی جواب نداد؛ از دیکشنری رایگان استفاده شد.${result.aiError ? ` ${ltr(result.aiError)}` : ''}`);
      } else if (fresh.length === 0) {
        showToast(result.failedSections > 0 ? 'پیدا کردن واژه‌ها ناموفق بود. تنظیمات یا اتصال را بررسی کن.' : 'واژهٔ سخت تازه‌ای پیدا نشد.');
      }
      const have = new Set(items.map(p => p.key));
      const added = fresh.filter(c => !have.has(c.key));
      setItems(prev => {
        const now = new Set(prev.map(p => p.key));
        return [...prev, ...added.filter(c => !now.has(c.key))];
      });
      if (added.length > 0) setSaved(false);
      return added;
    } catch (error) {
      console.error('Extraction failed:', error);
      if (!controller.signal.aborted) showToast('پیدا کردن واژه‌ها ناموفق بود. اتصال را بررسی کن.');
      return [];
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  };

  // Before reading: the section's hardest words, to meet them first.
  const runPreRead = async () => {
    setPreRead({ state: 'loading', uids: [] });
    const found = await extract(PRE_READ_WORDS, false);
    setPreRead({ state: 'shown', uids: found.filter(it => !it.alreadyInDeck && it.kind !== 'grammar').slice(0, PRE_READ_WORDS).map(it => it.uid) });
  };
  useEffect(() => {
    if (!settings.preReadAuto || done || section.words.length === 0) return;
    runPreRead();
    // In book mode the hard words open beside the page.
    if (settings.readerMode !== 'scroll') setPanel('words');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markKnown = (it: Item) => {
    onMarkKnown(it.front);
    drop(it.uid);
    showToast(`«${ltr(it.front)}» به فهرست «بلدم» رفت و دیگر پیشنهاد نمی‌شود.`);
  };

  const toggle = (uid: string) => setItems(prev => prev.map(p => (p.uid === uid ? { ...p, selected: !p.selected } : p)));
  const ready = (it: Item) => !it.loading && !it.senseLoading && !!it.back && it.back !== '…';
  const toSave = items.filter(it => it.selected && !it.alreadyInDeck && ready(it));
  const waiting = items.filter(it => it.selected && !it.alreadyInDeck && it.senseLoading).length;

  const save = async () => {
    if (saving || toSave.length === 0) return;
    setSaving(true);
    const ids = new Set(toSave.map(it => it.uid));
    try {
      await onSaveCards(toSave.map(cardOf));
      setItems(prev => prev.map(p => (ids.has(p.uid) ? { ...p, alreadyInDeck: true, selected: false } : p)));
      setSaved(true);
    } catch (error) {
      console.error('Saving cards failed:', error);
      showToast('ساخت کارت‌ها ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const finish = () => {
    if (toSave.length > 0 && !window.confirm(`${fa(toSave.length)} واژهٔ انتخاب‌شده هنوز کارت نشده‌اند. بدون ساختن کارت تمام شود؟`)) return;
    onComplete('library');
  };

  // --- Book mode: the section as pages ---
  const bookMode = settings.readerMode !== 'scroll';
  const fontStep = Math.max(0, Math.min(READER_FONT_SIZES.length - 1, settings.readerFontSize ?? DEFAULT_FONT_STEP));
  const justify = settings.readerJustify !== false;
  const appDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const paper: Paper = appDark ? 'night' : settings.readerPaper || 'cream';
  const room = useRef<HTMLDivElement>(null);
  const pageText = useRef<HTMLDivElement>(null);
  const firstAnchor = useMemo(() => (entry.kind === 'start' ? 0
    : entry.kind === 'end' ? Math.max(0, section.words.length - 1)
    : entry.kind === 'word' ? entry.word
    : savedPlace(chapter.id, index)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const pagination = usePagination(room, pageText, firstAnchor, `${bookMode}|${fontStep}|${justify}|${chunk.length}`);
  const { layout, pages, page } = pagination;
  // The chapter's last section ends on a page of its own.
  const [endPage, setEndPage] = useState(false);
  const [panel, setPanel] = useState<'type' | 'words' | null>(null);
  const [editing, setEditing] = useState(false);
  const editor = editing && onEditText && (
    <TextEditor title={`${chapterCount > 1 ? `${chapter.title}، ` : ''}بخش ${fa(index + 1)} از ${fa(chunks.length)}`} text={chunk}
      unsavedPicks={items.filter(it => it.selected && !it.alreadyInDeck).length}
      onClose={() => setEditing(false)}
      onSave={async text => {
        try {
          await onEditText(text);
          showToast(text.trim() ? 'متن این بخش ذخیره شد.' : 'متن این بخش حذف شد.');
        } catch (error) {
          console.error('Saving the text failed:', error);
          showToast('ذخیرهٔ متن ناموفق بود.');
        }
      }} />
  );
  const isLastSection = index >= chunks.length - 1;
  const sectionEmpty = section.words.length === 0;

  const turnTo = (p: number) => {
    pagination.turnTo(p);
    setSelection(null);
  };
  // The place on the page is kept for the next time this section opens here.
  useEffect(() => {
    if (!bookMode || !layout) return;
    try { localStorage.setItem(placeKey(chapter.id, index), String(pagination.firstWordOn(page))); } catch { /* private mode */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, layout]);

  // Leaving a section with words picked but not saved: they are saved, or
  // left, as the reader says; turning the page is never blocked.
  const leaveSection = async () => {
    if (toSave.length === 0) return;
    if (window.confirm(`${fa(toSave.length)} واژهٔ انتخاب‌شده هنوز کارت نشده. کارتشان ساخته شود؟\n(لغو: بی‌کارت ادامه بده)`)) await save();
  };
  const turning = useRef(false);
  const nextPage = async () => {
    if (endPage || turning.current) return;
    if (page < pages - 1) { turnTo(page + 1); return; }
    turning.current = true;
    try {
      await leaveSection();
      readAloud.stop();
      if (isLastSection) {
        if (!done) await onComplete('stay');
        setEndPage(true);
      } else if (!done) {
        await onComplete('next');
      } else {
        onOpenChunk(index + 1, { kind: 'start' });
      }
    } finally {
      turning.current = false;
    }
  };
  const prevPage = () => {
    if (endPage) { setEndPage(false); return; }
    if (page > 0) { turnTo(page - 1); return; }
    if (index > 0) { readAloud.stop(); onOpenChunk(index - 1, { kind: 'end' }); }
  };
  const atStart = !endPage && page === 0 && index === 0;

  // Arrow keys and Page Up/Down turn pages, as in an e-book.
  useEffect(() => {
    if (!bookMode) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || e.altKey || e.ctrlKey || e.metaKey)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); nextPage(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prevPage(); }
      else if (e.key === 'Escape') { setPanel(null); setSelection(null); setSelectedUid(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // A swipe with a finger turns the page; a tap on a word still looks it up.
  const swipe = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const swiped = useRef(false);
  const onSwipeStart = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() };
    swiped.current = false;
  };
  const onSwipeEnd = (e: React.PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.4 || Date.now() - s.t > 800) return;
    swiped.current = true;
    if (dx < 0) nextPage(); else prevPage();
  };

  // Reading aloud starts on the page in view, and the pages follow it.
  const readFromPage = () => {
    if (readAloud.status !== 'idle') { readAloud.toggle(); return; }
    const first = pagination.firstWordOn(page);
    const from = pieces.findIndex(p => p.to >= first);
    readAloud.play(from >= 0 ? from : 0);
  };
  useEffect(() => {
    if (!bookMode || !readAloud.active || !readingPiece || !layout) return;
    const p = pagination.pageOfWord(readingPiece.from);
    if (p !== page) pagination.turnTo(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readAloud.index, readAloud.active]);

  // A word opened from the list is brought into view.
  useEffect(() => {
    if (!bookMode || !detail || !layout) return;
    const place = placeOf(detail);
    if (!place) return;
    const p = pagination.pageOfWord(place.from);
    if (p !== page) pagination.turnTo(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUid]);

  // Keeps the piece being read in view.
  useEffect(() => {
    if (bookMode || !readAloud.active || !readingPiece) return;
    const el = document.querySelector(`[data-wi="${readingPiece.from}"]`);
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.top < 80 || box.bottom > window.innerHeight - 80) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readAloud.index, readAloud.active]);

  const translateParagraph = async (pi: number) => {
    const range = paragraphRange(pi);
    const kept = range ? savedTranslation(placedNotes, range) : undefined;
    const now = translations[pi] || (kept ? { result: { text: kept.text, by: 'ai' as const, service: kept.by }, open: true } : undefined);
    if (now?.loading) return;
    if (now?.result) { setTranslations(t => ({ ...t, [pi]: { ...now, open: !now.open } })); return; }
    const p = section.paragraphs[pi];
    if (!p) return;
    setTranslations(t => ({ ...t, [pi]: { loading: true } }));
    try {
      const result = await translateText(chunk.slice(p.start, p.end), useAi && !aiOff.current, aiOptions);
      if (!alive.current) return;
      if (result.aiError && result.text) aiFailed(new Error(result.aiError), 'translate');
      if (!result.text) {
        showToast('ترجمه نیامد. کمی بعد دوباره امتحان کن.');
        setTranslations(t => { const { [pi]: _gone, ...rest } = t; return rest; });
        return;
      }
      setTranslations(t => ({ ...t, [pi]: { result, open: true } }));
    } catch (error) {
      console.error('Translation failed:', error);
      if (!alive.current) return;
      showToast('ترجمه ناموفق بود. اتصال را بررسی کن.');
      setTranslations(t => { const { [pi]: _gone, ...rest } = t; return rest; });
    }
  };

  const paragraphFooter = (pi: number) => {
    const firstPiece = pieces.findIndex(p => p.paragraph === pi);
    const readingHere = !!readingPiece && readingPiece.paragraph === pi;
    const range = paragraphRange(pi);
    const kept = range ? savedTranslation(placedNotes, range) : undefined;
    // A translation kept for the paragraph shows under it, open, every time.
    const t = translations[pi] || (kept ? { result: { text: kept.text, by: 'ai' as const, service: kept.by }, open: true } : undefined);
    return (
      <div dir="rtl" lang="fa" className="font-fa mt-1 flex flex-col gap-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {firstPiece >= 0 && !readingHere && (
            <button type="button" onClick={() => readAloud.play(firstPiece)}
              className="inline-flex items-center gap-1 min-h-[32px] text-ink-muted dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-300">
              <Icon.Speaker size={14} />از اینجا بخوان
            </button>
          )}
          <button type="button" onClick={() => translateParagraph(pi)} disabled={t?.loading} aria-expanded={!!t?.open}
            className="inline-flex items-center gap-1 min-h-[32px] text-ink-muted dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-300 disabled:opacity-60">
            <Icon.Translate size={14} />
            {t?.loading ? 'در حال ترجمه…' : t?.open ? 'بستن ترجمه' : t?.result ? 'نشان دادن ترجمه' : 'ترجمهٔ این پاراگراف'}
          </button>
        </div>
        {t?.result && t.open && (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 px-4 py-3 flex flex-col gap-1 select-text">
            <p className="text-[15px] md:text-base leading-8 text-ink dark:text-slate-100 whitespace-pre-line">{t.result.text}</p>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted dark:text-slate-400">
              <span>
                {kept ? <>ترجمهٔ ذخیره‌شده{kept.by ? ` (${ltr(kept.by)})` : ''}</>
                  : t.result.by === 'ai' ? <>ترجمهٔ هوش مصنوعی ({ltr(t.result.service || 'AI')})</> : 'ترجمهٔ رایگان (MyMemory)؛ ممکن است دقیق نباشد.'}
              </span>
              {onSaveNote && range && !kept && (
                <button type="button" onClick={() => keepTranslation(range, t.result!.text, t.result!.by === 'ai' ? t.result!.service || 'AI' : 'MyMemory')}
                  className="font-bold text-brand-700 dark:text-brand-300 hover:underline">ذخیرهٔ ترجمه</button>
              )}
              {kept && <button type="button" onClick={() => removeNote(kept)} className="text-red-700 dark:text-red-300 hover:underline">حذف ترجمهٔ ذخیره‌شده</button>}
            </span>
          </div>
        )}
      </div>
    );
  };

  // The open item stands out; other listed items are marked until they
  // become cards, then show their card's colour like any word with a card.
  const pendingUids = useMemo(() => new Set(items.filter(it => !it.alreadyInDeck).map(it => it.uid)), [items]);
  const classFor = (i: number) => {
    const grammar = showGrammar && grammarFound.at[i].length > 0 ? ` ${GRAMMAR_MARK}` : '';
    const uid = itemAt[i];
    if (uid !== undefined && uid === detail?.uid) return `bg-brand-200 ring-2 ring-brand-500 dark:bg-brand-800${grammar}`;
    if (uid !== undefined && pendingUids.has(uid)) return `bg-amber-100 dark:bg-amber-900/50${grammar}`;
    const m = masteryAt[i];
    const read = readingPiece && i >= readingPiece.from && i <= readingPiece.to ? ' bg-yellow-100 dark:bg-yellow-900/40' : '';
    // The reader's own notes: green for a comment, blue for a kept translation.
    const noted = read || !notesAt[i]?.length ? ''
      : notesAt[i].some(n => n.kind === 'comment') ? ' bg-lime-100 dark:bg-lime-900/40' : ' bg-sky-100/70 dark:bg-sky-900/40';
    return `${m ? MASTERY[m].underline : ''}${grammar}${read}${noted}`;
  };

  // --- Notes and kept translations ---
  const paragraphRange = (pi: number): Range | null => {
    const words = section.paragraphs[pi]?.words;
    return words?.length ? { from: words[0].i, to: words[words.length - 1].i } : null;
  };
  const paragraphOf = (wordIndex: number) => section.paragraphs.findIndex(p => p.words.some(w => w.i === wordIndex));
  const startNote = (range: Range, kind: TextNote['kind'] = 'comment', text = '', by?: string) => {
    setSelectedUid(null);
    setNotesOpenAt(null);
    setNoteDraft({ range, kind, text, ...(by ? { by } : {}) });
  };
  const keepNote = async (draft: NonNullable<typeof noteDraft>) => {
    if (!onSaveNote || !draft.text.trim()) return;
    const note = draft.note
      ? { ...draft.note, text: draft.text.trim() }
      : newNote({ sourceId: book.id, chapterId: chapter.id, chunk: index, kind: draft.kind, from: draft.range.from, to: draft.range.to, quote: noteQuote(section, draft.range), text: draft.text, by: draft.by });
    await onSaveNote(note);
    setNoteDraft(null);
    setSelection(null);
    showToast(draft.kind === 'translation' ? 'ترجمه ذخیره شد؛ روی واژه‌های آبی بزن تا ببینی‌اش.' : 'یادداشت ذخیره شد.');
  };
  const removeNote = async (note: TextNote) => {
    if (!onSaveNote || !window.confirm(note.kind === 'translation' ? 'این ترجمهٔ ذخیره‌شده حذف شود؟' : 'این یادداشت حذف شود؟')) return;
    await onSaveNote({ ...note, isDeleted: true });
    setNotesOpenAt(null);
    setNoteDraft(null);
  };
  const keepTranslation = (range: Range, text: string, by?: string) =>
    keepNote({ range, kind: 'translation', text, ...(by ? { by } : {}) });

  // Under the picked words: a note on them, the translation kept, or the
  // whole paragraph translated.
  const selectionExtra = (range: Range, found: typeof sentenceResult) => {
    if (!onSaveNote) return null;
    const kept = savedTranslation(placedNotes, range);
    const paragraph = paragraphRange(paragraphOf(range.from));
    const isParagraph = !!paragraph && paragraph.from === range.from && paragraph.to === range.to;
    const chip = 'min-h-[36px] px-3 rounded-xl text-sm bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40';
    return (
      <div className="flex flex-col gap-2">
        {kept && !found?.translation && (
          <div className="rounded-xl bg-sky-50 dark:bg-sky-900/30 px-3 py-2 flex flex-col gap-1">
            <p className="text-ink dark:text-slate-100 whitespace-pre-line">{kept.text}</p>
            <span className="text-[11px] text-ink-muted dark:text-slate-400">ترجمهٔ ذخیره‌شده{kept.by ? ` (${ltr(kept.by)})` : ''}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={chip} onClick={() => startNote(range)}>✎ یادداشت</button>
          {found?.translation && !kept && <button type="button" className={chip} onClick={() => keepTranslation(range, found.translation!, found.by)}>ذخیرهٔ این ترجمه</button>}
          {kept && <button type="button" className={chip} onClick={() => removeNote(kept)}>حذف ترجمهٔ ذخیره‌شده</button>}
          {paragraph && !isParagraph && (
            <button type="button" className={chip} disabled={!!busy} onClick={() => { pick(paragraph); if (!savedTranslation(placedNotes, paragraph)) translateSelection(paragraph); }}>
              ترجمهٔ کل پاراگراف
            </button>
          )}
        </div>
      </div>
    );
  };

  // A note being written or changed.
  const noteEditor = (floating: boolean) => noteDraft && (
    <section aria-label="یادداشت" className={`${sheetClass(floating)} gap-3`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-ink dark:text-white">{noteDraft.kind === 'translation' ? 'ترجمهٔ این بخش از متن' : noteDraft.note ? 'ویرایش یادداشت' : 'یادداشت روی این بخش از متن'}</p>
          <p dir="ltr" lang="en" className="font-read text-[15px] text-ink-muted dark:text-slate-400 line-clamp-3 text-left">{noteQuote(section, noteDraft.range)}</p>
        </div>
        <button type="button" onClick={() => setNoteDraft(null)} aria-label="بستن" className="w-9 h-9 -m-1.5 shrink-0 rounded-xl flex items-center justify-center text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700"><Icon.Close size={18} /></button>
      </div>
      <textarea dir="auto" value={noteDraft.text} autoFocus rows={4} onChange={e => setNoteDraft(d => d && { ...d, text: e.target.value })}
        placeholder="هر چه می‌خواهی بنویس: معنی، نکته، سؤال، ارتباط با جای دیگر کتاب…"
        className="w-full rounded-2xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-ink dark:text-slate-100 focus:outline-none focus:border-brand-500" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => keepNote(noteDraft)} disabled={!noteDraft.text.trim()} className="min-h-[44px] px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold disabled:opacity-50">ذخیره</button>
        <button type="button" onClick={() => setNoteDraft(null)} className="min-h-[44px] px-4 rounded-xl text-sm border border-slate-200 dark:border-slate-600">لغو</button>
        <span className="flex-1" />
        {noteDraft.note && <button type="button" onClick={() => removeNote(noteDraft.note!)} className="min-h-[44px] px-3 rounded-xl text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30">حذف</button>}
      </div>
    </section>
  );

  // The notes on a tapped word.
  const noteViewer = (floating: boolean) => {
    if (notesOpenAt === null) return null;
    const here = notesAt[notesOpenAt] || [];
    if (here.length === 0) return null;
    const at = notesOpenAt;
    return (
      <section aria-label="یادداشت‌های این واژه" className={`${sheetClass(floating)} gap-3`}>
        <div className="flex items-center gap-2">
          <p className="flex-1 font-bold text-ink dark:text-white">{here.length > 1 ? `${fa(here.length)} یادداشت روی این واژه` : here[0].kind === 'translation' ? 'ترجمهٔ ذخیره‌شده' : 'یادداشت تو'}</p>
          <button type="button" onClick={() => setNotesOpenAt(null)} aria-label="بستن" className="w-9 h-9 -m-1.5 shrink-0 rounded-xl flex items-center justify-center text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700"><Icon.Close size={18} /></button>
        </div>
        {here.map(n => {
          const range = placedNotes.find(p => p.note.id === n.id)?.range;
          return (
            <div key={n.id} className={`rounded-2xl px-3 py-2.5 flex flex-col gap-1.5 ${n.kind === 'translation' ? 'bg-sky-50 dark:bg-sky-900/30' : 'bg-lime-50 dark:bg-lime-900/30'}`}>
              <p dir="ltr" lang="en" className="font-read text-sm text-ink-muted dark:text-slate-400 line-clamp-2 text-left">{n.quote}</p>
              <p dir="auto" className="text-ink dark:text-slate-100 whitespace-pre-line">{n.text}</p>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-ink-muted dark:text-slate-400">{n.kind === 'translation' ? `ترجمه${n.by ? ` (${ltr(n.by)})` : ''}` : 'یادداشت'} · {new Date(n.updatedAt).toLocaleDateString('fa-IR')}</span>
                <span className="flex-1" />
                {range && <button type="button" onClick={() => { setNotesOpenAt(null); setNoteDraft({ range, kind: n.kind, text: n.text, note: n, ...(n.by ? { by: n.by } : {}) }); }} className="text-brand-700 dark:text-brand-300 hover:underline">ویرایش</button>}
                <button type="button" onClick={() => removeNote(n)} className="text-red-700 dark:text-red-300 hover:underline">حذف</button>
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => { setNotesOpenAt(null); lookUp(at, at); }} className="min-h-[40px] px-3 rounded-xl text-sm font-bold bg-brand-500 hover:bg-brand-600 text-white">معنی این واژه</button>
          <button type="button" onClick={() => pick({ from: at, to: at })} className="min-h-[40px] px-3 rounded-xl text-sm bg-slate-100 dark:bg-slate-700">انتخاب برای عبارت یا جمله</button>
        </div>
      </section>
    );
  };

  // Every note and kept translation of the chapter, to go back to.
  const notesList = onSaveNote && notes.some(n => !n.isDeleted) && (
    <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-2">
      <h2 className="font-bold text-ink dark:text-white">یادداشت‌ها و ترجمه‌های {chapterCount > 1 ? 'این فصل' : 'این متن'}</h2>
      <ul className="flex flex-col gap-1.5 max-h-[22rem] overflow-y-auto -mx-1 px-1">
        {notes.filter(n => !n.isDeleted).sort((a, b) => a.chunk - b.chunk || a.from - b.from).map(n => (
          <li key={n.id}>
            <button type="button" onClick={() => {
              setPanel(null);
              if (n.chunk === index) {
                const range = placedNotes.find(p => p.note.id === n.id)?.range;
                if (!range) { showToast('واژه‌های این یادداشت در متن ویرایش‌شده پیدا نشد.'); return; }
                if (bookMode) pagination.turnTo(pagination.pageOfWord(range.from));
                setSelectedUid(null);
                setNotesOpenAt(range.from);
              } else {
                onOpenChunk(n.chunk, { kind: 'word', word: n.from });
              }
            }} className="w-full text-right rounded-xl px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex flex-col gap-0.5">
              <span className="text-[11px] text-ink-muted dark:text-slate-400">بخش {fa(n.chunk + 1)} · {n.kind === 'translation' ? 'ترجمه' : 'یادداشت'}</span>
              <span dir="ltr" lang="en" className="font-read text-sm text-ink-muted dark:text-slate-400 truncate text-left">{n.quote}</span>
              <span dir="auto" className="text-sm text-ink dark:text-slate-100 line-clamp-2">{n.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  // Where an item is in the text, to widen it into a phrase or a sentence.
  const placeOf = (it: Item): Range | null => {
    if (it.ranges?.length) return { from: it.ranges[0][0], to: it.ranges[0][1] };
    if (it.at !== undefined) return { from: it.at, to: it.at };
    const i = itemAt.indexOf(it.uid);
    if (i < 0) return null;
    let j = i;
    while (itemAt[j + 1] === it.uid) j++;
    return { from: i, to: j };
  };

  // A pick that covers whole sentences shows them with their punctuation.
  const selectionIsSentence = !!selection
    && selection.from === section.sentences[section.words[selection.from].sentence].first
    && selection.to === section.sentences[section.words[selection.to].sentence].last;
  const selectionText = !selection ? '' : selectionIsSentence ? sentencesOf(selection) : rangeText(section, selection.from, selection.to);
  const selectionWords = selection ? selection.to - selection.from + 1 : 0;
  const aiNote = !useAi ? 'ساختار دستوری با هوش مصنوعی کار می‌کند؛ منبع را روی هوش مصنوعی بگذار.'
    : aiOff.current ? 'هوش مصنوعی در دسترس نیست؛ کلید را در تنظیمات بررسی کن.' : undefined;
  const preReadItems = preRead ? preRead.uids.map(uid => items.find(it => it.uid === resolve(uid))).filter((it): it is Item => !!it) : [];
  const detailPlace = detail ? placeOf(detail) : null;
  const detailKnownAs = detail ? knownMatch(detail.front, knownSet) : undefined;
  // A translation or grammar found for another pick is not shown under this one.
  const result = sentenceResult && selection && sentenceResult.range.from === selection.from && sentenceResult.range.to === selection.to ? sentenceResult : null;
  const sheetOpen = !!selection || (!!detail && !detail.loading);
  // Structures of the picked sentences, from the rules (no AI needed).
  const selectionRules = useMemo(() => {
    if (!selection) return [];
    const out: { id: string; name: string; at: number }[] = [];
    const a = section.words[selection.from].sentence;
    const b = section.words[selection.to].sentence;
    for (let n = a; n <= b; n++) {
      for (const id of grammarFound.bySentence[n] || []) {
        const rule = ruleById(id);
        if (rule && !out.some(r => r.id === id)) out.push({ id, name: rule.name, at: section.sentences[n].first });
      }
    }
    return out;
  }, [selection, section, grammarFound]);
  // The structures a looked-up word is part of.
  const detailRules = detail && detail.kind !== 'grammar' && detailPlace && detailPlace.from === detailPlace.to
    ? grammarFound.at[detailPlace.from].map(id => ruleById(id)).filter(Boolean) as { id: string; name: string }[]
    : [];

  // Parts shared by the two layouts.
  const preReadBlock = (
    <>
          {!done && !preRead && items.length === 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-brand-50 dark:bg-brand-900/30 px-4 py-3 text-sm">
              <span className="flex-1 min-w-[12rem] text-ink dark:text-slate-100">پیش از خواندن، واژه‌های سخت این بخش را یک بار ببین.</span>
              <button type="button" onClick={runPreRead} className="min-h-[40px] px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold">نشان بده</button>
              <label className="flex items-center gap-1.5 text-ink-muted dark:text-slate-300">
                <input type="checkbox" checked={!!settings.preReadAuto} onChange={e => onUpdateSettings({ preReadAuto: e.target.checked })} className="w-[18px] h-[18px] accent-brand-500" />
                همیشه
              </label>
            </div>
          )}
          {preRead && preRead.state !== 'closed' && (
            <section aria-label="پیش‌خوانی" className="rounded-2xl bg-brand-50 dark:bg-brand-900/30 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <h2 className="flex-1 font-bold text-ink dark:text-white">
                  {preRead.state === 'loading' ? 'در حال پیدا کردن واژه‌های سخت…'
                    : preReadItems.length > 0 ? `پیش از خواندن: ${fa(preReadItems.length)} واژهٔ سخت این بخش`
                    : 'پیش از خواندن: واژهٔ سخت تازه‌ای در این بخش نیست.'}
                </h2>
                {preRead.state === 'shown' && (
                  <label className="flex items-center gap-1.5 text-xs text-ink-muted dark:text-slate-300" title="پیش از هر بخش خودش نشان داده شود">
                    <input type="checkbox" checked={!!settings.preReadAuto} onChange={e => onUpdateSettings({ preReadAuto: e.target.checked })} className="w-4 h-4 accent-brand-500" />
                    همیشه
                  </label>
                )}
                {preRead.state === 'shown' && <button type="button" onClick={() => setPreRead({ state: 'closed', uids: [] })} aria-label="بستن پیش‌خوانی" className="w-9 h-9 rounded-xl flex items-center justify-center text-ink-muted hover:bg-white/70 dark:hover:bg-slate-700"><Icon.Close size={18} /></button>}
              </div>
              {preReadItems.length > 0 && (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2">
                  {preReadItems.map(it => (
                    <li key={it.uid}>
                      <button type="button" onClick={() => { setSelection(null); setSelectedUid(it.uid); }}
                        className="w-full h-full text-right rounded-xl bg-white dark:bg-slate-800 px-3 py-2 flex flex-col gap-0.5 hover:ring-2 hover:ring-brand-300">
                        <span dir="ltr" className="font-en font-bold text-ink dark:text-white text-left">{it.front}</span>
                        {it.pronunciation && <span dir="ltr" className="text-xs text-ink-muted dark:text-slate-400 text-left">{it.pronunciation}</span>}
                        <span className="text-sm text-ink dark:text-slate-200 line-clamp-2">{it.back}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
    </>
  );
  const wordList = (
          <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3">
            <div className="flex justify-between items-center gap-2">
              <h2 className="font-bold text-ink dark:text-white">{items.length > 0 ? `${fa(items.length)} واژه و عبارت` : 'واژه‌های سخت'}</h2>
              <span className="text-xs text-ink-muted dark:text-slate-400">{toSave.length > 0 ? `${fa(toSave.length)} انتخاب شده` : ''}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-muted dark:text-slate-400">منبع:</span>
              {(['ai', 'free'] as ExtractionSource[]).map(s => (
                <button key={s} type="button" onClick={() => setSource(s)} aria-pressed={source === s}
                  className={`rounded-full px-3 py-1 ${source === s ? 'bg-brand-100 text-brand-700 font-bold dark:bg-brand-900/60 dark:text-brand-200' : 'border border-slate-200 dark:border-slate-600'}`}>
                  {s === 'ai' ? 'هوش مصنوعی' : 'دیکشنری رایگان'}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => extract(12, true)} disabled={loading}
              className="min-h-[44px] rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 font-bold disabled:opacity-60">
              {loading ? 'در حال پیدا کردن…' : items.length > 0 ? 'پیدا کردن واژه‌های بیشتر' : 'پیدا کردن واژه‌های سخت این بخش'}
            </button>
            {items.length > 0 && (
              <ul className="flex flex-col gap-1 max-h-[22rem] overflow-y-auto -mx-1 px-1">
                {items.map(it => (
                  <li key={it.uid}>
                    <div className={`flex items-center gap-2 min-h-[44px] px-2.5 rounded-xl ${detail?.uid === it.uid ? 'bg-brand-50 dark:bg-brand-900/40' : ''}`}>
                      <input type="checkbox" checked={!!it.selected && !it.alreadyInDeck} disabled={it.alreadyInDeck || it.loading}
                        onChange={() => toggle(it.uid)} aria-label={`انتخاب ${it.front}`} className="w-[18px] h-[18px] accent-brand-500" />
                      <button type="button" onClick={() => { setSelection(null); setSelectedUid(it.uid); }} className="flex-1 min-w-0 flex items-center gap-2 text-right">
                        <span dir="ltr" className="font-en font-medium text-ink dark:text-white truncate">{it.front}</span>
                        {it.kind && it.kind !== 'word' && <span className="shrink-0 text-[11px] rounded-full bg-slate-100 dark:bg-slate-700 px-2">{KIND_LABEL[it.kind]}</span>}
                        {it.level && <span className="shrink-0 font-en text-[11px] rounded-full bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100 px-1.5" title="سطح واژه">{it.level}</span>}
                        <span className="flex-1" />
                        <span className="text-xs text-ink-muted dark:text-slate-400 truncate max-w-[45%]">
                          {it.loading ? 'در حال جست‌وجو…' : it.alreadyInDeck ? 'کارت دارد' : it.senseLoading ? 'معنی در همین جمله…' : it.back}
                        </span>
                      </button>
                      {!it.loading && !it.alreadyInDeck && it.kind !== 'grammar' && (
                        <button type="button" onClick={() => markKnown(it)} title="بلدم: دیگر پیشنهاد نشود" aria-label={`بلدم: ${it.front}`}
                          className="shrink-0 min-h-[32px] px-2 rounded-lg text-xs text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/40">بلدم</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
  );
  // The picked words, or the open word: a sheet over the page (book mode,
  // small screens), or a card in the side column of a wide scrolling page.
  const sheets = (floating: boolean) => {
    const wide = floating ? '' : 'xl:hidden';
    // A word with a card shows what the card says (also when the word came
    // from "find hard words", which looked it up in a dictionary).
    const ownCard = detail?.alreadyInDeck && detail.kind !== 'grammar' ? cardForTerm(cardIndex, detail.front) : undefined;
    const shown: Item | undefined = detail && ownCard ? {
      ...detail,
      front: ownCard.front,
      back: ownCard.back,
      pronunciation: ownCard.pronunciation || detail.pronunciation,
      partOfSpeech: ownCard.partOfSpeech || detail.partOfSpeech,
      definition: ownCard.definition?.length ? ownCard.definition : detail.definition,
      notes: ownCard.notes,
      collocations: ownCard.collocations?.length ? ownCard.collocations : detail.collocations,
      inContext: false,
      senseLoading: false,
    } : detail;
    if (noteDraft) return noteEditor(floating);
    if (notesOpenAt !== null && notesAt[notesOpenAt]?.length) return noteViewer(floating);
    return (
          selection ? (
            <SelectionBar
              floating={floating}
              text={selectionText}
              words={selectionWords}
              maxMeaningWords={MAX_PHRASE_WORDS}
              canGrowBack={selection.from > 0}
              canGrowForward={selection.to < section.words.length - 1}
              wholeSentence={selectionIsSentence}
              aiNote={aiNote}
              busy={busy}
              translation={result?.translation}
              structures={result?.structures}
              rules={selectionRules}
              onOpenRule={(id: string) => { const r = selectionRules.find(x => x.id === id); openRule(id, r?.at); }}
              onGrow={grow}
              onWholeSentence={() => wholeSentence(selection)}
              onMeaning={() => { const r = selection; lookUp(r.from, r.to); }}
              onGrammar={analyzeSelection}
              onTranslate={() => translateSelection()}
              extra={selectionExtra(selection, result)}
              onOpenStructure={uid => { setSelection(null); setSelectedUid(uid); }}
              onClose={() => setSelection(null)}
            />
          ) : shown && !shown.loading && (
            // Below xl the list sits under the text, so the tapped word opens
            // as a sheet at the bottom of the screen, where the reader is.
            <section aria-label="جزئیات واژه"
              className={`${sheetClass(floating)} gap-2.5`}>
              <div dir="ltr" className="flex items-baseline gap-2.5 flex-wrap">
                <span className="font-en font-bold text-2xl text-ink dark:text-white">{shown.front}</span>
                {shown.pronunciation && <span className="text-ink-muted dark:text-slate-400">{shown.pronunciation}</span>}
                {shown.level && <span className="font-en text-xs rounded-full bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100 px-2 py-0.5" title="سطح واژه">{shown.level}</span>}
                {isSpeechSupported() && shown.kind !== 'grammar' && (
                  <button type="button" onClick={() => { readAloud.pause(); speakText(shown.front, { rate: 0.9 }); }} aria-label="پخش تلفظ" className="text-brand-500 dark:text-brand-300"><Icon.Speaker size={18} /></button>
                )}
                <span className="flex-1" />
                <button type="button" onClick={() => setSelectedUid(null)} aria-label="بستن" className={`${wide} w-9 h-9 -m-1.5 rounded-xl flex items-center justify-center text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700`}><Icon.Close size={18} /></button>
              </div>
              <p className="text-ink dark:text-white">{shown.back}</p>
              {ownCard && (
                <p className="self-start text-xs rounded-full px-2.5 py-0.5 bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                  از کارت خودت · {STAGE_NAMES[masteryStage(ownCard)]}
                </p>
              )}
              {(shown.inContext || shown.senseLoading) && (
                <p className={`self-start text-xs rounded-full px-2.5 py-0.5 ${shown.inContext ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-slate-100 text-ink-muted dark:bg-slate-700 dark:text-slate-300'}`}>
                  {shown.kind === 'grammar'
                    ? (shown.inContext ? 'توضیح برای همین جمله' : 'در حال نوشتن توضیح برای همین جمله…')
                    : (shown.inContext ? 'معنی در همین جمله' : 'در حال پیدا کردن معنی در همین جمله…')}
                </p>
              )}
              {detailRules.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="text-ink-muted dark:text-slate-400">بخشی از ساختار:</span>
                  {detailRules.map(r => (
                    <button key={r.id} type="button" dir="ltr" onClick={() => openRule(r.id, detailPlace!.from)}
                      className="min-h-[32px] px-2.5 rounded-full border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 font-en text-[13px]">{r.name}</button>
                  ))}
                </div>
              )}
              {shown.grammarPattern && <p dir="ltr" className="font-mono text-sm text-rose-700 dark:text-rose-300">{shown.grammarPattern}</p>}
              {shown.definition && shown.definition[0] && <p dir="ltr" className="text-sm text-ink-muted dark:text-slate-400">{shown.definition[0]}</p>}
              {shown.collocations && shown.collocations.length > 0 && (
                <div dir="ltr" className="flex flex-wrap gap-1.5">
                  {shown.collocations.slice(0, 5).map((c, i) => (
                    <span key={i} className="rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-0.5 text-[13px]">{c.phrase}</span>
                  ))}
                </div>
              )}
              {shown.notes && <p className="text-sm text-ink dark:text-slate-200">{shown.notes}</p>}
              {shown.practicePrompt && (
                <p className="text-sm rounded-xl bg-rose-50 dark:bg-rose-900/30 text-rose-900 dark:text-rose-100 px-3 py-2">تمرین: {shown.practicePrompt}</p>
              )}
              {shown.exampleSentenceTarget?.[0] && shown.kind === 'grammar' && <p dir="ltr" className="text-sm text-ink dark:text-slate-200">{shown.exampleSentenceTarget[0]}</p>}
              {shown.sourceSentence && <p dir="ltr" className="font-read text-sm italic text-ink-muted dark:text-slate-400 border-t border-slate-100 dark:border-slate-700 pt-2">“{shown.sourceSentence}”</p>}
              {detailPlace && shown.kind !== 'grammar' && (
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" disabled={detailPlace.from === 0} onClick={() => pick({ ...detailPlace, from: detailPlace.from - 1 })}
                    className="min-h-[36px] px-3 rounded-xl text-sm bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40">+ واژهٔ قبل</button>
                  <button type="button" disabled={detailPlace.to >= section.words.length - 1} onClick={() => pick({ ...detailPlace, to: detailPlace.to + 1 })}
                    className="min-h-[36px] px-3 rounded-xl text-sm bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40">واژهٔ بعد +</button>
                  <button type="button" onClick={() => wholeSentence(detailPlace)}
                    className="min-h-[36px] px-3 rounded-xl text-sm bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600">کل جمله</button>
                  {onSaveNote && (
                    <button type="button" onClick={() => startNote(detailPlace)}
                      className="min-h-[36px] px-3 rounded-xl text-sm bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600">✎ یادداشت</button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {!shown.alreadyInDeck && (
                  <label className={`${wide} flex items-center gap-2 text-sm`}>
                    <input type="checkbox" checked={!!shown.selected} onChange={() => toggle(shown.uid)} className="w-[18px] h-[18px] accent-brand-500" />
                    کارت ساخته شود
                  </label>
                )}
                {shown.kind !== 'grammar' && (detailKnownAs
                  ? <button type="button" onClick={() => onUnmarkKnown(detailKnownAs)} className="min-h-[40px] px-3 rounded-xl text-sm border border-slate-200 dark:border-slate-600">در فهرست «بلدم» است؛ بردار</button>
                  : !shown.alreadyInDeck && <button type="button" onClick={() => markKnown(shown)} className="min-h-[40px] px-3 rounded-xl text-sm font-bold bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-200">بلدم</button>)}
                <span className="flex-1" />
                {toSave.length > 0 && (
                  <button type="button" onClick={save} disabled={saving} className={`${wide} min-h-[44px] px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold disabled:opacity-60`}>
                    {saving ? 'در حال ساخت…' : `ساخت ${fa(toSave.length)} کارت`}
                  </button>
                )}
              </div>
            </section>
          )
    );
  };

  // Book mode: the page fills the screen; the tools sit in a thin bar above
  // it and open in panels, so nothing but the text is on the page.
  const renderBook = () => {
    const chapterShare = Math.round((100 * (index + (endPage ? 1 : sectionEmpty ? 1 : (page + 1) / Math.max(1, pages)))) / Math.max(1, chunks.length));
    const sideZone = layout ? Math.max(20, (layout.roomWidth - layout.width) / 2) : 20;
    const toolButton = 'inline-flex items-center justify-center gap-1.5 min-h-[40px] min-w-[40px] px-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10';
    const pageButton = 'w-11 h-11 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-25';
    return (
      <div dir="rtl" className={`font-fa fixed inset-0 z-20 flex flex-col ${PAPER[paper].page}`}>
        <header className="shrink-0 flex items-center gap-1.5 px-2 md:px-5 h-14 border-b border-black/[0.06] dark:border-white/10">
          <button type="button" onClick={onBack} aria-label="برگشت به کتاب" title="برگشت به کتاب" className={toolButton}><Icon.Back /></button>
          <div className="flex-1 min-w-0 px-1">
            <h1 dir="auto" className="font-en font-bold text-[15px] truncate text-right">{book.title}</h1>
            <p className="text-[11px] opacity-60 truncate">{chapterCount > 1 && <><bdi dir="auto">{chapter.title}</bdi> · </>}بخش {fa(index + 1)} از {fa(chunks.length)}</p>
          </div>
          <button type="button" onClick={readFromPage} disabled={sectionEmpty || endPage} aria-label={readAloud.active ? 'مکث خواندن' : 'خواندن بلند از همین صفحه'} title="خواندن بلند"
            className={`${toolButton} ${readAloud.active ? 'text-amber-700 dark:text-amber-300' : ''} disabled:opacity-30`}>
            {readAloud.active ? <Icon.Pause size={18} /> : <Icon.Speaker size={18} />}
            <span className="hidden md:inline text-sm">{readAloud.status === 'loading' ? 'آماده کردن…' : readAloud.status === 'playing' ? 'مکث' : readAloud.status === 'paused' ? 'ادامه' : 'خواندن'}</span>
          </button>
          <button type="button" onClick={() => setPanel(panel === 'words' ? null : 'words')} aria-expanded={panel === 'words'} title="واژه‌های این بخش" className={`${toolButton} relative`}>
            <Icon.List size={18} /><span className="hidden md:inline text-sm">واژه‌ها</span>
            {(toSave.length > 0 || loading) && <span className="absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-500 text-white text-[11px] font-bold flex items-center justify-center">{loading ? '…' : fa(toSave.length)}</span>}
          </button>
          <button type="button" onClick={() => setPanel(panel === 'type' ? null : 'type')} aria-expanded={panel === 'type'} title="ظاهر صفحه" className={`${toolButton} font-en font-bold`}>Aa</button>
        </header>

        <div className="relative flex-1 min-h-0 px-5 md:px-12 py-5 md:py-8" style={{ touchAction: 'pan-y' }}
          onPointerDown={onSwipeStart} onPointerUp={onSwipeEnd} onPointerCancel={() => { swipe.current = null; }}
          onClickCapture={e => { if (swiped.current) { swiped.current = false; e.stopPropagation(); e.preventDefault(); } }}>
          <div ref={room} className="h-full w-full">
            {endPage ? (
              <section aria-label="پایان فصل" className="h-full flex flex-col items-center justify-center gap-4 text-center max-w-md mx-auto">
                <p className="text-sm opacity-60">پایان</p>
                <h2 dir="auto" className="font-read text-3xl font-bold">{chapterCount > 1 ? chapter.title : book.title}</h2>
                <p className="opacity-75">{fa(chunks.length)} بخش خوانده شد.{nextChapter ? '' : chapterCount > 1 ? ' این آخرین فصل کتاب بود.' : ''}</p>
                <div className="flex flex-col gap-2 w-full mt-2">
                  {onReviewChapter && <button type="button" onClick={onReviewChapter} className="min-h-[48px] rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-bold">مرور واژه‌های {chapterCount > 1 ? 'این فصل' : 'این متن'}</button>}
                  {nextChapter && <button type="button" onClick={nextChapter.open} className="min-h-[48px] rounded-2xl border-2 border-current/20 font-bold hover:bg-black/5 dark:hover:bg-white/10">فصل بعد: <bdi dir="auto">{nextChapter.title}</bdi></button>}
                  <button type="button" onClick={onBack} className="min-h-[44px] rounded-2xl font-bold opacity-80 hover:bg-black/5 dark:hover:bg-white/10">برگشت به کتاب</button>
                </div>
              </section>
            ) : sectionEmpty ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center opacity-70">
                <p>این بخش متنی ندارد.</p>
                <p className="text-sm">با صفحهٔ بعد ادامه بده.</p>
              </div>
            ) : layout && (
              <PageColumns layout={layout} page={page} contentRef={pageText}>
                <ReaderText section={section} selection={selection} classFor={classFor} onTap={tapWord} onSelect={pick}
                  book={{ fontSize: READER_FONT_SIZES[fontStep], justify }} />
              </PageColumns>
            )}
          </div>
          {/* The margins beside the page turn it, like the edge of a paper page. */}
          <button type="button" onClick={prevPage} disabled={atStart} aria-label="صفحهٔ قبل" tabIndex={-1}
            className="absolute inset-y-0 left-0 cursor-w-resize disabled:cursor-default" style={{ width: sideZone }} />
          <button type="button" onClick={nextPage} disabled={endPage} aria-label="صفحهٔ بعد" tabIndex={-1}
            className="absolute inset-y-0 right-0 cursor-e-resize disabled:cursor-default" style={{ width: sideZone }} />
        </div>

        <footer dir="ltr" className="shrink-0 flex items-center gap-2 px-2 md:px-5 h-14 border-t border-black/[0.06] dark:border-white/10 pb-[env(safe-area-inset-bottom)]">
          <button type="button" onClick={prevPage} disabled={atStart} aria-label="صفحهٔ قبل" className={pageButton}><Icon.Back size={22} className="rotate-180" /></button>
          <div className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className="w-full max-w-md h-1 rounded-full bg-black/10 dark:bg-white/15 overflow-hidden" role="progressbar" aria-valuenow={chapterShare} aria-valuemin={0} aria-valuemax={100} aria-label="پیشرفت در فصل">
              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${chapterShare}%` }} />
            </div>
            <span dir="rtl" className="text-xs opacity-60 flex gap-2">
              <bdi>{endPage ? 'پایان فصل' : sectionEmpty ? 'بخش خالی' : `صفحهٔ ${fa(page + 1)} از ${fa(pages)}`}</bdi>
              <span aria-hidden>·</span>
              <bdi>{`${fa(chapterShare)}٪ ${chapterCount > 1 ? 'فصل' : 'متن'}`}</bdi>
            </span>
          </div>
          <button type="button" onClick={nextPage} disabled={endPage} aria-label={!endPage && page >= pages - 1 && !done ? 'پایان این بخش و رفتن به بعدی' : 'صفحهٔ بعد'} className={pageButton}><Icon.Back size={22} /></button>
        </footer>

        {panel === 'type' && (
          <div className="fixed inset-0 z-40" onClick={() => setPanel(null)}>
            <section aria-label="ظاهر صفحه" onClick={e => e.stopPropagation()}
              className="absolute top-14 left-2 md:left-5 w-[min(22rem,calc(100vw-1rem))] max-h-[calc(100vh-5rem)] overflow-y-auto rounded-3xl bg-white dark:bg-slate-800 text-ink dark:text-slate-100 shadow-2xl ring-1 ring-black/5 p-5 flex flex-col gap-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">اندازهٔ قلم</span>
                <div dir="ltr" className="flex items-center gap-1">
                  <button type="button" onClick={() => onUpdateSettings({ readerFontSize: fontStep - 1 })} disabled={fontStep === 0} aria-label="قلم کوچک‌تر" className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 font-read text-sm disabled:opacity-40">A</button>
                  <span className="w-12 text-center font-en">{READER_FONT_SIZES[fontStep]}</span>
                  <button type="button" onClick={() => onUpdateSettings({ readerFontSize: fontStep + 1 })} disabled={fontStep === READER_FONT_SIZES.length - 1} aria-label="قلم بزرگ‌تر" className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 font-read text-xl disabled:opacity-40">A</button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="font-bold">رنگ کاغذ</span>
                <div className="flex gap-2">
                  {(Object.keys(PAPER) as Paper[]).map(p => (
                    <button key={p} type="button" onClick={() => onUpdateSettings({ readerPaper: p })} disabled={appDark && p !== 'night'} aria-pressed={paper === p}
                      className={`flex-1 flex flex-col items-center gap-1 rounded-xl p-2 ${paper === p ? 'ring-2 ring-brand-500' : 'ring-1 ring-slate-200 dark:ring-slate-600'} disabled:opacity-40`}>
                      <span className={`w-full h-8 rounded-lg ring-1 ring-black/10 ${PAPER[p].swatch}`} />
                      {PAPER[p].label}
                    </button>
                  ))}
                </div>
                {appDark && <p className="text-xs text-ink-muted dark:text-slate-400">در حالت تیرهٔ برنامه، کاغذ شب است؛ برای کرم یا سفید، ظاهر برنامه را در تنظیمات روشن کن.</p>}
              </div>
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="font-bold">تراز دو طرف (مثل کتاب چاپی)</span>
                <input type="checkbox" checked={justify} onChange={e => onUpdateSettings({ readerJustify: e.target.checked })} className="w-5 h-5 accent-brand-500" />
              </label>
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className={`font-bold px-0.5 ${GRAMMAR_MARK}`}>نشان دادن ساختارهای دستوری</span>
                <input type="checkbox" checked={showGrammar} onChange={e => onUpdateSettings({ hideGrammar: !e.target.checked })} className="w-5 h-5 accent-rose-500" />
              </label>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">صدای خواندن</span>
                <div className="flex p-1 rounded-xl bg-slate-100 dark:bg-slate-700">
                  {(['device', 'ai'] as ReadAloudVoice[]).map(v => (
                    <button key={v} type="button" aria-pressed={voice === v} onClick={() => onUpdateSettings({ readAloudVoice: v })} disabled={v === 'device' && !isSpeechSupported()}
                      className={`min-h-[32px] px-3 rounded-lg text-xs disabled:opacity-40 ${voice === v ? 'bg-white dark:bg-slate-600 shadow-sm font-bold' : 'opacity-70'}`}>
                      {v === 'device' ? 'دستگاه' : 'هوش مصنوعی'}
                    </button>
                  ))}
                </div>
              </div>
              {masteryShown.size > 0 && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted dark:text-slate-400">
                  <span>زیرخط واژه‌های کارت‌دار:</span>
                  {(['new', 'learning', 'learned'] as Mastery[]).filter(m => masteryShown.has(m)).map(m => (
                    <span key={m} className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-full ${MASTERY[m].dot}`} />{MASTERY[m].label}</span>
                  ))}
                </p>
              )}
              <p className="text-xs text-ink-muted dark:text-slate-400 leading-relaxed">
                ورق زدن: کشیدن انگشت به چپ و راست، زدن کنارهٔ صفحه، یا کلیدهای ← و →. روی واژه بزن تا معنی‌اش بیاید؛ برای عبارت، انگشت را روی واژهٔ اول نگه دار و بکش.
              </p>
              {onEditText && (
                <button type="button" onClick={() => { setPanel(null); setEditing(true); }} className="min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-600 font-bold">
                  ویرایش یا حذف متن این بخش
                </button>
              )}
              <button type="button" onClick={() => { setPanel(null); onUpdateSettings({ readerMode: 'scroll' }); }} className="min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-600 font-bold">
                خواندن به‌صورت پیوسته (اسکرول)
              </button>
            </section>
          </div>
        )}

        {panel === 'words' && (
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setPanel(null)}>
            <aside aria-label="واژه‌های این بخش" onClick={e => e.stopPropagation()}
              className="absolute inset-y-0 right-0 w-full sm:w-[25rem] overflow-y-auto bg-[#F5F6FA] dark:bg-slate-900 text-ink dark:text-slate-100 shadow-2xl p-4 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <h2 className="flex-1 font-extrabold text-lg">واژه‌های بخش {fa(index + 1)}</h2>
                <button type="button" onClick={() => setPanel(null)} aria-label="بستن" className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10"><Icon.Close size={20} /></button>
              </div>
              {preReadBlock}
              {wordList}
              {notesList}
              {toSave.length > 0 && (
                <button type="button" onClick={save} disabled={saving} className="min-h-[52px] rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold disabled:opacity-60">
                  {saving ? 'در حال ساخت…' : `ساخت ${fa(toSave.length)} کارت`}
                </button>
              )}
              {waiting > 0 && <p className="text-center text-xs text-ink-muted dark:text-slate-400">معنی {fa(waiting)} واژه در همین جمله هنوز در راه است.</p>}
              {saved && <p className="text-center text-sm text-emerald-700 dark:text-emerald-300">کارت‌ها ساخته شد و در مرور بعدی می‌آیند.</p>}
              <p className="text-xs text-ink-muted dark:text-slate-400 leading-relaxed">
                با ورق زدن از صفحهٔ آخر، این بخش تمام می‌شود (+{fa(CHUNK_COMPLETE_XP)} امتیاز{isChestSection(index) ? ' و صندوق جایزه' : ''}) و بخش بعد می‌آید.
                {!done && metAgain > 0 && <> {fa(metAgain)} واژهٔ این بخش از قبل کارت دارد؛ دیده‌شدنشان در این کتاب ثبت می‌شود.</>}
              </p>
            </aside>
          </div>
        )}

        {panel !== 'words' && sheets(true)}
        {editor}
      </div>
    );
  };

  if (bookMode) return renderBook();

  return (
    <div dir="rtl" className="font-fa flex flex-col gap-5 w-full">
      <header className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} aria-label="برگشت به مسیر" className="w-11 h-11 rounded-xl flex items-center justify-center hover:bg-white dark:hover:bg-slate-800"><Icon.Back /></button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-ink-muted dark:text-slate-400 truncate">
            {chapterCount > 1 && <><bdi dir="auto">{chapter.title}</bdi>، </>}بخش {fa(index + 1)} از {fa(chunks.length)}
          </p>
          <h1 dir="auto" className="font-en font-bold text-lg text-ink dark:text-white truncate text-right">{book.title}</h1>
        </div>
        {chunks.length <= MAX_SECTION_BUTTONS ? (
          <nav aria-label="بخش‌ها" className="flex flex-wrap gap-1.5">
            {chunks.map((_, i) => {
              const isDone = chapter.completed.includes(i);
              return (
                <button key={i} type="button" disabled={!isChunkOpen(chapter, i) && i !== index} onClick={() => onOpenChunk(i)} aria-current={i === index ? 'page' : undefined}
                  className={`w-9 h-9 rounded-[10px] text-sm font-bold ${i === index ? 'bg-brand-500 text-white ring-4 ring-brand-200 dark:ring-brand-900' : isDone ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'} disabled:opacity-50`}>
                  {fa(i + 1)}
                </button>
              );
            })}
          </nav>
        ) : (
          <nav aria-label="بخش‌ها" className="flex items-center gap-1.5">
            <button type="button" disabled={index === 0} onClick={() => onOpenChunk(index - 1)} aria-label="بخش قبلی"
              className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-white dark:bg-slate-800 disabled:opacity-40"><Icon.Back size={18} /></button>
            <select value={index} onChange={e => onOpenChunk(Number(e.target.value))} aria-label="رفتن به بخش"
              className="h-9 rounded-[10px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-2 text-sm">
              {chunks.map((_, i) => (
                <option key={i} value={i} disabled={!isChunkOpen(chapter, i) && i !== index}>
                  {chapter.completed.includes(i) ? '✓ ' : ''}بخش {fa(i + 1)}
                </option>
              ))}
            </select>
            <button type="button" disabled={!isChunkOpen(chapter, index + 1) || index + 1 >= chunks.length} onClick={() => onOpenChunk(index + 1)} aria-label="بخش بعدی"
              className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-white dark:bg-slate-800 disabled:opacity-40"><Icon.Back size={18} className="rotate-180" /></button>
          </nav>
        )}
        <button type="button" onClick={() => onUpdateSettings({ readerMode: 'book' })} title="خواندن صفحه‌به‌صفحه، مثل کتاب"
          className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl text-sm font-bold bg-white dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-slate-700">
          <Icon.Book size={16} />حالت کتاب
        </button>
        {onEditText && (
          <button type="button" onClick={() => setEditing(true)} title="درست کردن یا حذف بخشی از متن"
            className="min-h-[36px] px-3 rounded-xl text-sm font-bold bg-white dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-slate-700">
            ویرایش متن
          </button>
        )}
        {editor}
      </header>

      <div className="flex flex-wrap gap-5 items-start">
        <article className="flex-[999_1_30rem] min-w-0 bg-white dark:bg-slate-800 rounded-3xl p-5 md:p-9 flex flex-col gap-4">
          {preReadBlock}
          <div className="flex flex-wrap justify-between items-center gap-2 text-xs text-ink-muted dark:text-slate-400">
            <span>روی واژه بزن تا معنی‌اش بیاید؛ برای عبارت یا جمله، روی چند واژه بکش (در موبایل: اول انگشت را نگه دار).</span>
          </div>
          <div role="group" aria-label="خواندن بلند" className="flex flex-wrap items-center gap-2 text-sm -mt-1">
            <button type="button" onClick={readAloud.toggle}
              className={`inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl font-bold text-white ${readAloud.active ? 'bg-amber-600 hover:bg-amber-700' : 'bg-brand-500 hover:bg-brand-600'}`}>
              {readAloud.active ? <Icon.Pause size={16} /> : <Icon.Speaker size={16} />}
              {readAloud.status === 'loading' ? 'آماده کردن صدا…' : readAloud.status === 'playing' ? 'مکث' : readAloud.status === 'paused' ? 'ادامهٔ خواندن' : 'خواندن بلند'}
            </button>
            {readAloud.status !== 'idle' && (
              <button type="button" onClick={readAloud.stop} aria-label="توقف و برگشت به اول"
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600">
                <Icon.Stop size={14} />از اول
              </button>
            )}
            <div role="group" aria-label="صدای خواندن" className="flex p-1 rounded-xl bg-slate-100 dark:bg-slate-700">
              {(['device', 'ai'] as ReadAloudVoice[]).map(v => (
                <button key={v} type="button" aria-pressed={voice === v} onClick={() => onUpdateSettings({ readAloudVoice: v })}
                  disabled={v === 'device' && !isSpeechSupported()}
                  className={`min-h-[32px] px-3 rounded-lg text-xs disabled:opacity-40 ${voice === v ? 'bg-white dark:bg-slate-600 shadow-sm font-bold text-brand-700 dark:text-white' : 'text-ink-muted dark:text-slate-300'}`}>
                  {v === 'device' ? 'صدای دستگاه' : 'صدای هوش مصنوعی'}
                </button>
              ))}
            </div>
            {readAloud.status !== 'idle' && readAloud.voice !== voice && (
              <span className="text-xs text-amber-800 dark:text-amber-200">فعلاً با صدای دستگاه</span>
            )}
          </div>
          {(masteryShown.size > 0 || grammarFound.bySentence.some(ids => ids.length > 0)) && (
            <p aria-label="راهنمای رنگ‌ها" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted dark:text-slate-400 -mt-2">
              {masteryShown.size > 0 && <span>واژه‌های کارت‌دار:</span>}
              {(['new', 'learning', 'learned'] as Mastery[]).filter(m => masteryShown.has(m)).map(m => (
                <span key={m} className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-full ${MASTERY[m].dot}`} />{MASTERY[m].label}</span>
              ))}
              {grammarFound.bySentence.some(ids => ids.length > 0) && (
                <label className="inline-flex items-center gap-1.5 cursor-pointer" title="واژه‌های کمکی یک ساختار را بزن تا توضیحش بیاید">
                  <input type="checkbox" checked={showGrammar} onChange={e => onUpdateSettings({ hideGrammar: !e.target.checked })} className="w-4 h-4 accent-rose-500" />
                  <span className={`px-0.5 ${GRAMMAR_MARK}`}>ساختار دستوری</span>
                </label>
              )}
            </p>
          )}
          <ReaderText section={section} selection={selection} classFor={classFor} onTap={tapWord} onSelect={pick} paragraphFooter={paragraphFooter} />
        </article>

        <aside className="flex-[1_1_20rem] max-w-full lg:max-w-md flex flex-col gap-4 lg:sticky lg:top-6">
          {wordList}
          {notesList}
          {sheets(false)}

          <div className="flex flex-col gap-2">
            {toSave.length > 0 && (
              <button type="button" onClick={save} disabled={saving} className="min-h-[56px] rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold text-lg disabled:opacity-60">
                {saving ? 'در حال ساخت…' : `ساخت ${fa(toSave.length)} کارت`}
              </button>
            )}
            {waiting > 0 && <p className="text-center text-xs text-ink-muted dark:text-slate-400">معنی {fa(waiting)} واژه در همین جمله هنوز در راه است.</p>}
            <button type="button" onClick={finish}
              className={`min-h-[52px] rounded-2xl font-extrabold ${toSave.length === 0 ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'border-2 border-emerald-600 text-emerald-800 dark:text-emerald-200'}`}>
              {done ? 'برگشت به مسیر' : `پایان این بخش (+${fa(CHUNK_COMPLETE_XP)} امتیاز${isChestSection(index) ? ' و صندوق جایزه' : ''})`}
            </button>
            {saved && <p className="text-center text-sm text-emerald-700 dark:text-emerald-300">کارت‌ها ساخته شد و در مرور بعدی می‌آیند.</p>}
            {!done && metAgain > 0 && (
              <p className="text-center text-xs text-ink-muted dark:text-slate-400">{fa(metAgain)} واژهٔ این بخش از قبل کارت دارد (زیرخط رنگی)؛ با پایان بخش، دیده‌شدنشان در این کتاب ثبت می‌شود و کارت‌های بخش را می‌توانی مرور کنی.</p>
            )}
          </div>
          {/* Room to scroll the buttons above the word sheet on small screens. */}
          {sheetOpen && <div aria-hidden className="h-[52vh] xl:hidden" />}
        </aside>
      </div>
    </div>
  );
};

type ReaderScreenProps = Omit<ChunkReaderViewProps, 'chunks' | 'onEditText'> & {
  loadText: (chapterId: string) => Promise<ChapterText>;
  onEditChunk?: (index: number, text: string) => Promise<string[]>; // the chapter's sections after the edit
};

// The reader, once the chapter's text is here: it is kept in this browser,
// and fetched from the server the first time the chapter is opened on a new
// device.
export const ReaderScreen: React.FC<ReaderScreenProps> = ({ loadText, onEditChunk, ...props }) => {
  const chapterId = props.chapter.id;
  // Bumped when the text is edited, so the section opens afresh on it.
  const [edits, setEdits] = useState(0);
  // Where the next section opens: set by the reader as it turns pages across
  // sections; anything else (the library, the section list) resumes.
  const entry = useRef<ReaderEntry>({ kind: 'resume' });
  const openChunk = (i: number, at?: ReaderEntry) => {
    entry.current = at || { kind: 'resume' };
    props.onOpenChunk(i, at);
  };
  const complete = (then?: CompleteThen) => {
    if (then === 'next') entry.current = { kind: 'start' };
    return props.onComplete(then);
  };
  const [text, setText] = useState<{ id: string; chunks?: string[]; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadText(chapterId)
      .then(t => { if (live) setText({ id: chapterId, chunks: t.chunks }); })
      .catch(error => {
        console.error('Loading the chapter failed:', error);
        if (!live) return;
        const missing = error instanceof ProxyError && error.status === 404;
        setText({
          id: chapterId,
          error: missing
            ? 'متن این فصل هنوز روی سرور نیست. برنامه را روی دستگاهی که کتاب را افزوده باز کن تا همگام شود.'
            : 'متن این فصل نیامد. اتصال را بررسی کن و دوباره امتحان کن.',
        });
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, attempt]);

  if (!text || text.id !== chapterId) {
    return <div dir="rtl" className="font-fa py-24 text-center text-ink-muted dark:text-slate-400" role="status">در حال آوردن متن…</div>;
  }
  if (text.error || !text.chunks) {
    return (
      <div dir="rtl" className="font-fa max-w-md mx-auto py-16 flex flex-col items-center gap-4 text-center">
        <p className="text-ink dark:text-white">{text.error}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setText(null); setAttempt(a => a + 1); }} className="min-h-[44px] px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold">دوباره</button>
          <button type="button" onClick={props.onBack} className="min-h-[44px] px-5 rounded-xl bg-slate-100 dark:bg-slate-700 font-bold">برگشت</button>
        </div>
      </div>
    );
  }
  const editText = onEditChunk && (async (edited: string) => {
    const chunks = await onEditChunk(props.index, edited);
    entry.current = { kind: 'resume' };
    setText({ id: chapterId, chunks });
    setEdits(n => n + 1);
  });
  return <ChunkReaderView key={`${chapterId}-${props.index}-${edits}`} {...props} chunks={text.chunks} entry={entry.current} onOpenChunk={openChunk} onComplete={complete} onEditText={editText || undefined} />;
};
