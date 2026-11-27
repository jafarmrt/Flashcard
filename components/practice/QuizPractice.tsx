// File: /components/practice/QuizPractice.tsx
// The four-choice quiz: sentence gaps, Persian→English, English→Persian, and
// audio→Persian. A wrong answer shows what the chosen option belongs to, gives
// a hint and a second try, then compares the right word and the chosen one side
// by side, brings missed questions back at the end, and offers «دوباره همین‌ها».

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AiRequestOptions } from '../../services/geminiService';
import { fetchAudioData } from '../../services/dictionaryService';
import { speakText } from '../../services/ttsService';
import { explainChoice } from '../../services/quizExplain';
import { fa, Icon } from '../common/ui';

export interface QuizQuestion {
  cardId?: string;
  targetWord?: string;
  questionText: string;
  sourceSentence: string;
  ask?: 'gap' | 'meaning' | 'word-to-meaning' | 'audio';
  options: string[];
  correctAnswer: string;
  hint?: string;
  meanings?: Record<string, string>;
  optionWords?: Record<string, string>;
  audioSrc?: string;
}

export interface QuizFirstAnswer { cardId: string; right: boolean; chose?: string }

interface QuizPracticeProps {
  questions: QuizQuestion[];
  aiOptions?: AiRequestOptions;
  onAnswer: (answer: QuizFirstAnswer) => void; // the first answer to each question
  onRetry: (cardIds: string[]) => void; // a new quiz from the cards that went wrong
  onDone: () => void;
  doneLabel?: string;
}

type Asked = QuizQuestion & { again?: boolean };
const MAX_TRIES = 2;
const primary = 'inline-flex items-center justify-center gap-2 min-h-[52px] px-8 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center min-h-[48px] px-6 rounded-2xl font-bold text-ink dark:text-white bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600';

const isPersianAsk = (ask?: QuizQuestion['ask']) => ask === 'word-to-meaning' || ask === 'audio';

// Resolves the English word and Persian meaning of any option, regardless of
// whether the buttons show English words or Persian meanings.
const pairOf = (q: QuizQuestion, option: string): { en: string; faText: string } => {
  if (isPersianAsk(q.ask)) {
    return {
      en: q.optionWords?.[option] || q.meanings?.[option] || q.targetWord || '',
      faText: option,
    };
  }
  return {
    en: q.optionWords?.[option] || option,
    faText: q.meanings?.[option] || (option === q.correctAnswer ? q.hint || '' : ''),
  };
};

