// File: /components/practice/QuizPractice.tsx
// The four-choice quiz. A wrong answer teaches something here: the choice
// picked shows what it means, a hint is given and a second try allowed;
// then the right word and the picked one stand side by side with their
// meanings (from the user's own cards), and «چرا؟» asks the AI for the
// difference in this sentence. A question answered wrong comes back at the
// end, and the quiz ends with the list of what went wrong, to try again.
// (It used to say only "the right answer: X" and a score.)

import React, { useMemo, useState } from 'react';
import type { AiRequestOptions } from '../../services/geminiService';
import { explainChoice } from '../../services/quizExplain';
import { fa } from '../common/ui';

export interface QuizQuestion {
  cardId?: string;
  questionText: string;
  sourceSentence: string;
  ask?: 'gap' | 'meaning';
  options: string[];
  correctAnswer: string;
  hint?: string; // the right word's Persian meaning
  meanings?: Record<string, string>;
}

export interface QuizFirstAnswer { cardId: string; right: boolean; chose?: string }

interface QuizPracticeProps {
  questions: QuizQuestion[];
  aiOptions?: AiRequestOptions;
  onAnswer: (answer: QuizFirstAnswer) => void; // the first answer to each question
  onRetry: (cardIds: string[]) => void; // a new quiz from the cards that went wrong
  onDone: () => void;
}

type Asked = QuizQuestion & { again?: boolean };
const MAX_TRIES = 2;
const primary = 'inline-flex items-center justify-center gap-2 min-h-[52px] px-8 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center min-h-[48px] px-6 rounded-2xl font-bold text-ink dark:text-white bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600';

