import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Flashcard } from '../types';
import type { SessionSummary, StudyMode } from '../hooks/useAppLogic';
import { calculateSrs, previewIntervals, PerformanceRating } from '../services/srsService';
import { masteryStage, stageChanges, STAGE_NAMES } from '../services/masteryService';
import { nextCombo, reviewXp } from '../services/xpRules';
import { db } from '../services/localDBService';
import { levenshtein } from '../services/stringSimilarity';
import { fetchAudioData } from '../services/dictionaryService';
import { isSpeechSupported, speakText } from '../services/ttsService';
import { fa, Icon, Kbd, StageDots } from './common/ui';

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

// The answer side: meaning, sentences, expressions and notes.
const CardAnswer: React.FC<{ card: Flashcard }> = ({ card }) => {
  const definitions = asList(card.definition);
  const examples = asList(card.exampleSentenceTarget);
  return (
    <div className="flex flex-col gap-4 animate-reveal">
      <div className="h-px bg-slate-200 dark:bg-slate-700" />
      <p dir="rtl" className="text-2xl md:text-3xl font-extrabold text-center text-ink dark:text-white break-words">{card.back}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {card.sourceSentence && (
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
    </div>
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
}

export const StudyView: React.FC<StudyViewProps> = ({ cards, initialMode, streak, studiedToday, goal, onExit }) => {
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
  const intervals = useMemo(() => (current ? previewIntervals(current) : null), [current]);

  useEffect(() => {
    if (mode === 'type' && !revealed) inputRef.current?.focus();
  }, [index, mode, revealed]);

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
      const audio = new Audio(await fetchAudioData(card.audioSrc));
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

    const logId = await db.studyHistory.add({ cardId: card.id, date: new Date().toISOString().split('T')[0], rating }) as number;
    const next = calculateSrs(current, rating);
    const gained = reviewXp(rating, combo);

    setHistory(h => [...h.slice(-20), { ...snapshot, logId }]);
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
    if (index + 1 < nextQueue.length) setIndex(index + 1);
    else setDone(true);
    busy.current = false;
  };

  const undo = async () => {
    const last = history[history.length - 1];
    if (!last || busy.current) return;
    if (last.logId !== undefined) await db.studyHistory.delete(last.logId);
    setHistory(h => h.slice(0, -1));
    setQueue(last.queue);
    setIndex(last.index);
    setUpdated(last.updated);
    setCombo(last.combo);
    setXp(last.xp);
    setReviews(last.reviews);
    setFirstAnswers(last.firstAnswers);
    setRevealed(true);
    setDone(false);
  };

  const checkTyped = () => {
    if (!card) return;
    const ok = levenshtein(typed.toLowerCase().trim(), card.back.toLowerCase().trim()) <= 2; // small typos allowed
    setAnswerState(ok ? 'correct' : 'incorrect');
    setRevealed(true);
  };

  // Keyboard: Space/Enter shows the answer, 1-4 rate, P plays, Z undoes, Esc leaves.
  useEffect(() => {
    if (done) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea');
      if (e.key === 'Escape') { exitEarly(); return; }
      if (typing && !revealed) return;
      if (!revealed && (e.code === 'Space' || e.key === 'Enter') && mode === 'flip') { e.preventDefault(); setRevealed(true); return; }
      if (revealed) {
        const r = RATINGS.find(x => x.key === e.key);
        if (r) { e.preventDefault(); rate(r.rating); return; }
      }
      if (e.key === 'p' || e.key === 'P') { playAudio(); return; }
      if ((e.key === 'z' || e.key === 'Z') && !e.ctrlKey && !e.metaKey) { undo(); }
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
          {(['flip', 'type'] as StudyMode[]).map(m => (
            <button key={m} type="button" onClick={() => { setMode(m); setRevealed(false); setAnswerState(null); }} aria-pressed={mode === m}
              className={`min-h-[36px] px-3.5 rounded-lg text-sm ${mode === m ? 'bg-white dark:bg-slate-700 font-bold shadow-sm' : 'text-ink-muted dark:text-slate-400'}`}>
              {m === 'flip' ? 'برگرداندن' : 'نوشتنی'}
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
            {card.kind && card.kind !== 'word' && <span>{{ phrase: 'عبارت', idiom: 'اصطلاح', grammar: 'ساختار دستوری' }[card.kind]}</span>}
          </div>

          <div dir="ltr" className="flex flex-col items-center gap-2 text-center pt-2">
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
            {!revealed && card.kind !== 'grammar' && card.sourceSentence && (
              <p className="mt-1 max-w-xl text-sm italic text-ink-muted dark:text-slate-400 line-clamp-3">{card.sourceSentence}</p>
            )}
          </div>

          {revealed ? (
            <>
              {answerState && (
                <p className={`text-center font-bold ${answerState === 'correct' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                  {answerState === 'correct' ? 'درست نوشتی.' : `نوشتی: «${typed}»`}
                </p>
              )}
              <CardAnswer card={card} />
            </>
          ) : mode === 'flip' ? (
            <button type="button" onClick={() => setRevealed(true)}
              className="self-center inline-flex items-center gap-2 min-h-[56px] px-10 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold text-lg">
              نمایش پاسخ <Kbd className="text-white">Space</Kbd>
            </button>
          ) : (
            <form onSubmit={e => { e.preventDefault(); checkTyped(); }} className="flex flex-col items-center gap-3 w-full max-w-md self-center">
              <label htmlFor="typed-answer" className="text-sm text-ink-muted dark:text-slate-400">معنی فارسی را بنویس</label>
              <input id="typed-answer" ref={inputRef} dir="rtl" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off"
                className="w-full text-center text-lg px-4 py-3 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-brand-500 focus:outline-none" />
              <button type="submit" className="min-h-[52px] px-10 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold">بررسی</button>
            </form>
          )}

          {revealed && (
            <div className="grid grid-cols-4 gap-2 md:gap-2.5">
              {RATINGS.map(r => (
                <button key={r.rating} type="button" onClick={() => rate(r.rating)}
                  className={`min-h-[64px] rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-colors ${r.className}`}>
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
        <button type="button" onClick={() => { setMode(mode === 'flip' ? 'type' : 'flip'); setRevealed(false); setAnswerState(null); }} className="text-brand-500 dark:text-brand-300">
          {mode === 'flip' ? 'حالت نوشتنی' : 'حالت برگرداندن'}
        </button>
        {history.length > 0 && <button type="button" onClick={undo} className="text-ink-muted dark:text-slate-400">واگرد</button>}
      </div>
    </div>
  );
};
