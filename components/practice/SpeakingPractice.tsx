// File: /components/practice/SpeakingPractice.tsx
// Pronunciation practice: read a card's word inside its sentence (or the word
// alone), get the whole sentence back word by word with what went wrong, try
// again, and see progress over time. Each item comes back on a schedule
// worked out from its tries (services/speechPractice).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SpeechAttempt, SpeechMark } from '../../types';
import { AiRequestOptions, evaluatePronunciation } from '../../services/geminiService';
import { recordingForAi } from '../../services/audioWav';
import { hasSpeech } from '../../services/audioWav';
import {
  attemptKey, attemptsFor, dailyScores, focusIndexes, focusSounds, listenerMissed, newAttempt, soundInfo, SpeechItem, SpeechSchedule,
  speechSchedules, SpeechStage, speechSummary, speechTokens, WEAK_SCORE, weakSounds,
} from '../../services/speechPractice';
import { dayString } from '../../services/streakService';
import { isSpeechSupported, speakText } from '../../services/ttsService';
import { fetchAudioData } from '../../services/dictionaryService';
import { fa, Icon } from '../common/ui';

const panel = 'bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-8';
const primaryButton = 'inline-flex items-center justify-center gap-2 min-h-[52px] px-8 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold transition-colors disabled:opacity-50';
const secondaryButton = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50';