export const QuizPractice: React.FC<QuizPracticeProps> = ({ questions, aiOptions, onAnswer, onRetry, onDone, doneLabel = 'برگشت' }) => {
  const [queue, setQueue] = useState<Asked[]>(questions);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string[]>([]); // the choices tapped for this question, in order
  const [solved, setSolved] = useState(false);
  const [missed, setMissed] = useState<{ q: QuizQuestion; chose: string }[]>([]);
  const [rightFirst, setRightFirst] = useState(0);
  const [why, setWhy] = useState<{ loading?: boolean; text?: string; error?: boolean } | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  const total = questions.length;
  const q = queue[index];
  const shuffled = useMemo(() => (q?.again ? [...q.options].reverse() : q?.options || []), [q]);

  const playWord = useCallback(async (slow = false) => {
    if (!q) return;
    const spoken = (q.targetWord || q.questionText).trim();
    if (!spoken) return;
    if (!slow && q.audioSrc) {
      setAudioBusy(true);
      try {
        const src = /^(data|blob):/.test(q.audioSrc) ? q.audioSrc : await fetchAudioData(q.audioSrc);
        const audio = new Audio(src);
        audio.onended = () => setAudioBusy(false);
        audio.onerror = () => setAudioBusy(false);
        await audio.play();
        return;
      } catch {
        setAudioBusy(false);
      }
    }
    speakText(spoken, { rate: slow ? 0.7 : 0.92 });
  }, [q]);

  useEffect(() => {
    if (!ended && q?.ask === 'audio') {
      playWord(false);
    }
  }, [ended, index, q?.ask, playWord]);

  if (ended || !q) {
    return (
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-8 flex flex-col gap-4">
        <div className="text-center flex flex-col gap-1">
          <h2 className="text-2xl font-extrabold text-ink dark:text-white">آزمون تمام شد</h2>
          <p className="tabular-nums"><span className="text-5xl font-extrabold text-brand-500 dark:text-brand-300">{fa(rightFirst)}</span><span className="text-lg text-ink-muted dark:text-slate-400 ms-2">از {fa(total)}</span></p>
          <p className="text-sm text-ink-muted dark:text-slate-400">بار اول درست</p>
        </div>
        {missed.length > 0 ? (
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/30 p-4 flex flex-col gap-3">
            <h3 className="font-bold text-ink dark:text-white">این‌ها را غلط زدی</h3>
            <ul className="flex flex-col gap-2.5">
              {missed.map(({ q: m, chose }, i) => {
                const rightPair = pairOf(m, m.correctAnswer);
                const wrongPair = pairOf(m, chose);
                return (
                  <li key={i} className="flex flex-col gap-0.5 text-sm">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <bdi dir="ltr" className="font-en font-bold text-ink dark:text-white">{rightPair.en}</bdi>
                      {rightPair.faText && <span className="text-ink dark:text-slate-100">{rightPair.faText}</span>}
                    </span>
                    <span className="text-xs text-ink-muted dark:text-slate-400">
                      به جایش زدی: {wrongPair.en ? <bdi dir="ltr" className="font-en">{wrongPair.en}</bdi> : chose}
                      {wrongPair.faText ? ` (${wrongPair.faText})` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-ink-muted dark:text-slate-400">این واژه‌ها به مرور امروزت برگشتند و در «اشتباه‌های من» می‌مانند تا دو بار پشت هم درست جواب بدهی.</p>
          </div>
        ) : (
          <p className="text-center text-emerald-700 dark:text-emerald-300 font-bold">همه را بار اول درست زدی.</p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          {missed.some(m => m.q.cardId) && (
            <button type="button" onClick={() => onRetry(missed.map(m => m.q.cardId).filter((id): id is string => !!id))} className={primary}>دوباره همین‌ها</button>
          )}
          <button type="button" onClick={onDone} className={missed.some(m => m.q.cardId) ? secondary : primary}>{doneLabel}</button>
        </div>
      </section>
    );
  }

  const persianOptions = isPersianAsk(q.ask);
  const wrongPicks = picked.filter(o => o !== q.correctAnswer);
  const firstWrong = wrongPicks[0];
  const meaning = (o: string) => q.meanings?.[o];

  const pick = (option: string) => {
    if (solved || picked.includes(option)) return;
    const right = option === q.correctAnswer;
    const chosenWord = q.optionWords?.[option] || (persianOptions ? meaning(option) || option : option);
    if (picked.length === 0 && !q.again) {
      if (right) setRightFirst(n => n + 1);
      else setMissed(m => [...m, { q, chose: option }]);
      if (q.cardId) onAnswer({ cardId: q.cardId, right, ...(right ? {} : { chose: chosenWord }) });
    }
    const next = [...picked, option];
    setPicked(next);
    if (right || next.length >= MAX_TRIES) {
      setSolved(true);
      // Answered wrong the first time: once more at the end of the quiz.
      if (!q.again && next[0] !== q.correctAnswer) setQueue(list => [...list, { ...q, again: true }]);
    }
  };

  const next = () => {
    setPicked([]);
    setSolved(false);
    setWhy(null);
    if (index + 1 < queue.length) setIndex(index + 1);
    else setEnded(true);
  };

  const askWhy = async () => {
    if (!firstWrong || why?.loading) return;
    const rightPair = pairOf(q, q.correctAnswer);
    const wrongPair = pairOf(q, firstWrong);
    setWhy({ loading: true });
    try {
      const text = await explainChoice({
        questionText: q.sourceSentence || q.questionText,
        correct: rightPair.en || q.correctAnswer,
        correctBack: rightPair.faText,
        chosen: wrongPair.en || firstWrong,
        chosenBack: wrongPair.faText,
      }, aiOptions);
      setWhy({ text });
    } catch (error) {
      console.warn('Explaining a quiz answer failed:', error);
      setWhy({ error: true });
    }
  };

  const englishWord = q.targetWord || q.questionText;
  const hintNode = q.ask === 'meaning'
    ? <>با «<bdi dir="ltr" className="font-en font-bold">{q.correctAnswer[0]}</bdi>» شروع می‌شود و {fa(q.correctAnswer.length)} حرف دارد.</>
    : q.ask === 'word-to-meaning'
      ? (q.hint ? <>در کتاب: <bdi dir="ltr" className="font-en">{q.hint}</bdi></> : null)
      : q.ask === 'audio'
        ? <>با «<bdi dir="ltr" className="font-en font-bold">{englishWord[0]}</bdi>» شروع می‌شود و {fa(englishWord.length)} حرف دارد. دوباره گوش بده.</>
        : q.hint ? <>معنی واژهٔ درست: «{q.hint}».</> : null;

  const promptLabel = q.again
    ? 'این را غلط زده بودی؛ یک بار دیگر.'
    : q.ask === 'meaning'
      ? 'کدام واژه این معنی را دارد؟'
      : q.ask === 'word-to-meaning'
        ? 'معنی درست این واژه کدام است؟'
        : q.ask === 'audio'
          ? 'به تلفظ واژه گوش بده و معنی درستش را انتخاب کن'
          : 'جای خالی را با واژهٔ درست پر کن';

  const rightPair = pairOf(q, q.correctAnswer);
  const firstWrongPair = firstWrong ? pairOf(q, firstWrong) : null;

  return (
    <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-8 flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div className="h-full bg-brand-500 rounded-full transition-all duration-300" style={{ width: `${((index + (solved ? 1 : 0)) / queue.length) * 100}%` }} />
        </div>
        <span className="text-sm text-ink-muted dark:text-slate-400 whitespace-nowrap tabular-nums">پرسش {fa(index + 1)} از {fa(queue.length)}</span>
      </div>

      <div className="text-center flex flex-col items-center gap-2">
        <p className="text-sm text-ink-muted dark:text-slate-400">{promptLabel}</p>
        {q.ask === 'audio' ? (
          <div className="flex flex-col items-center gap-2.5 pt-1">
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => playWord(false)}
                disabled={audioBusy}
                className="inline-flex items-center gap-2 min-h-[48px] px-5 rounded-2xl bg-brand-100 text-brand-700 hover:bg-brand-200 dark:bg-brand-900/60 dark:text-brand-100 dark:hover:bg-brand-900 font-bold transition-colors disabled:opacity-50"
              >
                <Icon.Speaker size={20} />پخش واژه
              </button>
              <button
                type="button"
                onClick={() => playWord(true)}
                className="inline-flex items-center gap-1.5 min-h-[48px] px-4 rounded-2xl border border-slate-200 dark:border-slate-600 text-sm font-bold text-ink dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                آهسته‌تر
              </button>
            </div>
            {solved && (
              <p dir="ltr" className="font-read text-2xl font-bold text-ink dark:text-white pt-1">{englishWord}</p>
            )}
          </div>
        ) : q.ask === 'meaning' ? (
          <h2 className="text-2xl md:text-3xl font-bold text-ink dark:text-white">{q.questionText}</h2>
        ) : (
          <div className="flex items-center justify-center gap-2 max-w-full">
            <h2 dir="ltr" className={`font-read font-bold leading-relaxed text-ink dark:text-white break-words ${q.ask === 'word-to-meaning' ? 'text-2xl md:text-3xl' : 'text-xl md:text-2xl'}`}>
              {q.questionText}
            </h2>
            {q.ask === 'word-to-meaning' && (
              <button
                type="button"
                onClick={() => playWord(false)}
                aria-label="پخش تلفظ"
                className="shrink-0 min-h-[44px] min-w-[44px] rounded-full text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-slate-700 flex items-center justify-center"
              >
                <Icon.Speaker size={20} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {shuffled.map(option => {
          const isRight = option === q.correctAnswer;
          const wasPicked = picked.includes(option);
          const showCounterpart = !!meaning(option) && (solved || (wasPicked && !isRight));
          let tone = 'bg-white dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-ink dark:text-white hover:border-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30';
          if (solved && isRight) tone = 'bg-emerald-50 dark:bg-emerald-900/40 border-emerald-500 text-emerald-900 dark:text-emerald-200';
          else if (wasPicked && !isRight) tone = 'bg-red-50 dark:bg-red-900/40 border-red-500 text-red-900 dark:text-red-200';
          else if (solved) tone = 'bg-slate-50 dark:bg-slate-700 border-transparent text-ink dark:text-slate-200 opacity-70';
          return (
            <button key={option} type="button" onClick={() => pick(option)} disabled={solved || wasPicked}
              className={`min-h-[56px] px-4 py-2.5 rounded-2xl border-2 text-center break-words transition-colors flex flex-col items-center justify-center gap-0.5 ${tone}`}>
              {persianOptions ? (
                <>
                  <span dir="rtl" className="text-base sm:text-lg font-bold">{option}</span>
                  {showCounterpart && <span dir="ltr" className="font-en text-xs opacity-90">{meaning(option)}</span>}
                </>
              ) : (
                <>
                  <span dir="ltr" className="font-en text-lg font-medium">{option}</span>
                  {showCounterpart && <span dir="rtl" className="text-xs opacity-90">{meaning(option)}</span>}
                </>
              )}
            </button>
          );
        })}
      </div>

      {!solved && wrongPicks.length > 0 && (
        <p role="status" className="rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 px-4 py-3 text-sm text-center">
          {persianOptions
            ? <>این نبود{meaning(firstWrong) ? <>: «{firstWrong}» معنی <bdi dir="ltr" className="font-en font-bold">{meaning(firstWrong)}</bdi> است</> : ''}.</>
            : <>این نبود{meaning(firstWrong) ? <>: <bdi dir="ltr" className="font-en font-bold">{firstWrong}</bdi> یعنی «{meaning(firstWrong)}»</> : ''}.</>}
          {' '}{hintNode}{' '}یک بار دیگر انتخاب کن.
        </p>
      )}

      {solved && (
        <>
          <p role="status" className={`text-center font-bold ${picked[0] === q.correctAnswer ? 'text-emerald-700 dark:text-emerald-300' : picked.includes(q.correctAnswer) ? 'text-amber-800 dark:text-amber-200' : 'text-red-700 dark:text-red-300'}`}>
            {picked[0] === q.correctAnswer
              ? 'درست بود!'
              : picked.includes(q.correctAnswer)
                ? 'بار دوم درست شد.'
                : persianOptions
                  ? <>جواب درست: «{q.correctAnswer}» (<bdi dir="ltr" className="font-en">{rightPair.en}</bdi>)</>
                  : <>جواب درست: <bdi dir="ltr" className="font-en">{q.correctAnswer}</bdi></>}
          </p>
          {firstWrongPair && (
            <dl className="rounded-2xl bg-slate-50 dark:bg-slate-700/50 p-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm items-baseline">
              <dt dir="ltr" className="font-en font-bold text-emerald-800 dark:text-emerald-200">✓ {rightPair.en}</dt>
              <dd className="text-ink dark:text-slate-100">{rightPair.faText}</dd>
              <dt dir="ltr" className="font-en font-bold text-red-800 dark:text-red-200">✗ {firstWrongPair.en}</dt>
              <dd className="text-ink dark:text-slate-100">{firstWrongPair.faText || 'این واژه در کارت‌هایت نیست.'}</dd>
            </dl>
          )}
          {q.sourceSentence && (
            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl">
              <p className="text-sm text-ink-muted dark:text-slate-400 font-bold mb-1">جملهٔ کامل</p>
              <p dir="ltr" className="font-en italic text-ink dark:text-slate-200 leading-relaxed break-words">“{q.sourceSentence}”</p>
            </div>
          )}
          {firstWrong && q.ask === 'gap' && (
            why?.text ? (
              <p className="rounded-2xl bg-brand-50 dark:bg-brand-900/30 text-ink dark:text-slate-100 px-4 py-3 text-sm leading-7"><bdi dir="auto">{why.text}</bdi></p>
            ) : (
              <button type="button" onClick={askWhy} disabled={!!why?.loading} className="self-center min-h-[44px] px-4 rounded-xl text-sm font-bold bg-brand-50 text-brand-800 hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-100 disabled:opacity-60">
                {why?.loading ? 'در حال پرسیدن…' : why?.error ? 'هوش مصنوعی جواب نداد؛ دوباره' : 'چرا؟ (توضیح با هوش مصنوعی)'}
              </button>
            )
          )}
          <div className="text-center">
            <button type="button" onClick={next} className={primary}>{index + 1 < queue.length ? 'پرسش بعدی' : 'پایان'}</button>
          </div>
        </>
      )}
    </section>
  );
};
