import React, { useEffect, useMemo, useRef, useState } from 'react';
import { extractKinds, KIND_LABEL } from '../services/cardKinds';
import { Chapter, ChapterText, ExtractedWordCard, Flashcard, Settings, Source } from '../types';
import { ProxyError } from '../services/apiService';
import { aiOrigin, aiRequestOptions } from '../services/aiSettings';
import { extractFromLongText, ExtractionSource, isPermanentAiError } from '../services/extractionPipeline';
import { lemmaCandidates, tokensOf } from '../services/lemma';
import { enrichmentToCard, freeEnrich, FreeEnrichment, freeTranslate } from '../services/freeExtractionService';
import { cardsInText, isChunkOpen } from '../services/library';
import { isKnownTerm, knownMatch } from '../services/knownWords';
import { masteryStage } from '../services/masteryService';
import { phraseRanges, rangeText, readerSection, sentenceOf } from '../services/readerText';
import { analyzeSentence, grammarCards, Sense, SenseBatcher, sensesInContext } from '../services/senseService';
import { detectGrammar, ruleById } from '../services/grammarPatterns';
import { explainInSentence, ruleCard, ruleIdsWithCards } from '../services/grammarCards';
import { normalizeTerm } from '../services/vocabMerge';
import { isBelowLevel } from '../services/wordLevel';
import { isSpeechSupported, speakText, stopSpeech } from '../services/ttsService';
import { CHUNK_COMPLETE_XP, isChestSection } from '../services/xpRules';
import { fa, Icon } from './common/ui';
import { Range, ReaderText } from './reader/ReaderText';
import { SelectionBar, SelectionTask } from './reader/SelectionBar';

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
  onComplete: () => void;
  onBack: () => void;
  onOpenChunk: (index: number) => void;
  onMarkKnown: (term: string) => void;
  onUnmarkKnown: (term: string) => void;
  onUpdateSettings: (changes: Partial<Settings>) => void;
  showToast: (message: string) => void;
}

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
  onMarkKnown, onUnmarkKnown, onUpdateSettings, showToast,
}) => {
  const chunk = chunks[index] || '';
  const section = useMemo(() => readerSection(chunk), [chunk]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [selection, setSelection] = useState<Range | null>(null);
  const [busy, setBusy] = useState<SelectionTask | null>(null);
  const [sentenceResult, setSentenceResult] = useState<{ range: Range; translation?: string; structures?: { uid: string; name: string }[] } | null>(null);
  const [source, setSource] = useState<ExtractionSource>(settings.extractionSource || 'ai');
  const [loading, setLoading] = useState(false);
  const [preRead, setPreRead] = useState<{ state: 'loading' | 'shown' | 'closed'; uids: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reading, setReading] = useState(false);
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
    showToast(`هوش مصنوعی جواب نداد؛ ${what === 'sense' ? 'معنی دیکشنری ماند' : what === 'explain' ? 'توضیح عمومی برنامه ماند' : 'دوباره امتحان کن'}.${error instanceof Error && error.message ? ` ${ltr(error.message)}` : ''}`);
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
    pending.current.add(surface);
    const sentence = sentenceOf(section, from)?.text || '';
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

  const translateSelection = async () => {
    if (!selection) return;
    const range = selection;
    setBusy('translate');
    try {
      const translation = await freeTranslate(sentencesOf(range));
      if (!translation) showToast('ترجمه نیامد. کمی بعد دوباره امتحان کن.');
      else setSentenceResult(r => ({ ...(r?.range.from === range.from && r.range.to === range.to ? r : {}), range, translation }));
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
    if (settings.preReadAuto && !done) runPreRead();
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
    onComplete();
  };

  const toggleReading = () => {
    if (reading) { stopSpeech(); setReading(false); return; }
    setReading(true);
    speakText(chunk.replace(/\n+/g, ' '), { rate: 0.95, onEnd: () => setReading(false), onError: () => setReading(false) });
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
    return `${m ? MASTERY[m].underline : ''}${grammar}`;
  };

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
      </header>

      <div className="flex flex-wrap gap-5 items-start">
        <article className="flex-[999_1_30rem] min-w-0 bg-white dark:bg-slate-800 rounded-3xl p-5 md:p-9 flex flex-col gap-4">
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
          <div className="flex flex-wrap justify-between items-center gap-2 text-xs text-ink-muted dark:text-slate-400">
            <span>روی واژه بزن تا معنی‌اش بیاید؛ برای عبارت یا جمله، روی چند واژه بکش (در موبایل: اول انگشت را نگه دار).</span>
            {isSpeechSupported() && (
              <button type="button" onClick={toggleReading} className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600">
                <Icon.Speaker size={16} />{reading ? 'توقف' : 'خواندن بلند'}
              </button>
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
          <ReaderText section={section} selection={selection} classFor={classFor} onTap={tapWord} onSelect={pick} />
        </article>

        <aside className="flex-[1_1_20rem] max-w-full lg:max-w-md flex flex-col gap-4 lg:sticky lg:top-6">
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

          {selection ? (
            <SelectionBar
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
              onTranslate={translateSelection}
              onOpenStructure={uid => { setSelection(null); setSelectedUid(uid); }}
              onClose={() => setSelection(null)}
            />
          ) : detail && !detail.loading && (
            // Below xl the list sits under the text, so the tapped word opens
            // as a sheet at the bottom of the screen, where the reader is.
            <section aria-label="جزئیات واژه"
              className="fixed z-30 inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-5 md:left-6 md:right-[17.5rem] max-h-[46vh] overflow-y-auto shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 xl:static xl:max-h-none xl:shadow-none xl:ring-0 bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-2.5 animate-reveal">
              <div dir="ltr" className="flex items-baseline gap-2.5 flex-wrap">
                <span className="font-en font-bold text-2xl text-ink dark:text-white">{detail.front}</span>
                {detail.pronunciation && <span className="text-ink-muted dark:text-slate-400">{detail.pronunciation}</span>}
                {detail.level && <span className="font-en text-xs rounded-full bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100 px-2 py-0.5" title="سطح واژه">{detail.level}</span>}
                {isSpeechSupported() && detail.kind !== 'grammar' && (
                  <button type="button" onClick={() => speakText(detail.front, { rate: 0.9 })} aria-label="پخش تلفظ" className="text-brand-500 dark:text-brand-300"><Icon.Speaker size={18} /></button>
                )}
                <span className="flex-1" />
                <button type="button" onClick={() => setSelectedUid(null)} aria-label="بستن" className="xl:hidden w-9 h-9 -m-1.5 rounded-xl flex items-center justify-center text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700"><Icon.Close size={18} /></button>
              </div>
              <p className="text-ink dark:text-white">{detail.back}</p>
              {(detail.inContext || detail.senseLoading) && (
                <p className={`self-start text-xs rounded-full px-2.5 py-0.5 ${detail.inContext ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-slate-100 text-ink-muted dark:bg-slate-700 dark:text-slate-300'}`}>
                  {detail.kind === 'grammar'
                    ? (detail.inContext ? 'توضیح برای همین جمله' : 'در حال نوشتن توضیح برای همین جمله…')
                    : (detail.inContext ? 'معنی در همین جمله' : 'در حال پیدا کردن معنی در همین جمله…')}
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
              {detail.grammarPattern && <p dir="ltr" className="font-mono text-sm text-rose-700 dark:text-rose-300">{detail.grammarPattern}</p>}
              {detail.definition && detail.definition[0] && <p dir="ltr" className="text-sm text-ink-muted dark:text-slate-400">{detail.definition[0]}</p>}
              {detail.collocations && detail.collocations.length > 0 && (
                <div dir="ltr" className="flex flex-wrap gap-1.5">
                  {detail.collocations.slice(0, 5).map((c, i) => (
                    <span key={i} className="rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-0.5 text-[13px]">{c.phrase}</span>
                  ))}
                </div>
              )}
              {detail.notes && <p className="text-sm text-ink dark:text-slate-200">{detail.notes}</p>}
              {detail.practicePrompt && (
                <p className="text-sm rounded-xl bg-rose-50 dark:bg-rose-900/30 text-rose-900 dark:text-rose-100 px-3 py-2">تمرین: {detail.practicePrompt}</p>
              )}
              {detail.exampleSentenceTarget?.[0] && detail.kind === 'grammar' && <p dir="ltr" className="text-sm text-ink dark:text-slate-200">{detail.exampleSentenceTarget[0]}</p>}
              {detail.sourceSentence && <p dir="ltr" className="font-read text-sm italic text-ink-muted dark:text-slate-400 border-t border-slate-100 dark:border-slate-700 pt-2">“{detail.sourceSentence}”</p>}
              {detailPlace && detail.kind !== 'grammar' && (
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" disabled={detailPlace.from === 0} onClick={() => pick({ ...detailPlace, from: detailPlace.from - 1 })}
                    className="min-h-[36px] px-3 rounded-xl text-sm bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40">+ واژهٔ قبل</button>
                  <button type="button" disabled={detailPlace.to >= section.words.length - 1} onClick={() => pick({ ...detailPlace, to: detailPlace.to + 1 })}
                    className="min-h-[36px] px-3 rounded-xl text-sm bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40">واژهٔ بعد +</button>
                  <button type="button" onClick={() => wholeSentence(detailPlace)}
                    className="min-h-[36px] px-3 rounded-xl text-sm bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600">کل جمله</button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {!detail.alreadyInDeck && (
                  <label className="xl:hidden flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!detail.selected} onChange={() => toggle(detail.uid)} className="w-[18px] h-[18px] accent-brand-500" />
                    کارت ساخته شود
                  </label>
                )}
                {detail.kind !== 'grammar' && (detailKnownAs
                  ? <button type="button" onClick={() => onUnmarkKnown(detailKnownAs)} className="min-h-[40px] px-3 rounded-xl text-sm border border-slate-200 dark:border-slate-600">در فهرست «بلدم» است؛ بردار</button>
                  : !detail.alreadyInDeck && <button type="button" onClick={() => markKnown(detail)} className="min-h-[40px] px-3 rounded-xl text-sm font-bold bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-200">بلدم</button>)}
                <span className="flex-1" />
                {toSave.length > 0 && (
                  <button type="button" onClick={save} disabled={saving} className="xl:hidden min-h-[44px] px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold disabled:opacity-60">
                    {saving ? 'در حال ساخت…' : `ساخت ${fa(toSave.length)} کارت`}
                  </button>
                )}
              </div>
            </section>
          )}

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

type ReaderScreenProps = Omit<ChunkReaderViewProps, 'chunks'> & {
  loadText: (chapterId: string) => Promise<ChapterText>;
};

// The reader, once the chapter's text is here: it is kept in this browser,
// and fetched from the server the first time the chapter is opened on a new
// device.
export const ReaderScreen: React.FC<ReaderScreenProps> = ({ loadText, ...props }) => {
  const chapterId = props.chapter.id;
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
  return <ChunkReaderView key={`${chapterId}-${props.index}`} {...props} chunks={text.chunks} />;
};
