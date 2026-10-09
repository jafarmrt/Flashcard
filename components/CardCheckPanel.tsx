import React, { useMemo, useState } from 'react';
import type { Flashcard } from '../types';
import type { AiRequestOptions } from '../services/geminiService';
import { checkReasons, meaningCheckCandidates, REASON_TEXT } from '../services/cardCheck';
import { checkMeanings, MEANING_CHECK_BATCH, type MeaningVerdict } from '../services/meaningCheck';
import { fa } from './common/ui';

interface CardCheckPanelProps {
  cards: Flashcard[]; // the cards of one source
  aiOptions?: AiRequestOptions;
  onCheckCards: (changes: { id: string; back?: string }[]) => Promise<void>;
}

// An AI's verdicts stay for the session, so leaving the page and coming back
// does not ask again.
const verdictCache = new Map<string, MeaningVerdict>();

const Row: React.FC<{
  card: Flashcard;
  verdict?: MeaningVerdict;
  onCheck: (changes: { id: string; back?: string }[]) => Promise<void>;
}> = ({ card, verdict, onCheck }) => {
  const reasons = checkReasons(card);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.back || '');
  const [busy, setBusy] = useState(false);
  const run = async (back?: string) => {
    setBusy(true);
    try {
      await onCheck([{ id: card.id, ...(back !== undefined ? { back } : {}) }]);
    } finally {
      setBusy(false);
    }
  };
  const noMeaning = reasons.includes('no-persian');
  const suggestion = verdict && !verdict.ok ? verdict.suggestion : undefined;

  return (
    <li className="py-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span dir="ltr" className="font-en font-bold text-ink dark:text-white">{card.front}</span>
        <span className={`text-sm ${noMeaning ? 'text-ink-muted italic' : 'text-ink dark:text-slate-200'}`}>{noMeaning ? 'بدون معنی' : card.back}</span>
        <span className="flex-1" />
        {reasons.map(r => (
          <span key={r} className="text-[11px] rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 px-2 py-0.5">{REASON_TEXT[r]}</span>
        ))}
      </div>
      {card.sourceSentence && <p dir="ltr" className="font-read text-[13px] italic text-ink-muted dark:text-slate-400">{card.sourceSentence}</p>}
      {verdict && (
        <div className={`rounded-xl px-3 py-2 text-sm ${verdict.ok ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100' : 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100'}`}>
          {verdict.ok ? 'هوش مصنوعی: معنی درست است.' : (
            <>
              {suggestion ? <>پیشنهاد: <b>{suggestion}</b></> : 'هوش مصنوعی معنی را درست ندانست.'}
              {verdict.note && <span className="block text-xs mt-0.5 opacity-80">{verdict.note}</span>}
            </>
          )}
        </div>
      )}
      {editing ? (
        <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (draft.trim()) run(draft).then(() => setEditing(false)); }}>
          <input autoFocus dir="rtl" value={draft} onChange={e => setDraft(e.target.value)} aria-label={`معنی فارسی ${card.front}`}
            className="flex-1 min-w-[10rem] min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 focus:border-brand-500 focus:outline-none" />
          <button type="submit" disabled={busy || !draft.trim()} className="min-h-[40px] px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold disabled:opacity-40">ذخیره</button>
          <button type="button" onClick={() => setEditing(false)} className="min-h-[40px] px-3 rounded-xl text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700">انصراف</button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {suggestion && (
            <button type="button" disabled={busy} onClick={() => run(suggestion)} className="min-h-[38px] px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold disabled:opacity-40">جایگزین با پیشنهاد</button>
          )}
          {!noMeaning && (
            <button type="button" disabled={busy} onClick={() => run()}
              className={`min-h-[38px] px-4 rounded-xl text-sm font-bold disabled:opacity-40 ${suggestion ? 'border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}>
              {suggestion || (verdict && !verdict.ok) ? 'همان بماند' : 'درسته'}
            </button>
          )}
          <button type="button" onClick={() => { setDraft(suggestion || card.back || ''); setEditing(true); }}
            className="min-h-[38px] px-4 rounded-xl text-sm border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">اصلاح معنی</button>
        </div>
      )}
    </li>
  );
};

// Cards of a book that may be wrong: what the app's own checks found, and,
// when asked, what an AI says about their meaning in the book's sentence.
// Nothing changes until the user confirms or picks a suggestion.
export const CardCheckPanel: React.FC<CardCheckPanelProps> = ({ cards, aiOptions, onCheckCards }) => {
  const [verdicts, setVerdicts] = useState<Map<string, MeaningVerdict>>(() => new Map(verdictCache));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const live: Flashcard[] = useMemo(() => cards.filter(c => !c.isDeleted && !c.checkedAt), [cards]);
  const rows: Flashcard[] = useMemo(() => live
    .filter(c => checkReasons(c).length > 0 || verdicts.has(c.id))
    .sort((a, b) => Number(verdicts.has(b.id) && !verdicts.get(b.id)!.ok) - Number(verdicts.has(a.id) && !verdicts.get(a.id)!.ok)), [live, verdicts]);
  const waiting: Flashcard[] = useMemo(() => meaningCheckCandidates(live).filter(c => !verdicts.has(c.id)), [live, verdicts]);

  const askAi = async () => {
    setBusy(true);
    setError('');
    try {
      const { verdicts: found } = await checkMeanings(waiting.slice(0, MEANING_CHECK_BATCH), aiOptions);
      found.forEach(v => verdictCache.set(v.cardId, v));
      setVerdicts(new Map(verdictCache));
      if (found.length === 0) setError('پاسخ هوش مصنوعی دربارهٔ این کارت‌ها چیزی نداشت. دوباره امتحان کن.');
    } catch (e) {
      setError((e as Error)?.message || 'چک معنی انجام نشد.');
    } finally {
      setBusy(false);
    }
  };

  // Every card with an answer: suggestions taken, right meanings confirmed.
  const answered = rows.filter(c => verdicts.get(c.id)?.ok || verdicts.get(c.id)?.suggestion);
  const acceptAll = () => onCheckCards(answered.map(c => {
    const v = verdicts.get(c.id)!;
    return v.ok ? { id: c.id } : { id: c.id, back: v.suggestion };
  }));
  const confirmAll = () => onCheckCards(rows.filter(c => !checkReasons(c).includes('no-persian')).map(c => ({ id: c.id })));

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3">
        <h2 className="text-lg font-extrabold text-ink dark:text-white">چک معنی با هوش مصنوعی</h2>
        <p className="text-sm text-ink-muted dark:text-slate-400">
          هوش مصنوعی معنی هر کارت را با جملهٔ همین کتاب می‌سنجد و اگر جور نباشد، معنی بهتری پیشنهاد می‌دهد. چیزی بی‌اجازهٔ تو عوض نمی‌شود.
          {waiting.length > 0 ? ` ${fa(waiting.length)} کارت منتظر چک است (کارت‌های علامت‌خورده و کارت‌هایی که دیکشنری ساخته).` : ' کارتی منتظر چک نیست.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={askAi} disabled={busy || waiting.length === 0}
            className="min-h-[44px] px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold disabled:opacity-40">
            {busy ? 'در حال چک…' : `چک ${fa(Math.min(MEANING_CHECK_BATCH, waiting.length))} کارت`}
          </button>
          {answered.length > 0 && (
            <button type="button" onClick={acceptAll} className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-bold">
              پذیرفتن همهٔ پاسخ‌ها ({fa(answered.length)})
            </button>
          )}
        </div>
        {error && <p role="alert" dir="auto" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      </section>

      <section className="bg-white dark:bg-slate-800 rounded-3xl p-5">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-lg font-extrabold text-ink dark:text-white">نیاز به بررسی ({fa(rows.length)})</h2>
          {rows.length > 1 && (
            <button type="button" onClick={confirmAll} className="min-h-[38px] px-3 rounded-xl text-sm text-emerald-800 dark:text-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/30">همه درست‌اند</button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted dark:text-slate-400">همهٔ کارت‌های این منبع سالم به نظر می‌رسند.</p>
        ) : (
          <ul className="mt-1 flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
            {rows.map(card => <Row key={card.id} card={card} verdict={verdicts.get(card.id)} onCheck={onCheckCards} />)}
          </ul>
        )}
      </section>
    </div>
  );
};
