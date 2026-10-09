import React, { useMemo, useState } from 'react';
import type { SourceKind } from '../types';
import { callProxy } from '../services/apiService';
import { importArticle, importEpub, ImportedSource, importPlainText, splitLongChapters, splitTextIntoChapters, suggestedChapter } from '../services/importers';
import { splitIntoChunks, wordCount } from '../services/textChunker';
import { fa, Icon } from './common/ui';

type Tab = 'paste' | 'file' | 'link';

const KIND_NAMES: Record<SourceKind, string> = { book: 'کتاب', article: 'مقاله', text: 'متن' };

const inputClass = 'min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-brand-500 focus:outline-none';

interface AddSourceFormProps {
  onAdd: (source: ImportedSource) => Promise<boolean>;
  onCancel?: () => void;
}

// Adds a book, an article or a text to the library: paste it, pick a .txt or
// .epub file, or give an article's link. Anything with chapters is shown
// first, so front matter and contents pages can be left out.
export const AddSourceForm: React.FC<AddSourceFormProps> = ({ onAdd, onCancel }) => {
  const [tab, setTab] = useState<Tab>('paste');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportedSource | null>(null);
  const [include, setInclude] = useState<boolean[]>([]);

  const words = wordCount(text);
  const sections = useMemo(() => (words > 0 ? splitIntoChunks(text).length : 0), [text, words]);

  const show = (source: ImportedSource) => {
    setPreview(source);
    setInclude(source.chapters.map(suggestedChapter).map((on, _i, all) => on || all.every(x => !x)));
    setError(null);
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      console.error('Import failed:', e);
      setError((e as Error).message || 'خواندن ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };

  const add = (source: ImportedSource) => run(async () => {
    if (await onAdd(source)) {
      setPreview(null);
      setText('');
      setTitle('');
      setUrl('');
    }
  });

  const submitPaste = () => {
    const chapters = splitLongChapters(splitTextIntoChapters(text));
    const source: ImportedSource = { kind: chapters.length > 1 ? 'book' : 'text', title: title.trim(), chapters };
    if (chapters.length > 1) show(source);
    else add(source);
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    run(async () => {
      if (/\.epub$/i.test(file.name) || file.type === 'application/epub+zip') {
        const book = await importEpub(await file.arrayBuffer());
        show({ ...book, title: book.title || file.name.replace(/\.epub$/i, '') });
      } else {
        const content = await file.text();
        const imported = importPlainText(content, '', 'text');
        show({ ...imported, kind: imported.chapters.length > 1 ? 'book' : 'text', title: imported.title || file.name.replace(/\.[^.]+$/, '') });
      }
    });
  };

  const readLink = () => run(async () => {
    const page = await callProxy('fetch-page', { url: url.trim() });
    show(await importArticle(page.html, page.url));
  });

  if (preview) {
    const chosen = preview.chapters.filter((_, i) => include[i]);
    const chosenWords = chosen.reduce((n, c) => n + wordCount(c.text), 0);
    return (
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-4" aria-label="پیش‌نمایش">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPreview(null)} aria-label="برگشت" className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700"><Icon.Back /></button>
          <h2 className="font-bold text-ink dark:text-white">پیش از افزودن، نگاهی بینداز</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-ink-muted dark:text-slate-400">عنوان</span>
            <input dir="auto" value={preview.title} onChange={e => setPreview({ ...preview, title: e.target.value })} className={`${inputClass} font-en`} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-ink-muted dark:text-slate-400">نویسنده</span>
            <input dir="auto" value={preview.author || ''} onChange={e => setPreview({ ...preview, author: e.target.value })} className={`${inputClass} font-en`} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-ink-muted dark:text-slate-400">نوع</span>
            <select value={preview.kind} onChange={e => setPreview({ ...preview, kind: e.target.value as SourceKind })} className={inputClass}>
              {(Object.keys(KIND_NAMES) as SourceKind[]).map(k => <option key={k} value={k}>{KIND_NAMES[k]}</option>)}
            </select>
          </label>
        </div>
        {preview.chapters.length > 1 && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-ink-muted dark:text-slate-400">فصل‌ها: صفحه‌های فهرست و حق نشر را می‌توانی کنار بگذاری</span>
              <button type="button" onClick={() => setInclude(include.map(() => !include.every(Boolean)))} className="text-brand-500 dark:text-brand-300 hover:underline">
                {include.every(Boolean) ? 'هیچ‌کدام' : 'همه'}
              </button>
            </div>
            <ol className="flex flex-col gap-1 max-h-[22rem] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 p-1.5">
              {preview.chapters.map((c, i) => (
                <li key={i}>
                  <label className={`flex items-center gap-3 min-h-[44px] px-2.5 rounded-xl cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 ${include[i] ? '' : 'opacity-60'}`}>
                    <input type="checkbox" checked={!!include[i]} onChange={() => setInclude(include.map((v, j) => (j === i ? !v : v)))} className="w-[18px] h-[18px] accent-brand-500" />
                    <span dir="auto" className="flex-1 min-w-0 font-en truncate">{c.title || `Chapter ${i + 1}`}</span>
                    <span className="text-xs text-ink-muted dark:text-slate-400 whitespace-nowrap">{fa(wordCount(c.text))} واژه</span>
                  </label>
                </li>
              ))}
            </ol>
          </div>
        )}
        {preview.chapters.length === 1 && (
          <p dir="ltr" className="font-read text-sm leading-7 text-ink-muted dark:text-slate-300 line-clamp-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl p-3">{preview.chapters[0].text.slice(0, 600)}</p>
        )}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy || chosen.length === 0 || !preview.title.trim()} onClick={() => add({ ...preview, chapters: chosen })}
            className="min-h-[48px] px-6 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold disabled:opacity-40">
            {busy ? 'در حال افزودن…' : 'افزودن به کتابخانه'}
          </button>
          <span className="text-sm text-ink-muted dark:text-slate-400">
            {chosen.length > 1 ? `${fa(chosen.length)} فصل، ` : ''}{fa(chosenWords)} واژه
          </span>
        </div>
      </section>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'paste', label: 'چسباندن متن' },
    { id: 'file', label: 'فایل کتاب' },
    { id: 'link', label: 'لینک مقاله' },
  ];

  return (
    <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-4" aria-label="افزودن به کتابخانه">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold text-ink dark:text-white">افزودن به کتابخانه</h2>
        {onCancel && <button type="button" onClick={onCancel} aria-label="بستن" className="w-10 h-10 rounded-xl flex items-center justify-center text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700"><Icon.Close size={18} /></button>}
      </div>
      <div role="tablist" className="flex gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-900/60 self-start">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setError(null); }}
            className={`min-h-[40px] px-4 rounded-xl text-sm ${tab === t.id ? 'bg-white dark:bg-slate-700 font-bold text-ink dark:text-white shadow-sm' : 'text-ink-muted dark:text-slate-400'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'paste' && (
        <form onSubmit={e => { e.preventDefault(); if (words > 0) submitPaste(); }} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-ink-muted dark:text-slate-400">عنوان</span>
            <input dir="auto" value={title} onChange={e => setTitle(e.target.value)} placeholder="مثلاً فصل اول کتاب" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-ink-muted dark:text-slate-400">متن انگلیسی</span>
            <textarea dir="ltr" value={text} onChange={e => setText(e.target.value)} rows={8} placeholder="Paste an English text here…"
              className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 font-read text-[15px] leading-7 focus:border-brand-500 focus:outline-none" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={words === 0 || busy} className="min-h-[48px] px-6 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold disabled:opacity-40">
              ساختن مسیر
            </button>
            {words > 0 && <span className="text-sm text-ink-muted dark:text-slate-400">{fa(words)} واژه، {fa(sections)} بخش</span>}
          </div>
        </form>
      )}

      {tab === 'file' && (
        <div className="flex flex-col gap-3">
          <label className={`flex flex-col items-center justify-center gap-2 min-h-[140px] rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 cursor-pointer hover:border-brand-400 hover:bg-brand-50/40 dark:hover:bg-slate-700/40 ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
            <Icon.Upload />
            <span className="font-bold text-ink dark:text-white">{busy ? 'در حال خواندن فایل…' : 'انتخاب فایل EPUB یا TXT'}</span>
            <span className="text-xs text-ink-muted dark:text-slate-400">فصل‌ها از فهرست خود کتاب خوانده می‌شوند؛ فایل از این دستگاه بیرون نمی‌رود.</span>
            <input type="file" accept=".epub,.txt,application/epub+zip,text/plain" className="sr-only" onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
      )}

      {tab === 'link' && (
        <form onSubmit={e => { e.preventDefault(); if (url.trim()) readLink(); }} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-ink-muted dark:text-slate-400">لینک مقاله</span>
            <input dir="ltr" type="url" inputMode="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" className={`${inputClass} font-en`} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={!url.trim() || busy} className="min-h-[48px] px-6 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold disabled:opacity-40">
              {busy ? 'در حال خواندن…' : 'خواندن مقاله'}
            </button>
            <span className="text-xs text-ink-muted dark:text-slate-400">متن اصلی صفحه جدا می‌شود؛ تبلیغ و منو کنار می‌روند.</span>
          </div>
        </form>
      )}

      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    </section>
  );
};
