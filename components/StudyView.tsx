import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { KIND_LABEL } from '../services/cardKinds';
import { Flashcard } from '../types';
import type { SessionSummary, StudyMode } from '../hooks/useAppLogic';
import { calculateSrs, previewIntervals, PerformanceRating } from '../services/srsService';
import { masteryStage, stageChanges, STAGE_NAMES } from '../services/masteryService';
import { nextCombo, reviewXp } from '../services/xpRules';
import { db } from '../services/localDBService';
import { levenshtein } from '../services/stringSimilarity';
import { fetchAudioData } from '../services/dictionaryService';
import { isSpeechSupported, speakText } from '../services/ttsService';
import { dayString } from '../services/streakService';
import { CardPlace, originText } from '../services/library';
import type { AiRequestOptions } from '../services/geminiService';
import { fa, Icon, Kbd, StageDots } from './common/ui';
import { GrammarPractice } from './GrammarPractice';
import { blankOf, checkCloze, clozeFor, type ClozeResult } from '../services/cloze';
import { withEditedContent } from '../services/cardRefresh';
import { applyLeechHelp, LeechHelp, leechHelpFor, needsLeechHelp } from '../services/cardExtras';

const MODE_NAMES: Record<StudyMode, string> = { flip: 'برگرداندن', type: 'نوشتنی', cloze: 'جای خالی' };

const RATINGS: { rating: PerformanceRating; label: string; key: string; className: string }[] = [
  { rating: 'AGAIN', label: 'دوباره', key: '1', className: 'bg-red-100 text-red-900 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-100' },
  { rating: 'HARD', label: 'سخت', key: '2', className: 'bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-100' },
  { rating: 'GOOD', label: 'خوب', key: '3', className: 'bg-sky-100 text-sky-900 hover:bg-sky-200 dark:bg-sky-900/50 dark:text-sky-100' },
  { rating: 'EASY', label: 'آسان', key: '4', className: 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-100' },
];

// "1 روز", "3 ماه": when the card comes back for each answer.
const intervalLabel = (days: number): string => {
  if (days < 30) return `${fa(days)} روز`;
  if (days < 365) return `${fa(Math.round(days / 30))} ماه`;
  return `${fa(Math.round((days / 365) * 10) / 10)} سال`;
};

interface StudyViewProps {
  cards: Flashcard[];
  initialMode: StudyMode;
  streak: number;
  studiedToday: boolean;
  goal: { progress: number; target: number };
  onExit: (updatedCards: Flashcard[], summary: SessionSummary, next?: 'home' | 'more') => void;
  places?: Map<string, CardPlace[]>; // where each card was met while reading
  sourceId?: string | null; // a review of one book: its sentences come first
  aiOptions?: AiRequestOptions; // checks sentences written for grammar cards
  onEditCard?: (card: Flashcard, onDone: (saved: Flashcard | null) => void) => void; // the card form over the session
  onSaveCard?: (card: Flashcard) => Promise<Flashcard>; // a changed card's content (a stubborn card's new memory aid)
}

// Reads a word, phrase or sentence aloud with the browser's speech synthesis.
const SpeakButton: React.FC<{ text: string; size?: number }> = ({ text, size = 16 }) => {
  if (!isSpeechSupported() || !text.trim()) return null;
  return (
    <button type="button" onClick={e => { e.stopPropagation(); speakText(text, { rate: 0.95 }); }} aria-label={`گوش دادن: ${text}`}
      className="shrink-0 p-1 rounded-full text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-slate-700">
      <Icon.Speaker size={size} />
    </button>
  );
};

const asList = (v: string[] | string | undefined): string[] => (Array.isArray(v) ? v : v ? [String(v)] : []);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-4 flex flex-col gap-2 min-w-0">
    <p dir="rtl" className="text-xs text-ink-muted dark:text-slate-400">{title}</p>
    {children}
  </div>
);

const MAX_PLACES = 3;

// The books and articles a card's term was met in, with the sentences.
const Places: React.FC<{ places: CardPlace[] }> = ({ places }) => {
  const sourceCount = new Set(places.map(p => p.sourceId)).size;
  return (
    <Section title={sourceCount > 1 ? `دیده‌شده در ${fa(sourceCount)} کتاب و متن` : 'دیده‌شده در'}>
      <ul className="flex flex-col gap-2.5">
        {places.slice(0, MAX_PLACES).map((p, i) => (
          <li key={i} className="flex flex-col gap-0.5 min-w-0">
            <p dir="rtl" className="text-xs font-bold text-ink dark:text-slate-200 truncate">
              <bdi dir="auto" className="font-en">{p.sourceTitle}</bdi>
              {p.chapterTitle && <> · <bdi dir="auto" className="font-en font-normal">{p.chapterTitle}</bdi></>}
            </p>
            {p.sentence && (
              <p dir="ltr" className="flex items-start gap-1 text-[15px] leading-7 text-slate-700 dark:text-slate-200">
                <span className="flex-1">{p.sentence}</span><SpeakButton text={p.sentence} />
              </p>
            )}
          </li>
        ))}
      </ul>
      {places.length > MAX_PLACES && <p dir="rtl" className="text-xs text-ink-muted dark:text-slate-400">و {fa(places.length - MAX_PLACES)} جای دیگر</p>}
    </Section>
  );
};