const MAX_RECORDING_MS = 30_000;
// A try below this is asked once more at the end of the same session.
const AGAIN_BELOW = 60;

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
const barTone = (score: number) => (score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500');

export const STAGE_LABEL: Record<SpeechStage, string> = {
  new: 'تازه', learning: 'در حال یادگیری', reviewing: 'در حال تثبیت', settled: 'جاافتاده',
};
const STAGE_TONE: Record<SpeechStage, string> = {
  new: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  learning: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  reviewing: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100',
  settled: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100',
};
export const StageChip: React.FC<{ stage: SpeechStage }> = ({ stage }) => (
  <span className={`inline-block text-[11px] font-bold rounded-full px-2 py-0.5 ${STAGE_TONE[stage]}`}>{STAGE_LABEL[stage]}</span>
);

// "امروز", "فردا", "۳ روز دیگر".
export const dueLabel = (dueDay: string, today: string = dayString(new Date())): string => {
  if (dueDay <= today) return 'امروز';
  const days = Math.round((new Date(`${dueDay}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
  return days === 1 ? 'فردا' : `${fa(days)} روز دیگر`;
};

const MARK_STYLE: Record<SpeechMark['status'], string> = {
  unclear: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100 underline decoration-wavy decoration-amber-500',
  wrong: 'bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-100 underline decoration-wavy decoration-red-500',
  missed: 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400 line-through',
};
const MARK_LABEL: Record<SpeechMark['status'], string> = { unclear: 'نه‌چندان واضح', wrong: 'اشتباه', missed: 'جاافتاده' };

// The text as read, each word coloured by how it came out; the card's own
// word underlined. Without marks (a try from before them) only the focus shows.
export const SentenceMarks: React.FC<{ text: string; marks?: SpeechMark[]; focus?: string; size?: string }> = ({ text, marks, focus, size = 'text-xl md:text-2xl' }) => {
  const byIndex = new Map<number, SpeechMark>((marks || []).map(m => [m.i, m]));
  const focusAt = new Set(focus ? focusIndexes(text, focus) : []);
  return (
    <p dir="ltr" className={`font-en leading-loose text-ink dark:text-white break-words ${size}`}>
      {speechTokens(text).map((t, k) => {
        if (t.i === undefined) return <React.Fragment key={k}>{t.text}</React.Fragment>;
        const mark = byIndex.get(t.i);
        const isFocus = focusAt.has(t.i);
        const cls = `${mark ? `${MARK_STYLE[mark.status]} rounded px-0.5` : marks ? 'text-emerald-800 dark:text-emerald-200' : ''} ${isFocus ? 'font-extrabold border-b-2 border-brand-500' : ''}`;
        return (
          <span key={k} className={cls} title={mark ? `${MARK_LABEL[mark.status]}${mark.heard ? `: «${mark.heard}»` : ''}` : undefined}>
            {t.text}
          </span>
        );
      })}
    </p>
  );
};

// The marked words in a list: what was heard and how to fix it. Many words
// left out are said in one line; the sentence above shows them crossed out.
const MarkList: React.FC<{ text: string; marks: SpeechMark[] }> = ({ text, marks }) => {
  const words = speechTokens(text).filter(t => t.i !== undefined);
  const missed = marks.filter(m => m.status === 'missed');
  const listed = missed.length > 3 ? marks.filter(m => m.status !== 'missed') : marks;
  return (
    <ul className="flex flex-col gap-1.5 text-right">
      {missed.length > 3 && (
        <li className="text-sm font-bold text-ink dark:text-slate-200">
          {fa(missed.length)} واژه از {fa(words.length)} واژهٔ جمله شنیده نشد{missed.length > words.length / 2 ? '؛ جمله را کامل و از اول بخوان.' : '.'}
        </li>
      )}
      {listed.slice(0, 8).map(m => {
        const info = m.sound ? soundInfo(m.sound) : null;
        return (
          <li key={m.i} className="text-sm text-ink dark:text-slate-200">
            <bdi dir="ltr" className="font-en font-bold">{words[m.i]?.text}</bdi>
            <span className="text-ink-muted dark:text-slate-400"> · {MARK_LABEL[m.status]}</span>
            {m.heard && m.status !== 'missed' && <> · شنیده شد <bdi dir="ltr" className="font-en">«{m.heard}»</bdi></>}
            {info && m.sound !== 'other' && <> · {info.label}{info.ipa && <> <bdi dir="ltr" className="font-en text-ink-muted dark:text-slate-400">/{info.ipa}/</bdi></>}</>}
          </li>
        );
      })}
    </ul>
  );
};

const PARTS: { key: 'accuracy' | 'fluency' | 'rhythm' | 'completeness'; label: string }[] = [
  { key: 'accuracy', label: 'درستی صداها' },
  { key: 'fluency', label: 'روانی' },
  { key: 'rhythm', label: 'تکیه و آهنگ' },
  { key: 'completeness', label: 'کامل خواندن' },
];

const PartBars: React.FC<{ parts: SpeechAttempt['parts'] }> = ({ parts }) => {
  const shown = PARTS.filter(p => parts?.[p.key] !== undefined);
  if (!shown.length) return null;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-right">
      {shown.map(p => {
        const v = parts![p.key]!;
        return (
          <div key={p.key}>
            <div className="flex justify-between text-xs"><span className="text-ink-muted dark:text-slate-400">{p.label}</span><span className={`font-bold ${scoreTone(v)}`}>{fa(v)}</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" aria-hidden="true">
              <div className={`h-full rounded-full ${barTone(v)}`} style={{ width: `${v}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
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

// One try in full: the sentence word by word, the parts of the score, the
// feedback and every problem.
export const AttemptDetails: React.FC<{ attempt: SpeechAttempt; showText?: boolean }> = ({ attempt, showText = true }) => (
  <div className="flex flex-col gap-3">
    {showText && attempt.kind === 'sentence' && <SentenceMarks text={attempt.target} marks={attempt.marks || []} focus={attempt.focus} size="text-base" />}
    {attempt.focus && attempt.focusScore !== undefined && (
      <p className="text-sm text-ink dark:text-slate-200">
        واژهٔ کارت (<bdi dir="ltr" className="font-en font-bold">{attempt.focus}</bdi>): <span className={`font-extrabold ${scoreTone(attempt.focusScore)}`}>{fa(attempt.focusScore)}</span> از {fa(100)}
      </p>
    )}
    <PartBars parts={attempt.parts} />
    {attempt.feedback && <p dir="rtl" className="text-ink dark:text-slate-200 leading-relaxed">{attempt.feedback}</p>}
    {attempt.tip && <p className="text-sm font-bold text-brand-700 dark:text-brand-200">برای تلاش بعد: {attempt.tip}</p>}
    {attempt.heard && <p className="text-sm text-ink-muted dark:text-slate-400">آنچه شنیده شد: <bdi dir="ltr" className="font-en">«{attempt.heard}»</bdi></p>}
    {attempt.by && <p className="text-xs text-ink-muted dark:text-slate-500">شنونده: <bdi dir="ltr" className="font-en">{attempt.by}</bdi></p>}
    {attempt.correction && <p className="text-sm text-ink-muted dark:text-slate-400">تلفظ درست: <bdi dir="ltr" className="font-en font-bold">{attempt.correction}</bdi></p>}
    {attempt.marks && attempt.marks.length > 0 && <MarkList text={attempt.target} marks={attempt.marks} />}
    {attempt.issues.length > 0 && (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-ink dark:text-white text-right">نقطه‌های ضعف این تلاش</p>
        <IssueList issues={attempt.issues} />
      </div>
    )}
  </div>
);

interface SpeakingModeProps {
  items: SpeechItem[];
  attempts: SpeechAttempt[];
  onSaveAttempt: (attempt: SpeechAttempt) => Promise<void> | void;
  onFinish: (result: { average: number; tried: SpeechAttempt[] }) => void;
  audioOptions?: AiRequestOptions;
}

export const SpeakingMode: React.FC<SpeakingModeProps> = ({ items, attempts, onSaveAttempt, onFinish, audioOptions }) => {
  // The session's queue: a weak item is asked once more at its end.
  const [queue, setQueue] = useState<SpeechItem[]>(items);
  const [index, setIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SpeechAttempt | null>(null);
  const [myVoice, setMyVoice] = useState('');
  const [tried, setTried] = useState<SpeechAttempt[]>([]);
  const [showMeaning, setShowMeaning] = useState(false);
  // The listener answered without hearing the recording (see listenerMissed).
  const [missed, setMissed] = useState<{ by?: string; heard?: string; times: number } | null>(null);
  const missedTimes = useRef(0);
  const lastRecording = useRef<Blob | null>(null);
  const requeued = useRef(new Set<string>());
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const alive = useRef(true);
  const limit = useRef<ReturnType<typeof setTimeout>>();
  const starting = useRef(false);
  const indexRef = useRef(0);
  indexRef.current = index;

  const item = queue[index];
  const card = item?.card;
  const kind = item?.kind || 'word';
  const target = item?.target || '';
  const key = card ? attemptKey({ cardId: card.id, target, kind }) : '';
  const history = useMemo(() => attemptsFor(attempts, key), [attempts, key]);
  // Asked once per session, so the AI listens closely for his usual slips.
  const weak = useMemo(() => focusSounds(attempts), []); // eslint-disable-line react-hooks/exhaustive-deps
  const isRepeat = useMemo(() => queue.slice(0, index).some(q => q.card.id === card?.id && q.kind === kind), [queue, index, card, kind]);

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
  // while the same item is still on screen.
  const evaluate = async (blob: Blob, forIndex: number) => {
    setIsAnalyzing(true);
    setError('');
    setMissed(null);
    lastRecording.current = blob;
    try {
      const audio = await recordingForAi(blob);
      // Silence is not sent: it costs a request and the listener may make up words.
      if (audio.level && !hasSpeech(audio.level)) {
        if (alive.current) setError('در ضبط تو صدایی شنیده نشد، پس چیزی فرستاده نشد. میکروفون را نزدیک‌تر بگیر، دکمه را بزن و بعد شروع به خواندن کن.');
        return;
      }
      const evaluation = await evaluatePronunciation(target, audio.data, audio.mimeType, audioOptions, { kind, weak, focus: item.focus });
      // The listener did not really hear a recording with voice in it: no
      // score is saved, and the same recording can be sent again.
      if (listenerMissed(evaluation, target)) {
        if (alive.current && indexRef.current === forIndex) setMissed({ by: evaluation.by, heard: evaluation.heard, times: (missedTimes.current += 1) });
        return;
      }
      missedTimes.current = 0;
      const attempt: SpeechAttempt = { ...newAttempt(target, kind, evaluation, card.id), ...(item.focus ? { focus: item.focus } : {}) };
      await onSaveAttempt(attempt);
      if (!alive.current || indexRef.current !== forIndex) return;
      setResult(attempt);
      setTried(prev => [...prev, attempt]);
      // A weak first try comes back once at the end of the session.
      const id = `${card.id}|${kind}`;
      if (attempt.score < AGAIN_BELOW && !requeued.current.has(id)) {
        requeued.current.add(id);
        setQueue(prev => [...prev, item]);
      }
    } catch (err) {
      if (!alive.current) return;
      // With only Gemini to ask, say where another listener is set up.
      const onlyGemini = (audioOptions?.aiProvider || 'gemini') === 'gemini' && !audioOptions?.fallbacks?.length;
      setError(`صدا بررسی نشد: ${((err as Error)?.message || 'سرویس جواب نداد').replace(/\.+$/, '')}.${onlyGemini
        ? ' اگر Gemini کار نمی‌کند، کلید OpenRouter را در تنظیمات › سرویس‌های هوش مصنوعی وارد کن تا وقتی Gemini جواب نداد، OpenRouter گوش کند.'
        : ' دوباره امتحان کن.'}`);
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
    setMissed(null);
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
  // device voice; a sentence a little slower, a word slower still.
  const playCorrect = async (slow = false) => {
    if (kind === 'word' && card.audioSrc && !slow) {
      try {
        const src = /^(data|blob):/i.test(card.audioSrc) ? card.audioSrc : await fetchAudioData(card.audioSrc);
        await new Audio(src).play();
        return;
      } catch (err) {
        console.warn('Card audio did not play:', err);
      }
    }
    speakText(target.replace(/…/g, ''), { rate: slow ? 0.65 : kind === 'sentence' ? 0.9 : 0.85 });
  };
  const playWord = () => speakText(item.focus || card.front, { rate: 0.75 });

  const retry = () => {
    setResult(null);
    setError('');
    setMissed(null);
  };

  const next = () => {
    setMissed(null);
    missedTimes.current = 0;
    if (index < queue.length - 1) {
      setIndex(i => i + 1);
      setResult(null);
      setError('');
      setMyVoice('');
      setShowMeaning(false);
      return;
    }
    // Each item counts with its last try in this session.
    const last = new Map<string, number>();
    tried.forEach(a => last.set(attemptKey(a), a.score));
    const scores = Array.from(last.values());
    onFinish({ average: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : 0, tried });
  };

  if (!item) return null;
  const isLast = index >= queue.length - 1;
  const earlier = result ? history.filter(a => a.id !== result.id) : history;
  const canHear = isSpeechSupported() || (kind === 'word' && !!card.audioSrc);

  return (
    <div className="max-w-xl mx-auto w-full flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div className="h-full bg-brand-500 rounded-full transition-all duration-300" style={{ width: `${((index + 1) / queue.length) * 100}%` }} />
        </div>
        <span className="text-sm text-ink-muted dark:text-slate-400 whitespace-nowrap">{fa(index + 1)} از {fa(queue.length)}</span>
      </div>

      <section className={`${panel} min-h-[200px] flex flex-col justify-center items-center gap-3 text-center`}>
        <p className="text-sm text-ink-muted dark:text-slate-400">
          {kind === 'sentence' ? 'این جمله را بلند و طبیعی بخوان' : 'این واژه را بلند بخوان'}
          {isRepeat && <span className="ms-1.5 font-bold text-amber-700 dark:text-amber-300">· یک بار دیگر</span>}
        </p>
        {kind === 'sentence'
          ? <SentenceMarks text={target} marks={result?.marks || (result ? [] : undefined)} focus={item.focus} />
          : <h2 dir="ltr" className="font-en font-bold tracking-tight text-ink dark:text-white break-words max-w-full text-4xl md:text-5xl">{target}</h2>}
        {kind === 'word' && card.pronunciation && <p dir="ltr" className="text-ink-muted dark:text-slate-400">{card.pronunciation}</p>}
        {kind === 'sentence' && (
          <p className="text-sm text-ink-muted dark:text-slate-400">
            واژهٔ کارت: <bdi dir="ltr" className="font-en font-bold text-ink dark:text-white">{card.front}</bdi>
            {card.pronunciation && <> <bdi dir="ltr" className="font-en">{card.pronunciation}</bdi></>}
            {card.back && (showMeaning
              ? <> · <span className="text-ink dark:text-slate-200">{card.back}</span></>
              : <> · <button type="button" onClick={() => setShowMeaning(true)} className="underline underline-offset-4">معنی</button></>)}
          </p>
        )}
        {canHear && !result && (
          <div className="flex flex-wrap justify-center gap-2 mt-1">
            <button type="button" onClick={() => playCorrect()} className={secondaryButton}><Icon.Speaker size={18} /> اول گوش کن</button>
            <button type="button" onClick={() => playCorrect(true)} className={secondaryButton}>آهسته</button>
            {kind === 'sentence' && isSpeechSupported() && <button type="button" onClick={playWord} className={secondaryButton}>فقط واژه</button>}
          </div>
        )}
        {earlier.length > 0 && !result && (
          <p className="text-xs text-ink-muted dark:text-slate-400">تلاش‌های پیشین: <ScoreTrail scores={earlier.slice(-6).map(a => a.score)} /></p>
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
          {missed && !isAnalyzing && !isRecording && (
            <div role="alert" className="w-full px-4 py-3 rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 text-sm text-center flex flex-col items-center gap-2">
              <p>
                صدایت ضبط شده، ولی شنونده{missed.by && <> (<bdi dir="ltr" className="font-en">{missed.by}</bdi>)</>} درست نشنیدش
                {missed.heard ? <> و به‌جایش نوشت <bdi dir="ltr" className="font-en">«{missed.heard}»</bdi></> : null}. این نمره ثبت نشد.
              </p>
              {missed.times >= 2 && <p className="text-xs">چند بار پشت هم شد؛ شاید این شنونده الان مشکل دارد. در تنظیمات › مطالعه › شنوندهٔ تمرین تلفظ، شنوندهٔ دیگری را امتحان کن.</p>}
              <div className="flex flex-wrap justify-center gap-2">
                {myVoice && <button type="button" onClick={() => new Audio(myVoice).play().catch(() => {})} className={secondaryButton}><MicIcon recording={false} size={18} /> صدای خودم</button>}
                <button type="button" onClick={() => lastRecording.current && evaluate(lastRecording.current, index)} className={secondaryButton}>همین صدا را دوباره بفرست</button>
              </div>
            </div>
          )}
          <button type="button" onClick={next} disabled={isRecording || isAnalyzing} className="text-sm text-ink-muted dark:text-slate-400 underline underline-offset-4 disabled:opacity-50">
            {isLast ? (tried.length ? 'پایان' : 'رد شدن و پایان') : 'رد شدن'}
          </button>
        </div>
      ) : (
        <div className="w-full flex flex-col items-center gap-4 animate-flip-in">
          <div className={`w-full p-5 rounded-3xl border-2 flex flex-col gap-3 ${scoreBox(result.score)}`}>
            <p className="text-ink dark:text-white text-center">
              <span className="text-4xl font-extrabold">{fa(result.score)}</span>
              <span className="text-base font-bold text-ink-muted dark:text-slate-400 ms-1.5">از {fa(100)}</span>
            </p>
            {earlier.length > 0 && (
              <p className="text-sm text-ink-muted dark:text-slate-400 text-center">
                روند تو: <ScoreTrail scores={[...earlier.slice(-5).map(a => a.score), result.score]} />
                {result.score > earlier[earlier.length - 1].score && <span className="ms-1.5 font-bold text-emerald-700 dark:text-emerald-300">بهتر شد!</span>}
              </p>
            )}
            {kind === 'sentence' && (
              <p className="text-xs text-ink-muted dark:text-slate-400 text-center">
                <span className="text-emerald-700 dark:text-emerald-300 font-bold">سبز</span>: درست ·{' '}
                <span className="text-amber-700 dark:text-amber-300 font-bold">زرد</span>: نه‌چندان واضح ·{' '}
                <span className="text-red-700 dark:text-red-300 font-bold">قرمز</span>: اشتباه · خط‌خورده: جاافتاده
              </p>
            )}
            <AttemptDetails attempt={result} showText={false} />
            {result.score >= 80 && result.issues.length === 0 && !result.marks?.length && <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300 text-center">ایراد مشخصی شنیده نشد.</p>}
            {result.score < AGAIN_BELOW && !isRepeat && <p className="text-sm text-ink-muted dark:text-slate-400 text-center">این مورد در پایان همین تمرین یک بار دیگر می‌آید.</p>}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {myVoice && (
              <button type="button" onClick={() => new Audio(myVoice).play().catch(() => {})} className={secondaryButton}>
                <MicIcon recording={false} size={18} /> صدای خودم
              </button>
            )}
            {canHear && <button type="button" onClick={() => playCorrect()} className={secondaryButton}><Icon.Speaker size={18} /> تلفظ درست</button>}
            <button type="button" onClick={retry} className={secondaryButton}>دوباره بگو</button>
          </div>
          <button type="button" onClick={next} className={primaryButton}>{isLast ? 'پایان' : 'بعدی'}</button>
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
      <p className="text-xs text-ink-muted dark:text-slate-400">خط‌چین: نمرهٔ {fa(WEAK_SCORE)}؛ موردهایی که آخرین بار زیر آن ماندند «ضعیف» حساب می‌شوند.</p>
    </figure>
  );
};

interface SpeechProgressProps {
  attempts: SpeechAttempt[];
  onPracticeWeak?: () => void;
  onPracticeDue?: () => void;
  // A wrong try (the listener did not hear) is taken out of the progress and
  // the schedule, on every device.
  onDeleteAttempt?: (attempt: SpeechAttempt) => void;
  weakCount: number;
  dueCount: number;
}

type ItemFilter = 'all' | 'due' | 'learning' | 'settled';

export const SpeechProgress: React.FC<SpeechProgressProps> = ({ attempts, onPracticeWeak, onPracticeDue, onDeleteAttempt, weakCount, dueCount }) => {
  const summary = useMemo(() => speechSummary(attempts), [attempts]);
  const days = useMemo(() => dailyScores(attempts), [attempts]);
  const sounds = useMemo(() => weakSounds(attempts), [attempts]);
  const schedules = useMemo(() => speechSchedules(attempts).sort((a, b) => b.lastDay.localeCompare(a.lastDay) || a.lastScore - b.lastScore), [attempts]);
  const today = dayString(new Date());
  const stageCounts = useMemo(() => {
    const c: Record<SpeechStage, number> = { new: 0, learning: 0, reviewing: 0, settled: 0 };
    schedules.forEach(s => { c[s.stage]++; });
    return c;
  }, [schedules]);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<ItemFilter>('all');
  const [showAll, setShowAll] = useState(false);

  if (summary.total === 0) {
    return (
      <section className={`${panel} text-center flex flex-col items-center gap-2`}>
        <h2 className="text-xl font-extrabold text-ink dark:text-white">هنوز تلاشی ثبت نشده</h2>
        <p className="text-ink-muted dark:text-slate-400 max-w-md leading-relaxed">از «تمرین تلفظ» شروع کن. هر تلاش با نمره و بازخوردش این‌جا می‌ماند، روی همهٔ دستگاه‌هایت دیده می‌شود و هر مورد سر وقتش برای مرور برمی‌گردد.</p>
      </section>
    );
  }

  const filtered = schedules.filter(s => filter === 'all' || (filter === 'due' ? s.dueDay <= today : filter === 'settled' ? s.stage === 'settled' : s.stage !== 'settled'));
  const shown = showAll ? filtered : filtered.slice(0, 12);
  const filterButton = (value: ItemFilter, label: string) => (
    <button type="button" onClick={() => { setFilter(value); setShowAll(false); }} aria-pressed={filter === value}
      className={`min-h-[36px] px-3 rounded-xl text-sm ${filter === value ? 'bg-brand-100 text-brand-700 font-bold dark:bg-brand-900/60 dark:text-brand-200' : 'text-ink-muted dark:text-slate-400'}`}>
      {label}
    </button>
  );

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

      <section className={`${panel} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold text-ink dark:text-white">برنامهٔ مرور تلفظ</h2>
          {onPracticeDue && dueCount > 0 && (
            <button type="button" onClick={onPracticeDue} className={secondaryButton}>مرور {fa(dueCount)} مورد امروز</button>
          )}
        </div>
        <p className="text-sm text-ink-muted dark:text-slate-400 leading-relaxed">
          هر مورد با <b>نخستین تلاش هر روز</b> سنجیده می‌شود. اگر خوب نبود فردا برمی‌گردد؛ اگر خوب بود ۳، ۷، ۱۶ و ۳۵ روز بعد. سه روزِ پشت‌سرِهم خوب، یعنی جاافتاده.
        </p>
        <div className="grid grid-cols-3 gap-2 text-center">
          {(['learning', 'reviewing', 'settled'] as SpeechStage[]).map(stage => (
            <div key={stage} className="rounded-2xl bg-slate-50 dark:bg-slate-700/40 p-3">
              <p className="text-2xl font-extrabold text-ink dark:text-white">{fa(stageCounts[stage])}</p>
              <StageChip stage={stage} />
            </div>
          ))}
        </div>
      </section>

      <section className={panel}>
        <DayBars days={days} />
      </section>

      <section className={`${panel} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold text-ink dark:text-white">صداهایی که بیشتر اشتباه می‌شوند</h2>
          {onPracticeWeak && weakCount > 0 && (
            <button type="button" onClick={onPracticeWeak} className={secondaryButton}>تمرین {fa(weakCount)} مورد ضعیف</button>
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
        <h2 className="text-lg font-extrabold text-ink dark:text-white">تاریخچهٔ تمرین‌ها</h2>
        <div role="group" aria-label="کدام موردها" className="flex flex-wrap gap-1">
          {filterButton('all', `همه (${fa(schedules.length)})`)}
          {filterButton('due', 'برای امروز')}
          {filterButton('learning', 'در حال یادگیری')}
          {filterButton('settled', 'جاافتاده')}
        </div>
        {shown.length === 0 && <p className="text-sm text-ink-muted dark:text-slate-400">موردی نیست.</p>}
        <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
          {shown.map((s: SpeechSchedule) => {
            const expanded = open === s.key;
            const list = expanded ? attemptsFor(attempts, s.key).reverse() : [];
            const scores = attemptsFor(attempts, s.key).map(a => a.score);
            return (
              <li key={s.key} className="py-2">
                <button type="button" onClick={() => setOpen(expanded ? null : s.key)} aria-expanded={expanded}
                  className="w-full flex items-center justify-between gap-3 text-right min-h-[44px]">
                  <span className="min-w-0 flex flex-col gap-0.5">
                    <bdi dir="ltr" className={`font-en font-bold text-ink dark:text-white ${s.kind === 'sentence' ? 'text-sm' : ''} truncate`}>{s.target}</bdi>
                    <span className="text-xs text-ink-muted dark:text-slate-400 flex flex-wrap items-center gap-1.5">
                      <StageChip stage={s.stage} />
                      {s.kind === 'sentence' ? 'جمله · ' : ''}{fa(s.tries)} تلاش · مرور بعد: {dueLabel(s.dueDay, today)}
                      {s.lastScore < WEAK_SCORE && <span className="text-red-700 dark:text-red-300 font-bold">· ضعیف</span>}
                    </span>
                  </span>
                  <span className="text-sm shrink-0"><ScoreTrail scores={scores.slice(-5)} /></span>
                </button>
                {expanded && (
                  <ol className="mt-2 flex flex-col gap-2">
                    {list.map(a => (
                      <li key={a.id} className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-700/40 text-sm flex flex-col gap-1.5">
                        <p className="flex justify-between gap-2">
                          <span className={`font-extrabold ${scoreTone(a.score)}`}>{fa(a.score)} از {fa(100)}</span>
                          <span className="text-xs text-ink-muted dark:text-slate-400">{new Date(a.createdAt).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        </p>
                        <AttemptDetails attempt={a} />
                        {onDeleteAttempt && (
                          <button type="button" onClick={() => { if (confirm('این تلاش از تاریخچه و برنامهٔ مرور حذف شود؟ (مثلاً وقتی شنونده درست نشنیده بود)')) onDeleteAttempt(a); }}
                            className="self-start text-xs text-red-700 dark:text-red-300 underline underline-offset-4">
                            حذف این تلاش
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
        {filtered.length > shown.length && (
          <button type="button" onClick={() => setShowAll(true)} className={`${secondaryButton} self-center`}>نمایش همه ({fa(filtered.length)})</button>
        )}
      </section>
    </div>
  );
};
