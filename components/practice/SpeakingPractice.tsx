// File: /components/practice/SpeakingPractice.tsx
// Pronunciation practice: read a word or its example sentence aloud, get a
// score with the exact sounds that went wrong, try again, and see progress
// over time (scores by day, sounds that keep going wrong, every word tried).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Flashcard, SpeechAttempt } from '../../types';
import { AiRequestOptions, blobToBase64, evaluatePronunciation } from '../../services/geminiService';
import {
  attemptKey, attemptsFor, dailyScores, focusSounds, itemProgress, newAttempt, soundInfo, SpeechKind,
  speechSummary, WEAK_SCORE, weakCardIds, weakSounds,
} from '../../services/speechPractice';
import { isSpeechSupported, speakText } from '../../services/ttsService';
import { fetchAudioData } from '../../services/dictionaryService';
import { fa, Icon } from '../common/ui';

const panel = 'bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-8';
const primaryButton = 'inline-flex items-center justify-center gap-2 min-h-[52px] px-8 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold transition-colors disabled:opacity-50';
const secondaryButton = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50';

export const SESSION_SIZE = 5;
const MAX_RECORDING_MS = 30_000;

export const MicIcon = ({ recording, size = 28 }: { recording: boolean; size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={recording ? 'text-red-600 dark:text-red-400' : 'text-brand-600 dark:text-brand-200'}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </svg>
);

export const scoreTone = (score: number) =>
  score >= 80 ? 'text-emerald-700 dark:text-emerald-300' : score >= 60 ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300';
const scoreBox = (score: number) =>
  score >= 80 ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : score >= 60 ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' : 'border-red-500 bg-red-50 dark:bg-red-900/20';

// The text a card is read as: its front, or its first example sentence.
export const speakingTarget = (card: Flashcard, kind: SpeechKind): string =>
  kind === 'sentence' ? (card.exampleSentenceTarget || []).map(s => s.trim()).find(Boolean) || '' : card.front.trim();

const shuffle = <T,>(list: T[]): T[] => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export type CardChoice = 'mixed' | 'weak';

// The cards of one session: the weakest ones first when asked for, else new
// and due cards before the rest, in random order.
export const pickSpeakingCards = (cards: Flashcard[], attempts: SpeechAttempt[], kind: SpeechKind, choice: CardChoice, size = SESSION_SIZE): Flashcard[] => {
  const usable = cards.filter(c => !c.isDeleted && c.kind !== 'grammar' && speakingTarget(c, kind));
  if (choice === 'weak') {
    const byId = new Map(usable.map(c => [c.id, c]));
    const weak = weakCardIds(attempts.filter(a => a.kind === kind)).map(id => byId.get(id)).filter((c): c is Flashcard => !!c);
    return weak.slice(0, size);
  }
  const now = Date.now();
  const first = usable.filter(c => c.repetition === 0 || new Date(c.dueDate).getTime() <= now);
  const rest = usable.filter(c => !first.includes(c));
  return [...shuffle(first), ...shuffle(rest)].slice(0, size);
};

const IssueList: React.FC<{ issues: SpeechAttempt['issues'] }> = ({ issues }) => (
  <ul className="flex flex-col gap-2 text-right">
    {issues.map((issue, i) => {
      const info = soundInfo(issue.sound);
      return (
        <li key={i} className="p-3 rounded-2xl bg-white/70 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
          <p className="text-sm font-bold text-ink dark:text-white">
            {info.label}
            {info.ipa && <> <bdi dir="ltr" className="font-en font-normal text-ink-muted dark:text-slate-400">/{info.ipa}/</bdi></>}
            {issue.word && <> در <bdi dir="ltr" className="font-en">{issue.word}</bdi></>}
          </p>
          {issue.detail && <p dir="rtl" className="text-sm text-ink dark:text-slate-200 mt-1 leading-relaxed">{issue.detail}</p>}
          {info.tip && <p className="text-xs text-ink-muted dark:text-slate-400 mt-1 leading-relaxed">راهنما: {info.tip}</p>}
        </li>
      );
    })}
  </ul>
);

// Scores of earlier tries, oldest first: "۴۰ ← ۶۵ ← ۸۰" in reading order.
const ScoreTrail: React.FC<{ scores: number[] }> = ({ scores }) => (
  <span className="inline-flex flex-wrap items-center gap-1">
    {scores.map((s, i) => (
      <React.Fragment key={i}>
        {i > 0 && <span className="text-ink-muted dark:text-slate-500" aria-hidden="true">←</span>}
        <span className={`font-bold ${scoreTone(s)}`}>{fa(s)}</span>
      </React.Fragment>
    ))}
  </span>
);

interface SpeakingModeProps {
  sessionCards: Flashcard[];
  kind: SpeechKind;
  attempts: SpeechAttempt[];
  onSaveAttempt: (attempt: SpeechAttempt) => Promise<void> | void;
  onFinish: (result: { average: number; tried: SpeechAttempt[] }) => void;
  audioOptions?: AiRequestOptions;
}

export const SpeakingMode: React.FC<SpeakingModeProps> = ({ sessionCards, kind, attempts, onSaveAttempt, onFinish, audioOptions }) => {
  const [index, setIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SpeechAttempt | null>(null);
  const [myVoice, setMyVoice] = useState('');
  const [tried, setTried] = useState<SpeechAttempt[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const alive = useRef(true);
  const limit = useRef<ReturnType<typeof setTimeout>>();
  const starting = useRef(false);
  const indexRef = useRef(0);
  indexRef.current = index;

  const card = sessionCards[index];
  const target = card ? speakingTarget(card, kind) : '';
  const key = card ? attemptKey({ cardId: card.id, target, kind }) : '';
  const history = useMemo(() => attemptsFor(attempts, key), [attempts, key]);
  // Asked once per session, so the AI listens closely for his usual slips.
  const weak = useMemo(() => focusSounds(attempts), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    alive.current = true;
    return () => {
    alive.current = false;
    clearTimeout(limit.current);
    recorder.current?.stream.getTracks().forEach(t => t.stop());
    };
  }, []);
  useEffect(() => () => { if (myVoice) URL.revokeObjectURL(myVoice); }, [myVoice]);

  // The try is saved even when the page was left meanwhile; it is shown only
  // while the same card is still on screen.
  const evaluate = async (blob: Blob, forIndex: number) => {
    setIsAnalyzing(true);
    setError('');
    try {
      // Gemini wants the bare type: "audio/webm", not "audio/webm;codecs=opus".
      const mime = blob.type.split(';')[0] || 'audio/webm';
      const evaluation = await evaluatePronunciation(target, await blobToBase64(blob), mime, audioOptions, { kind, weak });
      const attempt = newAttempt(target, kind, evaluation, card.id);
      await onSaveAttempt(attempt);
      if (!alive.current || indexRef.current !== forIndex) return;
      setResult(attempt);
      setTried(prev => [...prev, attempt]);
    } catch (err) {
      if (alive.current) setError(`صدا بررسی نشد: ${(err as Error)?.message || 'سرویس Gemini پاسخ نداد'}. دوباره امتحان کن.`);
    } finally {
      if (alive.current) setIsAnalyzing(false);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      // Busy at once, so nothing can move on before the answer comes.
      setIsAnalyzing(true);
      recorder.current?.stop();
      setIsRecording(false);
      return;
    }
    if (starting.current || recorder.current?.state === 'recording') return;
    setError('');
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('این مرورگر نمی‌تواند صدا ضبط کند.');
      return;
    }
    let stream: MediaStream;
    starting.current = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('برای این تمرین باید به میکروفون اجازه بدهی.');
      return;
    } finally {
      starting.current = false;
    }
    if (!alive.current) { stream.getTracks().forEach(t => t.stop()); return; }
    const forIndex = indexRef.current;
    const rec = new MediaRecorder(stream);
    recorder.current = rec;
    chunks.current = [];
    rec.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
    rec.onstop = () => {
      clearTimeout(limit.current);
      stream.getTracks().forEach(track => track.stop());
      if (!alive.current) return;
      // Safari records mp4, Chrome and Firefox webm or ogg.
      const blob = new Blob(chunks.current, { type: rec.mimeType || chunks.current[0]?.type || 'audio/webm' });
      if (blob.size < 1000) { setIsAnalyzing(false); setError('صدایی ضبط نشد. دکمه را بزن، بگو و دوباره بزن.'); return; }
      setMyVoice(URL.createObjectURL(blob));
      evaluate(blob, forIndex);
    };
    rec.start();
    setIsRecording(true);
    // A forgotten recording stops by itself, so the upload stays small.
    limit.current = setTimeout(() => {
      if (rec.state === 'recording') { setIsAnalyzing(true); rec.stop(); setIsRecording(false); }
    }, MAX_RECORDING_MS);
  };

  // The card's own sound for a word (a dictionary recording), else the
  // device voice.
  const playCorrect = async () => {
    if (kind === 'word' && card.audioSrc) {
      try {
        const src = /^(data|blob):/i.test(card.audioSrc) ? card.audioSrc : await fetchAudioData(card.audioSrc);
        await new Audio(src).play();
        return;
      } catch (err) {
        console.warn('Card audio did not play:', err);
      }
    }
    speakText(target, { rate: kind === 'sentence' ? 0.9 : 0.85 });
  };

  const retry = () => {
    setResult(null);
    setError('');
  };

  const next = () => {
    if (index < sessionCards.length - 1) {
      setIndex(i => i + 1);
      setResult(null);
      setError('');
      setMyVoice('');
      return;
    }
    // Each card counts with its last try in this session.
    const last = new Map<string, number>();
    tried.forEach(a => last.set(a.cardId || a.target, a.score));
    const scores = Array.from(last.values());
    onFinish({ average: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : 0, tried });
  };

  if (!card) return null;
  const isLast = index >= sessionCards.length - 1;
  const earlier = result ? history.filter(a => a.id !== result.id) : history;

  return (
    <div className="max-w-xl mx-auto w-full flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div className="h-full bg-brand-500 rounded-full transition-all duration-300" style={{ width: `${((index + 1) / sessionCards.length) * 100}%` }} />
        </div>
        <span className="text-sm text-ink-muted dark:text-slate-400 whitespace-nowrap">کارت {fa(index + 1)} از {fa(sessionCards.length)}</span>
      </div>

      <section className={`${panel} min-h-[200px] flex flex-col justify-center items-center gap-2 text-center`}>
        <p className="text-sm text-ink-muted dark:text-slate-400">{kind === 'sentence' ? 'این جمله را بلند بخوان' : 'این واژه را بلند بخوان'}</p>
        <h2 dir="ltr" className={`font-en font-bold tracking-tight text-ink dark:text-white break-words max-w-full ${kind === 'sentence' ? 'text-2xl md:text-3xl leading-relaxed' : 'text-4xl md:text-5xl'}`}>{target}</h2>
        {kind === 'word' && card.pronunciation && <p dir="ltr" className="text-ink-muted dark:text-slate-400">{card.pronunciation}</p>}
        {kind === 'sentence' && <p className="text-sm text-ink-muted dark:text-slate-400">واژهٔ کارت: <bdi dir="ltr" className="font-en font-bold">{card.front}</bdi></p>}
        {(isSpeechSupported() || card.audioSrc) && (
          <button type="button" onClick={playCorrect} className={`${secondaryButton} mt-2`}>
            <Icon.Speaker size={18} /> شنیدن تلفظ درست
          </button>
        )}
        {earlier.length > 0 && !result && (
          <p className="text-xs text-ink-muted dark:text-slate-400 mt-1">تلاش‌های پیشین: <ScoreTrail scores={earlier.slice(-6).map(a => a.score)} /></p>
        )}
      </section>

      {!result ? (
        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={toggleRecording}
            disabled={isAnalyzing}
            aria-pressed={isRecording}
            aria-label={isRecording ? 'توقف ضبط' : 'شروع ضبط'}
            className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all disabled:opacity-50 ${isRecording ? 'bg-red-100 dark:bg-red-900/50 ring-4 ring-red-500 scale-110' : 'bg-brand-100 dark:bg-brand-900/50 hover:bg-brand-200 dark:hover:bg-brand-800'}`}
          >
            <MicIcon recording={isRecording} />
          </button>
          <p role="status" className="text-sm font-medium text-ink-muted dark:text-slate-300">
            {isRecording ? 'برای توقف ضبط بزن' : isAnalyzing ? 'در حال بررسی تلفظ…' : kind === 'sentence' ? 'بزن، جمله را بخوان و دوباره بزن' : 'بزن، واژه را بگو و دوباره بزن'}
          </p>
          {error && <p role="alert" className="px-4 py-3 rounded-2xl bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 text-sm text-center">{error}</p>}
          <button type="button" onClick={next} disabled={isRecording || isAnalyzing} className="text-sm text-ink-muted dark:text-slate-400 underline underline-offset-4 disabled:opacity-50">
            {isLast ? (tried.length ? 'پایان' : 'رد شدن و پایان') : 'رد شدن از این کارت'}
          </button>
        </div>
      ) : (
        <div className="w-full flex flex-col items-center gap-4 animate-flip-in">
          <div className={`w-full p-5 rounded-3xl border-2 text-center flex flex-col gap-3 ${scoreBox(result.score)}`}>
            <p className="text-ink dark:text-white">
              <span className="text-4xl font-extrabold">{fa(result.score)}</span>
              <span className="text-base font-bold text-ink-muted dark:text-slate-400 ms-1.5">از {fa(100)}</span>
            </p>
            {earlier.length > 0 && (
              <p className="text-sm text-ink-muted dark:text-slate-400">
                روند تو: <ScoreTrail scores={[...earlier.slice(-5).map(a => a.score), result.score]} />
                {result.score > earlier[earlier.length - 1].score && <span className="ms-1.5 font-bold text-emerald-700 dark:text-emerald-300">بهتر شد!</span>}
              </p>
            )}
            {result.feedback && <p dir="rtl" className="text-ink dark:text-slate-200 leading-relaxed">{result.feedback}</p>}
            {result.heard && (
              <p className="text-sm text-ink-muted dark:text-slate-400">آنچه شنیده شد: <bdi dir="ltr" className="font-en">«{result.heard}»</bdi></p>
            )}
            {result.correction && (
              <p className="text-sm text-ink-muted dark:text-slate-400">تلفظ درست: <bdi dir="ltr" className="font-en font-bold">{result.correction}</bdi></p>
            )}
            {result.issues.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-bold text-ink dark:text-white text-right">نقطه‌های ضعف این تلاش</p>
                <IssueList issues={result.issues} />
              </div>
            ) : result.score >= 80 && <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">ایراد مشخصی شنیده نشد.</p>}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {myVoice && (
              <button type="button" onClick={() => new Audio(myVoice).play().catch(() => {})} className={secondaryButton}>
                <MicIcon recording={false} size={18} /> صدای خودم
              </button>
            )}
            {(isSpeechSupported() || card.audioSrc) && (
              <button type="button" onClick={playCorrect} className={secondaryButton}><Icon.Speaker size={18} /> تلفظ درست</button>
            )}
            <button type="button" onClick={retry} className={secondaryButton}>دوباره بگو</button>
          </div>
          <button type="button" onClick={next} className={primaryButton}>{isLast ? 'پایان' : 'کارت بعدی'}</button>
        </div>
      )}
    </div>
  );
};

// Daily average score as bars, the latest day on the left end in reading
// order (right to left).
const DayBars: React.FC<{ days: { day: string; average: number; count: number }[] }> = ({ days }) => {
  if (days.length === 0) return null;
  const label = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' });
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-bold text-ink dark:text-white">میانگین نمرهٔ هر روز</figcaption>
      <div className="h-40 pt-5 border-b border-slate-200 dark:border-slate-700">
      <div className="relative h-full flex items-end gap-1.5" role="list" aria-label="میانگین نمرهٔ روزهای تمرین">
        <div className="absolute inset-x-0 border-t border-dashed border-slate-200 dark:border-slate-700" style={{ bottom: `${WEAK_SCORE}%` }} aria-hidden="true" />
        {days.map((d, i) => (
          <div key={d.day} role="listitem" className="group relative flex-1 h-full flex flex-col justify-end items-center min-w-0"
            title={`${label(d.day)}: میانگین ${fa(d.average)} از ${fa(d.count)} تلاش`}
            aria-label={`${label(d.day)}: میانگین ${fa(d.average)} از ${fa(d.count)} تلاش`}>
            {(i === days.length - 1 || days.length <= 7) && (
              <span className="text-[11px] font-bold text-ink-muted dark:text-slate-300 mb-0.5">{fa(d.average)}</span>
            )}
            <div className="w-full max-w-[28px] rounded-t bg-brand-500 dark:bg-brand-400 group-hover:bg-brand-600 dark:group-hover:bg-brand-300 transition-colors" style={{ height: `${Math.max(3, d.average)}%` }} />
          </div>
        ))}
      </div>
      </div>
      <div className="flex justify-between text-[11px] text-ink-muted dark:text-slate-400">
        <span>{label(days[0].day)}</span>
        {days.length > 1 && <span>{label(days[days.length - 1].day)}</span>}
      </div>
      <p className="text-xs text-ink-muted dark:text-slate-400">خط‌چین: نمرهٔ {fa(WEAK_SCORE)}؛ واژه‌هایی که آخرین بار زیر آن ماندند «ضعیف» حساب می‌شوند.</p>
    </figure>
  );
};

interface SpeechProgressProps {
  attempts: SpeechAttempt[];
  onPracticeWeak?: () => void;
  weakCount: number;
}

export const SpeechProgress: React.FC<SpeechProgressProps> = ({ attempts, onPracticeWeak, weakCount }) => {
  const summary = useMemo(() => speechSummary(attempts), [attempts]);
  const days = useMemo(() => dailyScores(attempts), [attempts]);
  const sounds = useMemo(() => weakSounds(attempts), [attempts]);
  const items = useMemo(() => itemProgress(attempts), [attempts]);
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (summary.total === 0) {
    return (
      <section className={`${panel} text-center flex flex-col items-center gap-2`}>
        <h2 className="text-xl font-extrabold text-ink dark:text-white">هنوز تلاشی ثبت نشده</h2>
        <p className="text-ink-muted dark:text-slate-400 max-w-md leading-relaxed">از «تمرین تلفظ» شروع کن. هر تلاش با نمره و نقطه‌های ضعفش اینجا می‌ماند و روی همهٔ دستگاه‌هایت دیده می‌شود.</p>
      </section>
    );
  }

  const shown = showAll ? items : items.slice(0, 12);
  return (
    <div className="flex flex-col gap-5">
      <section className={`${panel} grid grid-cols-3 gap-3 text-center`}>
        <div>
          <p className="text-3xl font-extrabold text-ink dark:text-white">{fa(summary.total)}</p>
          <p className="text-xs text-ink-muted dark:text-slate-400 mt-1">تلاش در {fa(summary.practisedItems)} مورد</p>
        </div>
        <div>
          <p className={`text-3xl font-extrabold ${summary.recentAverage !== null ? scoreTone(summary.recentAverage) : ''}`}>{summary.recentAverage !== null ? fa(summary.recentAverage) : '—'}</p>
          <p className="text-xs text-ink-muted dark:text-slate-400 mt-1">میانگین ۱۰ تلاش آخر</p>
        </div>
        <div>
          <p className={`text-3xl font-extrabold ${summary.change === null ? 'text-ink-muted dark:text-slate-400' : summary.change >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
            {summary.change === null ? '—' : <bdi dir="ltr">{`${summary.change > 0 ? '+' : summary.change < 0 ? '−' : ''}${fa(Math.abs(summary.change))}`}</bdi>}
          </p>
          <p className="text-xs text-ink-muted dark:text-slate-400 mt-1">{summary.change === null ? 'پیشرفت پس از ۲۰ تلاش' : 'نسبت به ۱۰ تلاش پیش از آن'}</p>
        </div>
      </section>

      <section className={panel}>
        <DayBars days={days} />
      </section>

      <section className={`${panel} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold text-ink dark:text-white">صداهایی که بیشتر اشتباه می‌شوند</h2>
          {onPracticeWeak && weakCount > 0 && (
            <button type="button" onClick={onPracticeWeak} className={secondaryButton}>تمرین {fa(weakCount)} واژهٔ ضعیف</button>
          )}
        </div>
        {sounds.length === 0 ? (
          <p className="text-sm text-ink-muted dark:text-slate-400">در تلاش‌های اخیر صدای مشکل‌داری تکرار نشده. آفرین!</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sounds.slice(0, 8).map(w => {
              const info = soundInfo(w.sound);
              return (
                <li key={w.sound} className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-700/40">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-ink dark:text-white">
                      {info.label}
                      {info.ipa && <> <bdi dir="ltr" className="font-en font-normal text-ink-muted dark:text-slate-400">/{info.ipa}/</bdi></>}
                    </p>
                    <span className="text-sm text-ink-muted dark:text-slate-300 whitespace-nowrap">{fa(w.count)} بار در {fa(Math.min(40, summary.total))} تلاش اخیر</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-200 dark:bg-slate-600 overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.round(w.share * 100)}%` }} />
                  </div>
                  {w.words.length > 0 && <p className="text-sm text-ink dark:text-slate-200 mt-2">در: <bdi dir="ltr" className="font-en">{w.words.join(', ')}</bdi></p>}
                  {info.tip && <p className="text-xs text-ink-muted dark:text-slate-400 mt-1 leading-relaxed">{info.tip}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={`${panel} flex flex-col gap-3`}>
        <h2 className="text-lg font-extrabold text-ink dark:text-white">واژه‌ها و جمله‌هایی که تمرین کردی</h2>
        <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
          {shown.map(p => {
            const expanded = open === p.key;
            const list = expanded ? attemptsFor(attempts, p.key).reverse() : [];
            return (
              <li key={p.key} className="py-2">
                <button type="button" onClick={() => setOpen(expanded ? null : p.key)} aria-expanded={expanded}
                  className="w-full flex items-center justify-between gap-3 text-right min-h-[44px]">
                  <span className="min-w-0 flex flex-col">
                    <bdi dir="ltr" className={`font-en font-bold text-ink dark:text-white ${p.kind === 'sentence' ? 'text-sm' : ''} truncate`}>{p.target}</bdi>
                    <span className="text-xs text-ink-muted dark:text-slate-400">
                      {p.kind === 'sentence' ? 'جمله · ' : ''}{fa(p.scores.length)} تلاش · بهترین {fa(p.best)}
                      {p.last < WEAK_SCORE && <span className="ms-1 text-red-700 dark:text-red-300 font-bold">· ضعیف</span>}
                    </span>
                  </span>
                  <span className="text-sm shrink-0"><ScoreTrail scores={p.scores.slice(-5)} /></span>
                </button>
                {expanded && (
                  <ol className="mt-2 flex flex-col gap-2">
                    {list.map(a => (
                      <li key={a.id} className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-700/40 text-sm flex flex-col gap-1.5">
                        <p className="flex justify-between gap-2">
                          <span className={`font-extrabold ${scoreTone(a.score)}`}>{fa(a.score)} از {fa(100)}</span>
                          <span className="text-xs text-ink-muted dark:text-slate-400">{new Date(a.createdAt).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        </p>
                        {a.feedback && <p dir="rtl" className="text-ink dark:text-slate-200 leading-relaxed">{a.feedback}</p>}
                        {a.heard && <p className="text-xs text-ink-muted dark:text-slate-400">شنیده شد: <bdi dir="ltr" className="font-en">«{a.heard}»</bdi></p>}
                        {a.issues.length > 0 && <IssueList issues={a.issues} />}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
        {items.length > shown.length && (
          <button type="button" onClick={() => setShowAll(true)} className={`${secondaryButton} self-center`}>نمایش همه ({fa(items.length)})</button>
        )}
      </section>
    </div>
  );
};
