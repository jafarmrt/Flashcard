import React, { useMemo, useState } from 'react';
import { TextDoc } from '../types';
import type { View } from '../hooks/useAppLogic';
import { splitIntoChunks, wordCount } from '../services/textChunker';
import { currentChunk, isChunkUnlocked, isTextFinished, textWordCount } from '../services/textLibrary';
import { isChestSection } from '../services/xpRules';
import { fa, Icon } from './common/ui';

interface TextsViewProps {
  texts: TextDoc[];
  activeTextId: string | null;
  onCreateText: (title: string, text: string) => void;
  onOpenText: (textId: string | null) => void;
  onOpenChunk: (textId: string, index: number) => void;
  onDeleteText: (textId: string) => void;
  onNavigate: (view: View) => void;
}

const NewTextForm: React.FC<{ onCreate: (title: string, text: string) => void; onCancel?: () => void }> = ({ onCreate, onCancel }) => {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const words = wordCount(text);
  const sections = useMemo(() => (words > 0 ? splitIntoChunks(text).length : 0), [text, words]);
  return (
    <form onSubmit={e => { e.preventDefault(); if (words > 0) onCreate(title, text); }}
      className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3">
      <h2 className="font-bold text-ink dark:text-white">متن تازه</h2>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-ink-muted dark:text-slate-400">عنوان</span>
        <input dir="auto" value={title} onChange={e => setTitle(e.target.value)} placeholder="مثلاً فصل اول کتاب"
          className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-brand-500 focus:outline-none" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-ink-muted dark:text-slate-400">متن انگلیسی</span>
        <textarea dir="ltr" value={text} onChange={e => setText(e.target.value)} rows={8} placeholder="Paste an English text here…"
          className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 font-read text-[15px] leading-7 focus:border-brand-500 focus:outline-none" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={words === 0} className="min-h-[48px] px-6 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold disabled:opacity-40">
          ساختن مسیر
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="min-h-[48px] px-4 rounded-2xl text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700">انصراف</button>}
        {words > 0 && <span className="text-sm text-ink-muted dark:text-slate-400">{fa(words)} واژه · {fa(sections)} بخش</span>}
      </div>
    </form>
  );
};

// A text as a path of stations, one per 300-word section, with a chest every third.
const TextPath: React.FC<{ doc: TextDoc; onOpenChunk: (i: number) => void; onBack: () => void; onDelete: () => void }> = ({ doc, onOpenChunk, onBack, onDelete }) => {
  const current = currentChunk(doc);
  const finished = isTextFinished(doc);
  const offsets = [0, 56, 84, 56, 0, -56, -84, -56]; // zigzag in px
  return (
    <div className="flex flex-col gap-5">
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} aria-label="همهٔ متن‌ها" className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700"><Icon.Back /></button>
          <h1 dir="auto" className="flex-1 font-en font-bold text-xl text-ink dark:text-white truncate">{doc.title}</h1>
          <button type="button" onClick={() => { if (confirm('این متن حذف شود؟ کارت‌هایی که از آن ساخته‌ای می‌مانند.')) onDelete(); }}
            className="text-sm text-red-700 dark:text-red-300 hover:underline">حذف</button>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1">{fa(textWordCount(doc))} واژه · {fa(doc.chunks.length)} بخش</span>
          <span className="rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100 px-3 py-1">{fa(doc.completed.length)} بخش تمام شد</span>
          <span className="rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200 px-3 py-1">دسته: <span dir="auto">{doc.deckName}</span></span>
        </div>
      </div>

      <ol className="flex flex-col items-center gap-5 py-4" aria-label="بخش‌های متن">
        {doc.chunks.map((chunk, i) => {
          const done = doc.completed.includes(i);
          const isCurrent = !finished && i === current;
          const unlocked = isChunkUnlocked(doc, i);
          const preview = chunk.split(/\s+/).slice(0, 6).join(' ');
          return (
            <React.Fragment key={i}>
              <li className="flex flex-col items-center gap-1.5" style={{ transform: `translateX(${offsets[i % offsets.length]}px)` }}>
                {isCurrent && <span className="rounded-xl bg-ink text-white dark:bg-white dark:text-ink px-3 py-1 text-xs font-bold">اینجایی</span>}
                <button type="button" disabled={!unlocked} onClick={() => onOpenChunk(i)}
                  aria-label={`بخش ${fa(i + 1)}${done ? '، تمام شده' : unlocked ? '' : '، قفل'}`}
                  className={`rounded-full flex items-center justify-center transition-transform hover:scale-105 disabled:hover:scale-100 ${isCurrent
                    ? 'w-20 h-20 bg-brand-500 text-white shadow-[0_6px_0_#2E2591] ring-8 ring-brand-200 dark:ring-brand-900'
                    : done ? 'w-16 h-16 bg-emerald-600 text-white shadow-[0_5px_0_#1D6B40]'
                    : 'w-16 h-16 bg-slate-200 text-slate-500 shadow-[0_5px_0_#CDD1DE] dark:bg-slate-700 dark:text-slate-400 dark:shadow-[0_5px_0_#334155]'}`}>
                  {done ? <Icon.Check size={26} /> : isCurrent ? <Icon.Book size={32} /> : <Icon.Lock size={22} />}
                </button>
                <span className={`text-xs ${isCurrent ? 'font-bold text-ink dark:text-white' : 'text-ink-muted dark:text-slate-400'}`}>بخش {fa(i + 1)}</span>
                {isCurrent && <span dir="ltr" className="font-read text-xs text-ink-muted dark:text-slate-400 max-w-[14rem] truncate">{preview}…</span>}
              </li>
              {isChestSection(i) && i < doc.chunks.length - 1 && (
                <li className="flex flex-col items-center gap-1" aria-label="صندوق جایزه">
                  <span className={`w-14 h-14 rounded-2xl flex items-center justify-center ${done ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-amber-50 text-amber-700 dark:bg-slate-800 dark:text-amber-300'}`}>
                    <Icon.Gift size={26} />
                  </span>
                  <span className="text-[11px] text-ink-muted dark:text-slate-400">{done ? 'محافظ زنجیره گرفتی' : 'جایزه: محافظ زنجیره'}</span>
                </li>
              )}
            </React.Fragment>
          );
        })}
      </ol>

      {!finished ? (
        <button type="button" onClick={() => onOpenChunk(current)}
          className="sticky bottom-24 md:bottom-6 self-center min-h-[56px] px-10 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold text-lg shadow-lg">
          {doc.completed.length === 0 ? 'شروع بخش ۱' : `ادامهٔ بخش ${fa(current + 1)}`}
        </button>
      ) : (
        <p className="text-center font-bold text-emerald-700 dark:text-emerald-300">همهٔ بخش‌های این متن را تمام کردی.</p>
      )}
    </div>
  );
};