export const QuizPractice: React.FC<QuizPracticeProps> = ({ questions, aiOptions, onAnswer, onRetry, onDone }) => {
  const [queue, setQueue] = useState<Asked[]>(questions);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string[]>([]); // the choices tapped for this question, in order
  const [solved, setSolved] = useState(false);
  const [missed, setMissed] = useState<{ q: QuizQuestion; chose: string }[]>([]);
  const [rightFirst, setRightFirst] = useState(0);
  const [why, setWhy] = useState<{ loading?: boolean; text?: string; error?: boolean } | null>(null);
  const [ended, setEnded] = useState(false);
  const total = questions.length;
  const q = queue[index];
  const shuffled = useMemo(() => (q?.again ? [...q.options].reverse() : q?.options || []), [q]);

  if (ended || !q) {
    return (
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-8 flex flex-col gap-4">
        <div className="text-center flex flex-col gap-1">
          <h2 className="text-2xl font-extrabold text-ink dark:text-white">آزمون تمام شد</h2>
          <p><span className="text-5xl font-extrabold text-brand-500 dark:text-brand-300">{fa(rightFirst)}</span><span className="text-lg text-ink-muted dark:text-slate-400 ms-2">از {fa(total)}</span></p>
          <p className="text-sm text-ink-muted dark:text-slate-400">بار اول درست</p>
        </div>
        {missed.length > 0 ? (
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/30 p-4 flex flex-col gap-3">
            <h3 className="font-bold text-ink dark:text-white">این‌ها را غلط زدی</h3>
            <ul className="flex flex-col gap-2.5">
              {missed.map(({ q: m, chose }, i) => (
                <li key={i} className="flex flex-col gap-0.5 text-sm">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <bdi dir="ltr" className="font-en font-bold text-ink dark:text-white">{m.correctAnswer}</bdi>
                    {m.hint && <span className="text-ink dark:text-slate-100">{m.hint}</span>}
                  </span>
                  <span className="text-xs text-ink-muted dark:text-slate-400">
                    به جایش زدی: <bdi dir="ltr" className="font-en">{chose}</bdi>{m.meanings?.[chose] ? ` (${m.meanings[chose]})` : ''}
                  </span>
                </li>
              ))}
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
          <button type="button" onClick={onDone} className={secondary}>برگشت</button>
        </div>
      </section>
    );
  }

  const wrongPicks = picked.filter(o => o !== q.correctAnswer);
  const firstWrong = wrongPicks[0];
  const meaning = (o: string) => q.meanings?.[o];

  const pick = (option: string) => {
    if (solved || picked.includes(option)) return;
    const right = option === q.correctAnswer;
    if (picked.length === 0 && !q.again) {
      if (right) setRightFirst(n => n + 1);
      else setMissed(m => [...m, { q, chose: option }]);
      if (q.cardId) onAnswer({ cardId: q.cardId, right, ...(right ? {} : { chose: option }) });
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
    setWhy({ loading: true });
    try {
      const text = await explainChoice({ questionText: q.questionText, correct: q.correctAnswer, correctBack: meaning(q.correctAnswer) || q.hint, chosen: firstWrong, chosenBack: meaning(firstWrong) }, aiOptions);
      setWhy({ text });
    } catch (error) {
      console.warn('Explaining a quiz answer failed:', error);
      setWhy({ error: true });
    }
  };

  const hintText = q.ask === 'meaning'
    ? `با «${q.correctAnswer[0]}» شروع می‌شود و ${fa(q.correctAnswer.length)} حرف دارد.`
    : q.hint ? `معنی واژهٔ درست: «${q.hint}».` : '';

  return (
    <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-8 flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div className="h-full bg-brand-500 rounded-full transition-all duration-300" style={{ width: `${((index + (solved ? 1 : 0)) / queue.length) * 100}%` }} />
        </div>
        <span className="text-sm text-ink-muted dark:text-slate-400 whitespace-nowrap">پرسش {fa(index + 1)} از {fa(queue.length)}</span>
      </div>

      <div className="text-center flex flex-col gap-2">
        <p className="text-sm text-ink-muted dark:text-slate-400">
          {q.again ? 'این را غلط زده بودی؛ یک بار دیگر.' : q.ask === 'meaning' ? 'کدام واژه این معنی را دارد؟' : 'جای خالی را با واژهٔ درست پر کن'}
        </p>
        {q.ask === 'meaning'
          ? <h2 className="text-2xl md:text-3xl font-bold text-ink dark:text-white">{q.questionText}</h2>
          : <h2 dir="ltr" className="font-en text-xl md:text-2xl font-bold leading-relaxed text-ink dark:text-white break-words">{q.questionText}</h2>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {shuffled.map(option => {
          const isRight = option === q.correctAnswer;
          const wasPicked = picked.includes(option);
          const showMeaning = !!meaning(option) && (solved || (wasPicked && !isRight));
          let tone = 'bg-white dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-ink dark:text-white hover:border-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30';
          if (solved && isRight) tone = 'bg-emerald-50 dark:bg-emerald-900/40 border-emerald-500 text-emerald-900 dark:text-emerald-200';
          else if (wasPicked && !isRight) tone = 'bg-red-50 dark:bg-red-900/40 border-red-500 text-red-900 dark:text-red-200';
          else if (solved) tone = 'bg-slate-50 dark:bg-slate-700 border-transparent text-ink dark:text-slate-200 opacity-70';
          return (
            <button key={option} type="button" onClick={() => pick(option)} disabled={solved || wasPicked}
              className={`min-h-[56px] px-4 py-2.5 rounded-2xl border-2 text-center break-words transition-colors flex flex-col items-center justify-center gap-0.5 ${tone}`}>
              <span dir="ltr" className="font-en text-lg font-medium">{option}</span>
              {showMeaning && <span className="text-xs opacity-90">{meaning(option)}</span>}
            </button>
          );
        })}
      </div>

      {!solved && wrongPicks.length > 0 && (
        <p role="status" className="rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 px-4 py-3 text-sm text-center">
          این نبود{meaning(firstWrong) ? <>: <bdi dir="ltr" className="font-en font-bold">{firstWrong}</bdi> یعنی «{meaning(firstWrong)}»</> : ''}. {hintText} یک بار دیگر انتخاب کن.
        </p>
      )}

      {solved && (
        <>
          <p role="status" className={`text-center font-bold ${picked[0] === q.correctAnswer ? 'text-emerald-700 dark:text-emerald-300' : picked.includes(q.correctAnswer) ? 'text-amber-800 dark:text-amber-200' : 'text-red-700 dark:text-red-300'}`}>
            {picked[0] === q.correctAnswer ? 'درست بود!' : picked.includes(q.correctAnswer) ? 'بار دوم درست شد.' : <>جواب درست: <bdi dir="ltr" className="font-en">{q.correctAnswer}</bdi></>}
          </p>
          {firstWrong && (
            <dl className="rounded-2xl bg-slate-50 dark:bg-slate-700/50 p-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm items-baseline">
              <dt dir="ltr" className="font-en font-bold text-emerald-800 dark:text-emerald-200">✓ {q.correctAnswer}</dt>
              <dd className="text-ink dark:text-slate-100">{meaning(q.correctAnswer) || q.hint || ''}</dd>
              <dt dir="ltr" className="font-en font-bold text-red-800 dark:text-red-200">✗ {firstWrong}</dt>
              <dd className="text-ink dark:text-slate-100">{meaning(firstWrong) || 'این واژه در کارت‌هایت نیست.'}</dd>
            </dl>
          )}
          {q.sourceSentence && (
            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl">
              <p className="text-sm text-ink-muted dark:text-slate-400 font-bold mb-1">جملهٔ کامل</p>
              <p dir="ltr" className="font-en italic text-ink dark:text-slate-200 leading-relaxed break-words">“{q.sourceSentence}”</p>
            </div>
          )}
          {firstWrong && q.ask !== 'meaning' && (
            why?.text ? (
              <p className="rounded-2xl bg-brand-50 dark:bg-brand-900/30 text-ink dark:text-slate-100 px-4 py-3 text-sm leading-7"><bdi dir="auto">{why.text}</bdi></p>
            ) : (
              <button type="button" onClick={askWhy} disabled={!!why?.loading} className="self-center min-h-[40px] px-4 rounded-xl text-sm font-bold bg-brand-50 text-brand-800 hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-100 disabled:opacity-60">
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