// The answer side: meaning, sentences, expressions and notes.
const CardAnswer: React.FC<{ card: Flashcard; places?: CardPlace[] }> = ({ card, places = [] }) => {
  const definitions = asList(card.definition);
  const examples = asList(card.exampleSentenceTarget);
  const sentenceInPlaces = !!card.sourceSentence && places.some(p => p.sentence?.trim() === card.sourceSentence!.trim());
  const madeBy = originText(card.origin);
  return (
    <div className="flex flex-col gap-4 animate-reveal">
      <div className="h-px bg-slate-200 dark:bg-slate-700" />
      <p dir="rtl" className="text-2xl md:text-3xl font-extrabold text-center text-ink dark:text-white break-words">{card.back}</p>
      {card.register && <p dir="rtl" className="-mt-2 text-sm text-center text-ink-muted dark:text-slate-400">{card.register}</p>}
      {card.commonMistake && (
        <div dir="rtl" role="note" className="flex items-start gap-2 rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-950 dark:text-amber-100 p-4 text-sm leading-7">
          <span aria-hidden="true" className="shrink-0 font-extrabold">!</span>
          <p className="min-w-0"><span className="font-bold">اشتباه رایج: </span>{card.commonMistake}</p>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {places.length > 0 && <Places places={places} />}
        {card.sourceSentence && !sentenceInPlaces && (
          <Section title="در متن خودت">
            <p dir="ltr" className="flex items-start gap-1 text-[15px] leading-7 text-slate-700 dark:text-slate-200">
              <span className="flex-1">{card.sourceSentence}</span><SpeakButton text={card.sourceSentence} />
            </p>
          </Section>
        )}
        {card.collocations && card.collocations.length > 0 && (
          <Section title="ترکیب‌های رایج">
            <ul dir="ltr" className="flex flex-col gap-1">
              {card.collocations.map((c, i) => (
                <li key={i} className="flex items-center gap-1.5 text-sm">
                  <SpeakButton text={c.phrase} size={14} />
                  <span className="font-medium text-slate-800 dark:text-slate-100">{c.phrase}</span>
                  {c.meaning && <span dir="rtl" className="text-ink-muted dark:text-slate-400">{c.meaning}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {card.synonyms && card.synonyms.length > 0 && (
          <Section title="هم‌معنی‌ها و فرقشان">
            <ul dir="ltr" className="flex flex-col gap-1">
              {card.synonyms.map((syn, i) => (
                <li key={i} className="flex items-start flex-wrap gap-x-1.5 text-sm">
                  <SpeakButton text={syn.word} size={14} />
                  <span className="font-medium text-slate-800 dark:text-slate-100 pt-0.5">{syn.word}</span>
                  {syn.note && <span dir="rtl" className="text-ink-muted dark:text-slate-400 pt-0.5">{syn.note}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {((card.wordFamily && card.wordFamily.length > 0) || card.wordRoot) && (
          <Section title="خانوادهٔ واژه">
            {card.wordFamily && card.wordFamily.length > 0 && (
              <ul dir="ltr" className="flex flex-col gap-1">
                {card.wordFamily.map((m, i) => (
                  <li key={i} className="flex items-center flex-wrap gap-x-1.5 text-sm">
                    <SpeakButton text={m.word} size={14} />
                    <span className="font-medium text-slate-800 dark:text-slate-100">{m.word}</span>
                    {m.partOfSpeech && <span className="text-xs text-ink-muted dark:text-slate-400">{m.partOfSpeech}</span>}
                    {m.meaning && <span dir="rtl" className="text-ink-muted dark:text-slate-400">{m.meaning}</span>}
                  </li>
                ))}
              </ul>
            )}
            {card.wordRoot && <p dir="rtl" className="text-sm text-slate-700 dark:text-slate-200">{card.wordRoot}</p>}
          </Section>
        )}
        {definitions.length > 0 && (
          <Section title="تعریف">
            <ol dir="ltr" className="list-decimal list-inside text-sm flex flex-col gap-1 text-slate-700 dark:text-slate-200">
              {definitions.map((d, i) => <li key={i}>{d}</li>)}
            </ol>
          </Section>
        )}
        {examples.length > 0 && (
          <Section title="مثال">
            <ul dir="ltr" className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
              {examples.map((ex, i) => <li key={i} className="flex items-start gap-1"><span className="flex-1 italic">{ex}</span><SpeakButton text={ex} size={14} /></li>)}
            </ul>
          </Section>
        )}
        {card.notes && (
          <Section title="یادداشت">
            <p dir="auto" className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-line">{card.notes}</p>
          </Section>
        )}
      </div>
      {madeBy && <p dir="rtl" className="text-xs text-center text-ink-muted dark:text-slate-400">سازنده: <bdi dir="auto">{madeBy}</bdi></p>}
    </div>
  );
};

// A card forgotten again and again: a new way to remember it, made on
// request and kept only if the user wants it.
const LeechPanel: React.FC<{ card: Flashcard; aiOptions?: AiRequestOptions; onDone: (help: LeechHelp | null) => Promise<void> }> = ({ card, aiOptions, onDone }) => {
  const [state, setState] = useState<'ask' | 'busy' | 'shown' | 'saving'>('ask');
  const [help, setHelp] = useState<LeechHelp | null>(null);
  const [error, setError] = useState('');
  const make = async () => {
    setState('busy');
    setError('');
    try {
      setHelp(await leechHelpFor(card, aiOptions));
      setState('shown');
    } catch (e) {
      console.error('Making a fresh memory aid failed:', e);
      setError('هوش مصنوعی جواب نداد. بعداً دوباره امتحان کن.');
      setState('ask');
    }
  };
  const finish = async (keep: boolean) => {
    const before = state;
    setState('saving');
    try {
      await onDone(keep ? help : null);
    } catch {
      setError('ذخیره نشد. دوباره امتحان کن.');
      setState(before);
    }
  };
  const button = 'min-h-[44px] px-4 rounded-xl text-sm font-bold';
  return (
    <section dir="rtl" aria-label="کارت سمج" className="rounded-2xl border-2 border-rose-200 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/30 p-4 flex flex-col gap-3">
      <p className="text-sm text-ink dark:text-slate-100">
        <span className="font-bold">کارت سمج: </span>
        این کارت را {fa(card.lapses || 0)} بار فراموش کرده‌ای. شاید یادیار فعلی به کارت نمی‌آید.
      </p>
      {state === 'shown' || (state === 'saving' && help) ? (
        <div className="flex flex-col gap-2 rounded-xl bg-white dark:bg-slate-800 p-3 text-sm leading-7">
          {help!.why && <p className="text-ink-muted dark:text-slate-400">{help!.why}</p>}
          {help!.mnemonic && <p className="font-medium text-ink dark:text-white">{help!.mnemonic}</p>}
          {help!.example && (
            <p dir="ltr" className="flex items-start gap-1 italic text-slate-700 dark:text-slate-200"><span className="flex-1">{help!.example}</span><SpeakButton text={help!.example} size={14} /></p>
          )}
          {help!.exampleMeaning && <p className="text-ink-muted dark:text-slate-400">{help!.exampleMeaning}</p>}
        </div>
      ) : null}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        {state === 'shown' || (state === 'saving' && help) ? (
          <>
            <button type="button" disabled={state === 'saving'} onClick={() => finish(false)} className={`${button} text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-white dark:hover:bg-slate-700`}>نه، همان قبلی</button>
            <button type="button" disabled={state === 'saving'} onClick={() => finish(true)} className={`${button} text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-50`}>گذاشتن در کارت</button>
          </>
        ) : (
          <>
            <button type="button" disabled={state !== 'ask'} onClick={() => finish(false)} className={`${button} text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-white dark:hover:bg-slate-700`}>لازم نیست</button>
            <button type="button" disabled={state !== 'ask'} onClick={make} className={`${button} text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50`}>
              {state === 'busy' ? 'در حال ساختن…' : 'یادیار و مثال تازه بساز'}
            </button>
          </>
        )}
      </div>
    </section>
  );
};

const Confetti: React.FC = () => {
  const pieces = useMemo(() => Array.from({ length: 28 }, (_, i) => ({
    left: `${(i * 37) % 100}%`,
    delay: `${(i % 7) * 0.12}s`,
    color: ['#FFC857', '#6CC18E', '#A9C7F5', '#F28B82', '#FFFFFF'][i % 5],
    shape: i % 3 === 0 ? 'rounded-full' : '',
  })), []);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <span key={i} className={`absolute top-0 w-2 h-3 animate-fall ${p.shape}`} style={{ left: p.left, animationDelay: p.delay, background: p.color }} />
      ))}
    </div>
  );
};

interface Snapshot {
  queue: Flashcard[];
  index: number;
  updated: Map<string, Flashcard>;
  combo: number;
  xp: number;
  reviews: number;
  firstAnswers: Map<string, boolean>;
  logId?: number;
  card?: Flashcard; // the card as it was before this answer
}

export const StudyView: React.FC<StudyViewProps> = ({ cards, initialMode, streak, studiedToday, goal, onExit, places, sourceId, aiOptions, onEditCard, onSaveCard }) => {
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [updated, setUpdated] = useState<Map<string, Flashcard>>(new Map());
  const [done, setDone] = useState(false);
  const [mode, setMode] = useState<StudyMode>(initialMode);
  const [typed, setTyped] = useState('');
  const [answerState, setAnswerState] = useState<'correct' | 'incorrect' | null>(null);
  const [combo, setCombo] = useState(0);
  const [xp, setXp] = useState(0);
  const [reviews, setReviews] = useState(0);
  const [firstAnswers, setFirstAnswers] = useState<Map<string, boolean>>(new Map());
  const [gain, setGain] = useState<{ value: number; id: number } | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [audioBusy, setAudioBusy] = useState(false);
  const [suggested, setSuggested] = useState<PerformanceRating | undefined>(undefined);
  const [clozeResult, setClozeResult] = useState<ClozeResult | null>(null);
  const [editing, setEditing] = useState(false);
  const startedAt = useRef(Date.now());
  const busy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQueue(cards);
    setIndex(0);
    setRevealed(false);
    setDone(cards.length === 0);
    startedAt.current = Date.now();
  }, [cards]);

  const card = queue[index];
  const current = card ? updated.get(card.id) || card : undefined;
  // The gap sentence for this card: where it was met in books, else its own
  // sentence. A card without one is asked as in "type" mode.
  const cloze = useMemo(() => {
    if (mode !== 'cloze' || !card) return null;
    const met = places?.get(card.id) || [];
    const ordered = sourceId ? [...met.filter(p => p.sourceId === sourceId), ...met.filter(p => p.sourceId !== sourceId)] : met;
    return clozeFor(card, ordered.map(p => p.sentence));
  }, [mode, card, places, sourceId]);
  const cardMode: StudyMode = mode === 'cloze' && !cloze ? 'type' : mode;
  const intervals = useMemo(() => (current ? previewIntervals(current) : null), [current]);

  useEffect(() => {
    if (cardMode !== 'flip' && !revealed) inputRef.current?.focus();
  }, [index, cardMode, revealed]);

  const summary = (): SessionSummary => ({ xp, reviews });
  const finish = (next: 'home' | 'more') => onExit(Array.from(updated.values()), summary(), next);
  const exitEarly = () => (reviews > 0 ? setDone(true) : onExit([], { xp: 0, reviews: 0 }, 'home'));

  const playAudio = useCallback(async () => {
    if (!card || audioBusy) return;
    if (!card.audioSrc) {
      speakText(card.front, { rate: 0.9 });
      return;
    }
    setAudioBusy(true);
    try {
      // Audio saved inside the card (data:/blob:) plays as is; links go through the server.
      const src = /^(data|blob):/.test(card.audioSrc) ? card.audioSrc : await fetchAudioData(card.audioSrc);
      const audio = new Audio(src);
      audio.onended = () => setAudioBusy(false);
      await audio.play();
    } catch (error) {
      console.error('Failed to play audio:', error);
      speakText(card.front, { rate: 0.9 });
      setAudioBusy(false);
    }
  }, [card, audioBusy]);

  const rate = async (rating: PerformanceRating) => {
    if (!card || !current || busy.current) return;
    busy.current = true;
    const snapshot: Snapshot = { queue, index, updated, combo, xp, reviews, firstAnswers };

    const next = { ...calculateSrs(current, rating), updatedAt: new Date().toISOString() };
    // Saved at once, so closing the app mid-session keeps every answer. The
    // new schedule goes over the stored card, so content filled meanwhile stays.
    const logId = await db.transaction('rw', db.studyHistory, db.flashcards, async () => {
      const stored = await db.flashcards.get(card.id);
      await db.flashcards.put(stored ? { ...withEditedContent(next, stored), updatedAt: next.updatedAt } : next);
      return await db.studyHistory.add({ uid: crypto.randomUUID(), cardId: card.id, date: dayString(new Date()), rating }) as number;
    });
    const gained = reviewXp(rating, combo);

    setHistory(h => [...h.slice(-20), { ...snapshot, logId, card: current }]);
    setUpdated(prev => new Map(prev).set(next.id, next));
    setCombo(nextCombo(rating, combo));
    setXp(v => v + gained);
    setReviews(v => v + 1);
    setGain({ value: gained, id: Date.now() });
    if (!firstAnswers.has(card.id)) setFirstAnswers(prev => new Map(prev).set(card.id, rating !== 'AGAIN'));

    let nextQueue = queue;
    if (rating === 'AGAIN') {
      nextQueue = [...queue];
      nextQueue.splice(Math.min(index + 5, nextQueue.length), 0, next);
      setQueue(nextQueue);
    }
    setRevealed(false);
    setTyped('');
    setAnswerState(null);
    setSuggested(undefined);
    setClozeResult(null);
    if (index + 1 < nextQueue.length) setIndex(index + 1);
    else setDone(true);
    busy.current = false;
  };

  const undo = async () => {
    const last = history[history.length - 1];
    if (!last || busy.current) return;
    await db.transaction('rw', db.studyHistory, db.flashcards, async () => {
      if (last.logId !== undefined) await db.studyHistory.delete(last.logId);
      if (last.card) {
        const stored = await db.flashcards.get(last.card.id);
        await db.flashcards.put({ ...(stored ? withEditedContent(last.card, stored) : last.card), updatedAt: new Date().toISOString() });
      }
    });
    setHistory(h => h.slice(0, -1));
    setQueue(last.queue);
    setIndex(last.index);
    setUpdated(last.updated);
    setCombo(last.combo);
    setXp(last.xp);
    setReviews(last.reviews);
    setFirstAnswers(last.firstAnswers);
    setRevealed(true);
    setSuggested(undefined);
    setClozeResult(null);
    setDone(false);
  };

  const checkTyped = () => {
    if (!card) return;
    if (cardMode === 'cloze' && cloze) {
      const result = checkCloze(typed, cloze, card.front);
      setClozeResult(result);
      setAnswerState(result === 'correct' ? 'correct' : 'incorrect');
      setSuggested(result === 'correct' ? 'GOOD' : result === 'close' ? 'HARD' : 'AGAIN');
      setRevealed(true);
      return;
    }
    const ok = levenshtein(typed.toLowerCase().trim(), card.back.toLowerCase().trim()) <= 2; // small typos allowed
    setAnswerState(ok ? 'correct' : 'incorrect');
    setRevealed(true);
  };

  // The card form opens over the session; what is saved shows at once and
  // the session goes on where it was.
  const editCard = () => {
    if (!current || !onEditCard || editing) return;
    setEditing(true);
    onEditCard(current, saved => {
      setEditing(false);
      if (saved) showSaved(saved);
    });
  };

  // A card's new content on every copy the session holds.
  const showSaved = (saved: Flashcard) => {
    const patch = (c: Flashcard) => withEditedContent(c, saved);
    const patchMap = (m: Map<string, Flashcard>) => new Map(Array.from(m, ([id, c]) => [id, patch(c)] as [string, Flashcard]));
    setQueue(q => q.map(patch));
    setUpdated(prev => (prev.has(saved.id) ? patchMap(prev) : prev));
    setHistory(h => h.map(snap => ({ ...snap, queue: snap.queue.map(patch), updated: patchMap(snap.updated), ...(snap.card ? { card: patch(snap.card) } : {}) })));
  };

  const finishLeech = async (help: LeechHelp | null) => {
    if (!current || !onSaveCard) return;
    showSaved(await onSaveCard(applyLeechHelp(current, help)));
  };

  const switchMode = (m: StudyMode) => { setMode(m); setRevealed(false); setAnswerState(null); setClozeResult(null); setSuggested(undefined); setTyped(''); };

  // Keyboard: Space/Enter shows the answer, 1-4 rate, P plays, Z undoes, Esc leaves.
  useEffect(() => {
    if (done) return;
    // Keys are matched by position (e.code), so they also work while the
    // Persian keyboard layout is on; Ctrl/Cmd/Alt combinations stay the browser's.
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (editing) return; // the card form is open over the session
      const typing = (e.target as HTMLElement).closest('input, textarea');
      if (e.key === 'Escape') { exitEarly(); return; }
      if (typing && !revealed) return;
      if (!revealed && (e.code === 'Space' || e.key === 'Enter') && cardMode === 'flip') { e.preventDefault(); setRevealed(true); return; }
      if (revealed) {
        const digit = /^(?:Digit|Numpad)([1-4])$/.exec(e.code)?.[1];
        const r = RATINGS.find(x => x.key === digit);
        if (r) { e.preventDefault(); rate(r.rating); return; }
      }
      if (e.code === 'KeyP') { playAudio(); return; }
      if (e.code === 'KeyZ') { undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (done) {
    const correct = Array.from(firstAnswers.values()).filter(Boolean).length;
    const accuracy = firstAnswers.size > 0 ? Math.round((correct / firstAnswers.size) * 100) : 0;
    const minutes = Math.max(1, Math.round((Date.now() - startedAt.current) / 60000));
    const grown = stageChanges(cards, Array.from(updated.values()));
    const goalReached = goal.progress < goal.target && goal.progress + reviews >= goal.target;
    const goalLeft = Math.max(0, goal.target - goal.progress - reviews);
    const streakNow = reviews > 0 && !studiedToday ? streak + 1 : streak;
    return (
      <div dir="rtl" className="font-fa relative overflow-hidden max-w-xl mx-auto w-full bg-ink text-white rounded-[28px] p-6 md:p-8 flex flex-col gap-5">
        {goalReached && <Confetti />}
        <div className="flex flex-col items-center gap-2 text-center pt-2 animate-pop">
          <span className="w-20 h-20 rounded-[26px] bg-flame-500 flex items-center justify-center"><Icon.Flame size={46} /></span>
          <h2 className="text-2xl md:text-3xl font-extrabold">{streakNow > 1 ? `زنجیرهٔ ${fa(streakNow)} روزه` : 'آفرین، شروع شد'}</h2>
          <p className="text-slate-300">
            {goalReached ? 'هدف امروز کامل شد.' : goalLeft > 0 ? `${fa(goalLeft)} مرور دیگر تا هدف امروز.` : 'هدف امروز را قبلاً زده بودی.'}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2.5 text-center">
          <div className="bg-ink-soft rounded-2xl py-3"><p className="text-2xl font-extrabold text-amber-300">+{fa(xp)}</p><p className="text-xs text-slate-300">امتیاز</p></div>
          <div className="bg-ink-soft rounded-2xl py-3"><p className="text-2xl font-extrabold">{fa(accuracy)}٪</p><p className="text-xs text-slate-300">دقت بار اول</p></div>
          <div className="bg-ink-soft rounded-2xl py-3"><p className="text-2xl font-extrabold">{fa(minutes)}</p><p className="text-xs text-slate-300">دقیقه</p></div>
        </div>
        {grown.length > 0 && (
          <div className="bg-ink-soft rounded-2xl p-4 flex flex-col gap-2.5">
            <h3 className="font-bold">{fa(grown.length)} واژه بزرگ‌تر شد</h3>
            {grown.slice(0, 6).map(g => (
              <div key={g.card.id} className="flex justify-between items-center gap-3">
                <span dir="ltr" className="font-en truncate">{g.card.front}</span>
                <span className="text-sm text-emerald-200 whitespace-nowrap">{STAGE_NAMES[g.from]} ← {STAGE_NAMES[g.to]}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2 pt-2">
          <button type="button" onClick={() => finish('more')} className="min-h-[56px] rounded-2xl bg-white text-ink font-extrabold text-lg hover:bg-brand-50">۱۰ کارت دیگر</button>
          <button type="button" onClick={() => finish('home')} className="min-h-[48px] rounded-2xl font-bold hover:bg-white/10">برگشت به خانه</button>
          {history.length > 0 && (
            <button type="button" onClick={undo} className="text-sm text-slate-300 hover:text-white">واگرد آخرین امتیاز</button>
          )}
        </div>
      </div>
    );
  }

  if (!card || !current || !intervals) {
    return <p dir="rtl" className="font-fa text-center py-20 text-ink-muted">در حال آماده‌سازی…</p>;
  }

  const stage = masteryStage(current);
  const progress = Math.round((index / queue.length) * 100);

  return (
    <div dir="rtl" className="font-fa flex flex-col min-h-[calc(100vh-2rem)] md:min-h-screen">
      <header className="flex items-center gap-2 md:gap-4 px-1 md:px-8 py-3 md:py-4 md:bg-white md:dark:bg-slate-900 md:border-b border-slate-200 dark:border-slate-800">
        <button type="button" onClick={exitEarly} aria-label="خروج از جلسه" className="flex items-center gap-1.5 min-h-[44px] min-w-[44px] px-2 rounded-xl text-ink-muted hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
          <Icon.Close size={20} /><span className="hidden md:inline text-sm">خروج</span><Kbd>Esc</Kbd>
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <div className="flex-1 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden flex">
            <div className="bg-brand-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-sm text-ink-muted dark:text-slate-400 whitespace-nowrap">{fa(index + 1)} از {fa(queue.length)}</span>
        </div>
        <div role="group" aria-label="حالت مرور" className="hidden sm:flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
          {(['flip', 'type', 'cloze'] as StudyMode[]).map(m => (
            <button key={m} type="button" onClick={() => switchMode(m)} aria-pressed={mode === m}
              className={`min-h-[36px] px-3.5 rounded-lg text-sm ${mode === m ? 'bg-white dark:bg-slate-700 font-bold shadow-sm' : 'text-ink-muted dark:text-slate-400'}`}>
              {MODE_NAMES[m]}
            </button>
          ))}
        </div>
        <span title="جواب‌های درست پشت سر هم" className={`relative shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 sm:px-3 py-1.5 text-sm font-extrabold ${combo >= 3 ? 'bg-flame-50 text-flame-800 dark:bg-orange-900/40 dark:text-orange-200' : 'bg-slate-100 text-ink-muted dark:bg-slate-800 dark:text-slate-400'}`}>
          <Icon.Bolt className={combo >= 3 ? 'text-flame-500' : ''} />{fa(combo)}<span className="hidden sm:inline"> پیاپی</span>
        </span>
        <span title="امتیاز این جلسه" className="relative shrink-0 inline-flex rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200 px-3 py-1.5 text-sm font-extrabold">
          +{fa(xp)}<span className="hidden sm:inline">&nbsp;امتیاز</span>
          {gain && <span key={gain.id} className="absolute -top-1 left-1/2 -translate-x-1/2 text-brand-500 font-extrabold animate-rise">+{fa(gain.value)}</span>}
        </span>
      </header>

      <div className="flex-1 flex flex-wrap items-start justify-center gap-6 py-4 md:p-8">
        <section className="flex-[999_1_34rem] max-w-3xl min-w-0 bg-white dark:bg-slate-800 rounded-[28px] shadow-[0_10px_30px_rgba(23,26,51,0.08)] p-5 md:p-8 flex flex-col gap-5">
          <div className="flex justify-between items-center gap-2 text-xs text-ink-muted dark:text-slate-400">
            <span className="flex items-center gap-2"><StageDots stage={stage} />{STAGE_NAMES[stage]}</span>
            <span className="flex items-center gap-2">
              {card.kind && card.kind !== 'word' && <span>{KIND_LABEL[card.kind]}</span>}
              {revealed && onEditCard && (
                <button type="button" onClick={editCard} aria-label={`ویرایش کارت ${card.front}`} title="اگر اطلاعات کارت درست نیست، ویرایشش کن یا از منبع دیگری بپرس"
                  className="min-h-[36px] px-3 rounded-lg text-xs font-bold text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-slate-700">ویرایش کارت</button>
              )}
            </span>
          </div>

          {cardMode === 'cloze' && cloze && (
            <div className="flex flex-col items-center gap-3 text-center pt-2">
              <p dir="ltr" className="font-read text-xl md:text-2xl leading-relaxed text-ink dark:text-white max-w-2xl">
                {cloze.before}
                {revealed
                  ? <mark className={`rounded px-1 font-bold ${clozeResult === 'correct' ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100' : 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100'}`}>{cloze.answer}</mark>
                  : <span aria-label="جای خالی" className="font-mono tracking-[0.2em] text-brand-600 dark:text-brand-300 border-b-2 border-brand-400 px-1">{blankOf(cloze.answer)}</span>}
                {cloze.after}
              </p>
              {!revealed && <p className="text-lg text-ink-muted dark:text-slate-300">{card.back}</p>}
            </div>
          )}

          <div dir="ltr" className={`flex flex-col items-center gap-2 text-center pt-2 ${cardMode === 'cloze' && !revealed ? 'hidden' : ''}`}>
            <h2 className="font-en font-bold text-4xl md:text-6xl tracking-tight text-ink dark:text-white break-words max-w-full">{card.front}</h2>
            <div className="flex items-center gap-3 text-ink-muted dark:text-slate-400">
              {(card.pronunciation || card.partOfSpeech) && <span>{[card.pronunciation, card.partOfSpeech].filter(Boolean).join(' · ')}</span>}
              {card.kind !== 'grammar' && (card.audioSrc || isSpeechSupported()) && (
                <button type="button" onClick={playAudio} disabled={audioBusy} aria-label="پخش تلفظ"
                  className="w-11 h-11 rounded-full bg-brand-100 text-brand-500 dark:bg-brand-900/60 dark:text-brand-200 flex items-center justify-center disabled:opacity-50">
                  <Icon.Speaker size={20} />
                </button>
              )}
            </div>
            {card.kind === 'grammar' && (
              <div className="flex flex-col gap-2 mt-1">
                {card.grammarPattern && <p className="font-mono text-rose-700 dark:text-rose-300">{card.grammarPattern}</p>}
                {card.practicePrompt && <p dir="rtl" className="text-sm text-slate-600 dark:text-slate-300">{card.practicePrompt}</p>}
              </div>
            )}
            {!revealed && cardMode !== 'cloze' && card.kind !== 'grammar' && card.sourceSentence && (
              <p className="mt-1 max-w-xl text-sm italic text-ink-muted dark:text-slate-400 line-clamp-3">{card.sourceSentence}</p>
            )}
          </div>

          {card.kind === 'grammar' && (
            <GrammarPractice key={`${card.id}-${index}`} card={card} revealed={revealed} aiOptions={aiOptions} onReveal={() => setRevealed(true)} onSuggest={setSuggested} />
          )}

          {revealed ? (
            <>
              {answerState && (
                <p className={`text-center font-bold ${answerState === 'correct' ? 'text-emerald-700 dark:text-emerald-300' : clozeResult === 'close' ? 'text-amber-800 dark:text-amber-200' : 'text-red-700 dark:text-red-300'}`}>
                  {answerState === 'correct' ? 'درست نوشتی.'
                    : clozeResult === 'close' ? <>نزدیک بود: <bdi dir="ltr" className="font-en">{typed}</bdi></>
                    : <>نوشتی: «<bdi dir="auto">{typed}</bdi>»</>}
                </p>
              )}
              <CardAnswer card={card} places={places?.get(card.id)} />
              {current && onSaveCard && needsLeechHelp(current) && (
                <LeechPanel key={current.id} card={current} aiOptions={aiOptions} onDone={finishLeech} />
              )}
            </>
          ) : card.kind === 'grammar' ? null : cardMode === 'flip' ? (
            <button type="button" onClick={() => setRevealed(true)}
              className="self-center inline-flex items-center gap-2 min-h-[56px] px-10 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold text-lg">
              نمایش پاسخ <Kbd className="text-white">Space</Kbd>
            </button>
          ) : (
            <form onSubmit={e => { e.preventDefault(); checkTyped(); }} className="flex flex-col items-center gap-3 w-full max-w-md self-center">
              <label htmlFor="typed-answer" className="text-sm text-ink-muted dark:text-slate-400">
                {cardMode === 'cloze' ? 'واژهٔ جاافتاده را همان‌طور که در جمله می‌آید بنویس' : mode === 'cloze' ? 'این کارت جملهٔ مناسبی ندارد؛ معنی فارسی را بنویس' : 'معنی فارسی را بنویس'}
              </label>
              <input id="typed-answer" ref={inputRef} dir={cardMode === 'cloze' ? 'ltr' : 'rtl'} value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off"
                autoCapitalize="off" spellCheck={false}
                className={`w-full text-center text-lg px-4 py-3 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-brand-500 focus:outline-none ${cardMode === 'cloze' ? 'font-en' : ''}`} />
              <button type="submit" className="min-h-[52px] px-10 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold">بررسی</button>
            </form>
          )}

          {revealed && (
            <div className="grid grid-cols-4 gap-2 md:gap-2.5">
              {RATINGS.map(r => (
                <button key={r.rating} type="button" onClick={() => rate(r.rating)} aria-describedby={suggested === r.rating ? 'suggested-rating' : undefined}
                  className={`relative min-h-[64px] rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-colors ${r.className} ${suggested === r.rating ? 'ring-2 ring-offset-2 ring-brand-500 dark:ring-offset-slate-800' : ''}`}>
                  {suggested === r.rating && <span id="suggested-rating" className="absolute -top-2.5 rounded-full bg-brand-500 text-white text-[10px] px-2 py-0.5">پیشنهاد</span>}
                  <span className="font-extrabold">{r.label} <Kbd>{r.key}</Kbd></span>
                  <span className="text-xs">{intervalLabel(intervals[r.rating])}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="hidden lg:flex flex-[1_1_15rem] max-w-xs flex-col gap-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-2.5 text-sm text-slate-700 dark:text-slate-300">
            <h3 className="font-bold text-ink dark:text-white">میانبرها</h3>
            <p className="flex justify-between"><span>نمایش پاسخ</span><span dir="ltr" className="font-en text-ink-muted">Space</span></p>
            <p className="flex justify-between"><span>امتیازدهی</span><span dir="ltr" className="font-en text-ink-muted">1 2 3 4</span></p>
            <p className="flex justify-between"><span>پخش تلفظ</span><span dir="ltr" className="font-en text-ink-muted">P</span></p>
            <p className="flex justify-between"><span>واگرد آخرین امتیاز</span><span dir="ltr" className="font-en text-ink-muted">Z</span></p>
            <p className="flex justify-between"><span>پایان جلسه</span><span dir="ltr" className="font-en text-ink-muted">Esc</span></p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-2 text-sm text-slate-700 dark:text-slate-300">
            <h3 className="font-bold text-ink dark:text-white">این جلسه</h3>
            <p className="flex justify-between"><span>مرورها</span><span>{fa(reviews)}</span></p>
            <p className="flex justify-between"><span>امتیاز</span><span>{fa(xp)}</span></p>
            <p className="text-xs text-ink-muted dark:text-slate-400 pt-1">هر ۵ جواب درست پشت سر هم، امتیاز هر جواب را یکی بیشتر می‌کند.</p>
            {history.length > 0 && (
              <button type="button" onClick={undo} className="mt-1 min-h-[40px] rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600">واگرد آخرین امتیاز</button>
            )}
          </div>
        </aside>
      </div>

      <div className="sm:hidden flex justify-center gap-4 pb-4 text-sm">
        <div role="group" aria-label="حالت مرور" className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
          {(['flip', 'type', 'cloze'] as StudyMode[]).map(m => (
            <button key={m} type="button" onClick={() => switchMode(m)} aria-pressed={mode === m}
              className={`min-h-[36px] px-3 rounded-lg ${mode === m ? 'bg-white dark:bg-slate-700 font-bold shadow-sm text-ink dark:text-white' : 'text-ink-muted dark:text-slate-400'}`}>
              {MODE_NAMES[m]}
            </button>
          ))}
        </div>
        {history.length > 0 && <button type="button" onClick={undo} className="text-ink-muted dark:text-slate-400">واگرد</button>}
      </div>
    </div>
  );
};
