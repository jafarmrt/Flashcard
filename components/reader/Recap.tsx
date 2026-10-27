import React, { useEffect, useState } from 'react';
import type { AiRequestOptions } from '../../services/geminiService';
import { keepRecap, makeRecap, savedRecap, type Recap } from '../../services/recap';
import { fa, Icon } from '../common/ui';

interface RecapProps {
  title: string;
  chapterId: string;
  chunk: number;
  days: number;
  loadTexts: () => Promise<string[]>; // the sections read just before this one
  useAi: boolean;
  aiOptions?: AiRequestOptions;
  onClose: () => void;
}

// Coming back to a book after some days: what happened in the pages read
// last, before reading on.
export const RecapPanel: React.FC<RecapProps> = ({ title, chapterId, chunk, days, loadTexts, useAi, aiOptions, onClose }) => {
  const [recap, setRecap] = useState<Recap | null>(() => savedRecap(chapterId, chunk));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (recap) return;
    let live = true;
    loadTexts()
      .then(texts => (texts.some(t => t.trim()) ? makeRecap(title, texts, useAi, aiOptions) : null))
      .then(r => {
        if (!live) return;
        if (!r || !r.lastLines) { setFailed(true); return; }
        if (r.summary) keepRecap(chapterId, chunk, r);
        setRecap(r);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (failed) onClose(); }, [failed, onClose]);
  if (failed) return null;
  return (
    <div dir="rtl" className="font-fa fixed inset-0 z-40 bg-black/30 flex items-end md:items-center justify-center p-3" onClick={onClose}>
      <section role="dialog" aria-label="تا این‌جا چه گذشت" onClick={e => e.stopPropagation()}
        className="w-full max-w-lg max-h-[80vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3 shadow-2xl animate-reveal">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 font-bold text-ink dark:text-white">تا این‌جا چه گذشت</h2>
          <button type="button" onClick={onClose} aria-label="بستن" className="w-9 h-9 rounded-xl flex items-center justify-center text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700"><Icon.Close size={18} /></button>
        </div>
        <p className="text-sm text-ink-muted dark:text-slate-400">{fa(days)} روز است این کتاب را نخوانده‌ای.</p>
        {!recap ? (
          <p role="status" className="text-ink-muted dark:text-slate-400">در حال آماده کردن یادآوری…</p>
        ) : (
          <>
            {recap.summary && <p dir="ltr" lang="en" className="font-read text-[16px] leading-7 text-ink dark:text-slate-100">{recap.summary}</p>}
            {recap.persian && <p className="leading-7 text-ink dark:text-slate-200">{recap.persian}</p>}
            {recap.lastLines && (
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-3 flex flex-col gap-1">
                <p className="text-xs text-ink-muted dark:text-slate-400">آخرین سطرهایی که خواندی</p>
                <p dir="ltr" lang="en" className="font-read italic text-[15px] leading-7 text-slate-700 dark:text-slate-200">{recap.lastLines}</p>
              </div>
            )}
          </>
        )}
        <button type="button" onClick={onClose} className="min-h-[48px] rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-bold">ادامهٔ خواندن</button>
      </section>
    </div>
  );
};
