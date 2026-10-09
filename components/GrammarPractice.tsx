import React, { useEffect, useRef, useState } from 'react';
import type { Flashcard } from '../types';
import type { PerformanceRating } from '../services/srsService';
import type { AiRequestOptions } from '../services/geminiService';
import { checkPracticeWithAi, ruleCheck, ruleOfCard, suggestRating, type PracticeFeedback } from '../services/practiceCheck';

interface GrammarPracticeProps {
  card: Flashcard;
  revealed: boolean;
  aiOptions?: AiRequestOptions;
  onReveal: () => void;
  onSuggest: (rating: PerformanceRating | undefined) => void;
}

// Sentence building for a grammar card: the learner writes a sentence with
// the structure; the app's rule says at once whether the structure is
// there, and an AI points out mistakes with a short Persian explanation.
// The result suggests a rating; the learner still picks one.
export const GrammarPractice: React.FC<GrammarPracticeProps> = ({ card, revealed, aiOptions, onReveal, onSuggest }) => {
  const [sentence, setSentence] = useState('');
  const [checked, setChecked] = useState('');
  const [rule, setRule] = useState<boolean | undefined>(undefined);
  const [ai, setAi] = useState<PracticeFeedback | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const hasRule = !!ruleOfCard(card);

  const check = async () => {
    const text = sentence.trim();
    if (!text) return;
    const byRule = ruleCheck(card, text);
    setChecked(text);
    setRule(byRule);
    setAi(null);
    setAiError('');
    onSuggest(suggestRating(byRule, null));
    onReveal();
    setAiBusy(true);
    try {
      const feedback = await checkPracticeWithAi(card, text, aiOptions);
      if (!alive.current) return;
      setAi(feedback);
      onSuggest(suggestRating(byRule, feedback));
    } catch (e) {
      if (alive.current) setAiError((e as Error)?.message || 'چک هوش مصنوعی انجام نشد.');
    } finally {
      if (alive.current) setAiBusy(false);
    }
  };

  if (revealed && !checked) return null;

  return (
    <div className="flex flex-col gap-3 w-full max-w-xl self-center">
      {!revealed ? (
        <form onSubmit={e => { e.preventDefault(); check(); }} className="flex flex-col gap-3">
          <label htmlFor="practice-sentence" className="text-sm text-ink-muted dark:text-slate-400 text-center">
            یک جملهٔ انگلیسی با همین ساختار بنویس
          </label>
          <textarea id="practice-sentence" dir="ltr" rows={2} value={sentence} onChange={e => setSentence(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); check(); } }}
            placeholder="Write your own sentence…" autoComplete="off" spellCheck
            className="w-full font-en text-lg px-4 py-3 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-brand-500 focus:outline-none resize-none" />
          <div className="flex flex-wrap justify-center gap-2">
            <button type="submit" disabled={!sentence.trim()} className="min-h-[52px] px-8 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold disabled:opacity-40">بررسی جمله</button>
            <button type="button" onClick={onReveal} className="min-h-[52px] px-5 rounded-2xl text-ink-muted dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">فقط نمایش پاسخ</button>
          </div>
        </form>
      ) : (
        <div role="status" className="flex flex-col gap-2 rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-4">
          <p dir="ltr" className="font-en text-lg text-ink dark:text-white">{checked}</p>
          {rule !== undefined && (
            <p className={`text-sm font-bold ${rule ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
              {rule ? 'ساختار در جمله‌ات هست.' : 'برنامه این ساختار را در جمله‌ات پیدا نکرد.'}
            </p>
          )}
          {aiBusy && <p className="text-sm text-ink-muted dark:text-slate-400">هوش مصنوعی جمله را می‌خواند…</p>}
          {aiError && <p dir="auto" className="text-sm text-amber-800 dark:text-amber-200">چک هوش مصنوعی انجام نشد{hasRule ? '؛ پیشنهاد امتیاز فقط از قاعدهٔ برنامه است' : ''}. <span className="opacity-80">{aiError}</span></p>}
          {ai && (
            <>
              {!ai.usesStructure && <p className="text-sm font-bold text-red-700 dark:text-red-300">به نظر هوش مصنوعی، این جمله ساختار کارت را ندارد.</p>}
              {ai.feedback && <p className="text-sm text-ink dark:text-slate-100">{ai.feedback}</p>}
              {ai.mistakes.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {ai.mistakes.map((m, i) => (
                    <li key={i} className="text-sm">
                      <span dir="ltr" className="font-en line-through text-red-700 dark:text-red-300">{m.wrong}</span>
                      {' ← '}
                      <span dir="ltr" className="font-en font-bold text-emerald-700 dark:text-emerald-300">{m.right}</span>
                      {m.why && <span className="block text-xs text-ink-muted dark:text-slate-400">{m.why}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {ai.corrected && ai.corrected !== checked && (
                <p className="text-sm text-ink-muted dark:text-slate-400">شکل درست: <bdi dir="ltr" className="font-en text-ink dark:text-white">{ai.corrected}</bdi></p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
