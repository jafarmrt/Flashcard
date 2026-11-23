// File: /components/practice/ListeningPractice.tsx
// Listening from the books (services/dictation): a sentence is read aloud,
// you write what you hear, and the sentence comes back word by word: right,
// nearly, another word, or left out. The word you are learning is
// underlined; its meaning is a tap away when the ear needs a hint.

import React, { useEffect, useRef, useState } from 'react';
import { checkDictation, type DictationItem, type DictationResult } from '../../services/dictation';
import { focusIndexes, speechTokens, type HeardWord } from '../../services/speechPractice';
import { isSpeechSupported, speakText, stopSpeech } from '../../services/ttsService';
import { fa, Icon } from '../common/ui';

const button = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-2xl font-bold';
const MARK: Record<string, string> = {
  ok: 'text-emerald-700 dark:text-emerald-300',
  close: 'text-amber-700 dark:text-amber-300 underline decoration-dotted',
  wrong: 'text-red-700 dark:text-red-300 line-through decoration-red-400/70',
  missed: 'text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-700 rounded px-0.5',
};

// A sentence counts as heard when most of it was written right and the
// card's own word was caught.
const HEARD_SCORE = 80;

export const ListeningPractice: React.FC<{ items: DictationItem[]; onDone: () => void; onAnswer?: (cardId: string, right: boolean, score: number) => void }> = ({ items, onDone, onAnswer }) => {
  const [at, setAt] = useState(0);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<DictationResult | null>(null);
  const [hint, setHint] = useState(false);
  const [scores, setScores] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const item = items[at];

  const play = (rate = 0.95) => { if (item) speakText(item.sentence, { rate }); };

  // Each sentence is heard once by itself; then as often as you like.
  useEffect(() => {
    if (!item || done) return;
    const timer = setTimeout(() => play(), 300);
    input.current?.focus();
    return () => { clearTimeout(timer); stopSpeech(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, done]);

  if (!isSpeechSupported()) {
    return <p className="text-center text-ink-muted dark:text-slate-400 py-10">این مرورگر صدای خواندن ندارد؛ تمرین شنیدن را در مرورگر دیگری امتحان کن.</p>;
  }

  if (done || !item) {
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    return (
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-8 text-center flex flex-col items-center gap-3">
        <h2 className="text-2xl font-extrabold text-ink dark:text-white">تمرین شنیدن تمام شد</h2>
        <p><span className="text-6xl font-extrabold text-brand-500 dark:text-brand-300">{fa(avg)}</span><span className="text-xl text-ink-muted dark:text-slate-400 ms-2">از ۱۰۰</span></p>
        <p className="text-ink-muted dark:text-slate-400">میانگین درستیِ نوشته‌هایت در {fa(scores.length)} جمله</p>
        <button type="button" onClick={onDone} className={`${button} bg-brand-500 hover:bg-brand-600 text-white mt-2`}>برگشت</button>
      </section>
    );
  }

  const check = () => {
    if (!typed.trim()) return;
    const r = checkDictation(item, typed);
    setResult(r);
    setScores(s => [...s, r.score]);
    onAnswer?.(item.cardId, r.focusOk && r.score >= HEARD_SCORE, r.score);
  };
  const next = () => {
    stopSpeech();
    setResult(null);
    setTyped('');
    setHint(false);
    if (at + 1 < items.length) setAt(at + 1);
    else setDone(true);
  };

  const focus = new Set(focusIndexes(item.sentence, item.front));
  const statusOf = new Map<number, HeardWord>((result?.words || []).map(w => [w.i, w]));

  return (
    <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-8 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${((at + (result ? 1 : 0)) / items.length) * 100}%` }} />
        </div>
        <span className="text-sm text-ink-muted dark:text-slate-400 whitespace-nowrap">جملهٔ {fa(at + 1)} از {fa(items.length)}</span>
      </div>

      <p className="text-center text-sm text-ink-muted dark:text-slate-400">جمله‌ای از کتاب‌هایت خوانده می‌شود؛ همان را که می‌شنوی بنویس.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => play()} className={`${button} bg-brand-500 hover:bg-brand-600 text-white`}><Icon.Speaker size={18} />دوباره بشنو</button>
        <button type="button" onClick={() => play(0.7)} className={`${button} bg-slate-100 dark:bg-slate-700 text-ink dark:text-white`}>آهسته</button>
        {!result && (
          <button type="button" onClick={() => setHint(h => !h)} aria-expanded={hint} className={`${button} bg-slate-100 dark:bg-slate-700 text-ink dark:text-white`}>
            {hint ? <>واژهٔ تو: <bdi dir="ltr" className="font-en">{item.front}</bdi> · {item.back}</> : 'راهنما'}
          </button>
        )}
      </div>

      {result ? (
        <>
          <p dir="ltr" className="font-read text-xl leading-relaxed text-center">
            {speechTokens(item.sentence).map((t, k) => (t.i === undefined ? <span key={k}>{t.text}</span> : (
              <span key={k} className={`${MARK[statusOf.get(t.i)?.status || 'missed']} ${focus.has(t.i) ? 'font-bold' : ''}`}
                title={statusOf.get(t.i)?.heard ? `نوشتی: ${statusOf.get(t.i)!.heard}` : undefined}>{t.text}</span>
            )))}
          </p>
          <p className="text-center text-sm text-ink-muted dark:text-slate-400">
            نوشتی: <bdi dir="ltr" className="font-en">{typed}</bdi>
          </p>
          <p className={`text-center font-bold ${result.score >= 85 ? 'text-emerald-700 dark:text-emerald-300' : result.score >= 60 ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300'}`}>
            <span>{fa(result.score)} از ۱۰۰</span>
            <span className="block text-sm mt-1">
              «<bdi dir="ltr" className="font-en">{item.front}</bdi>»{result.focusOk ? ' را درست شنیدی.' : <> ({item.back}) را دوباره گوش کن.</>}
            </span>
          </p>
          <p className="flex flex-wrap justify-center gap-3 text-xs text-ink-muted dark:text-slate-400">
            <span className={MARK.ok}>درست</span><span className={MARK.close}>نزدیک</span><span className={MARK.wrong}>واژهٔ دیگر</span><span className={MARK.missed}>جاافتاده</span>
          </p>
          <div className="text-center">
            <button type="button" onClick={next} className={`${button} bg-brand-500 hover:bg-brand-600 text-white`}>{at + 1 < items.length ? 'جملهٔ بعد' : 'پایان'}</button>
          </div>
        </>
      ) : (
        <form onSubmit={e => { e.preventDefault(); check(); }} className="flex flex-col gap-3">
          <textarea ref={input} dir="ltr" lang="en" rows={3} value={typed} onChange={e => setTyped(e.target.value)} autoCapitalize="off" autoComplete="off" spellCheck={false}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); check(); } }}
            placeholder="Write what you hear…" aria-label="آنچه می‌شنوی"
            className="w-full font-en text-lg px-4 py-3 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-brand-500 focus:outline-none" />
          <div className="flex justify-center gap-2">
            <button type="submit" disabled={!typed.trim()} className={`${button} bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50`}>بررسی</button>
            <button type="button" onClick={next} className={`${button} text-ink-muted dark:text-slate-300`}>رد شدن</button>
          </div>
        </form>
      )}
    </section>
  );
};
