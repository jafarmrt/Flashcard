// File: /components/practice/MistakesPanel.tsx
// «اشتباه‌های من»: the words answered wrong in the quiz and in listening
// (services/practiceLog), with what they were taken for, and a quiz made of
// just those. A word leaves the list after two right answers in a row.

import React from 'react';
import type { MistakeSummary } from '../../services/practiceLog';
import { fa } from '../common/ui';

const QUIZ_SIZE = 8;

export const MistakesPanel: React.FC<{ summary: MistakeSummary; onQuiz: (cardIds: string[]) => void }> = ({ summary, onQuiz }) => {
  const { words, confusions, answers, right } = summary;
  if (answers === 0) {
    return (
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-6 text-center flex flex-col gap-2">
        <h2 className="text-xl font-extrabold text-ink dark:text-white">هنوز چیزی ثبت نشده</h2>
        <p className="text-ink-muted dark:text-slate-400">جواب‌های آزمون و تمرین شنیدن از این به بعد این‌جا می‌مانند: واژه‌هایی که غلط می‌زنی و واژه‌ای که به جایشان انتخاب می‌کنی.</p>
      </section>
    );
  }
  return (
    <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-extrabold text-ink dark:text-white">اشتباه‌های من</h2>
        <span className="text-sm text-ink-muted dark:text-slate-400">در ۹۰ روز اخیر: {fa(right)} درست از {fa(answers)} جواب</span>
      </div>
      {words.length === 0 ? (
        <p className="text-emerald-700 dark:text-emerald-300 font-bold">واژهٔ بازی نمانده: هر چه غلط زده بودی، بعدش دو بار درست جواب داده‌ای.</p>
      ) : (
        <>
          <button type="button" onClick={() => onQuiz(words.slice(0, QUIZ_SIZE).map(w => w.card.id))}
            className="self-start min-h-[48px] px-6 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold">
            آزمون از {fa(Math.min(QUIZ_SIZE, words.length))} واژهٔ اول
          </button>
          <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
            {words.map(w => (
              <li key={w.card.id} className="py-2.5 flex flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <bdi dir="ltr" className="font-en font-bold text-ink dark:text-white">{w.card.front}</bdi>
                  <span className="text-sm text-ink dark:text-slate-100">{w.card.back}</span>
                  <span className="flex-1" />
                  <span className="text-xs text-red-700 dark:text-red-300 whitespace-nowrap">{fa(w.wrong)} بار غلط از {fa(w.total)}</span>
                </span>
                {w.takenFor.length > 0 && (
                  <span className="text-xs text-ink-muted dark:text-slate-400">به جایش زدی: <bdi dir="ltr" className="font-en">{w.takenFor.slice(0, 3).join(', ')}</bdi></span>
                )}
              </li>
            ))}
          </ul>
          {confusions.some(c => c.count > 1) && (
            <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/30 p-4 flex flex-col gap-1.5 text-sm">
              <h3 className="font-bold text-ink dark:text-white">این‌ها را با هم قاطی می‌کنی</h3>
              {confusions.filter(c => c.count > 1).slice(0, 6).map((c, i) => (
                <p key={i} className="text-ink dark:text-slate-100">
                  <bdi dir="ltr" className="font-en font-bold">{c.card.front}</bdi> ({c.card.back}) و <bdi dir="ltr" className="font-en font-bold">{c.chose}</bdi>{c.choseBack ? ` (${c.choseBack})` : ''} · {fa(c.count)} بار
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
};