export const TextsView: React.FC<TextsViewProps> = ({ texts, activeTextId, onCreateText, onOpenText, onOpenChunk, onDeleteText, onNavigate }) => {
  const [adding, setAdding] = useState(false);
  const visible = texts.filter(t => !t.isDeleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const active = visible.find(t => t.id === activeTextId);

  return (
    <div dir="rtl" className="font-fa flex flex-col gap-5 max-w-3xl mx-auto w-full">
      {active ? (
        <TextPath doc={active} onOpenChunk={i => onOpenChunk(active.id, i)} onBack={() => onOpenText(null)} onDelete={() => onDeleteText(active.id)} />
      ) : (
        <>
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold text-ink dark:text-white">متن‌ها</h1>
              <p className="text-sm text-ink-muted dark:text-slate-400">هر متن به بخش‌های ۳۰۰ واژه‌ای تقسیم می‌شود و بخش به بخش جلو می‌روی.</p>
            </div>
            <div className="flex gap-2">
              {!adding && visible.length > 0 && (
                <button type="button" onClick={() => setAdding(true)} className="min-h-[44px] px-4 rounded-xl bg-ink text-white dark:bg-white dark:text-ink font-bold inline-flex items-center gap-1.5">
                  <Icon.Plus size={18} />متن تازه
                </button>
              )}
              <button type="button" onClick={() => onNavigate('AI_EXTRACT')} className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800"
                title="کل متن را یکجا تحلیل کن، با همهٔ گزینه‌های پیشرفته">
                استخراج یکجا
              </button>
            </div>
          </header>

          {(adding || visible.length === 0) && (
            <NewTextForm onCreate={(t, x) => { setAdding(false); onCreateText(t, x); }} onCancel={visible.length > 0 ? () => setAdding(false) : undefined} />
          )}

          {visible.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {visible.map(t => {
                const pct = Math.round((t.completed.length / Math.max(1, t.chunks.length)) * 100);
                return (
                  <li key={t.id}>
                    <button type="button" onClick={() => onOpenText(t.id)} className="w-full text-right bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3 hover:ring-2 hover:ring-brand-200 dark:hover:ring-brand-800">
                      <span dir="auto" className="font-en font-bold text-ink dark:text-white truncate">{t.title}</span>
                      <span className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden flex">
                        <span className={`${isTextFinished(t) ? 'bg-emerald-600' : 'bg-brand-500'} rounded-full`} style={{ width: `${pct}%` }} />
                      </span>
                      <span className="text-sm text-ink-muted dark:text-slate-400">
                        {isTextFinished(t) ? 'تمام شد' : `بخش ${fa(currentChunk(t) + 1)} از ${fa(t.chunks.length)}`} · {fa(textWordCount(t))} واژه
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
};
