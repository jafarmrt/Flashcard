// File: /components/reader/TextEditor.tsx
// Correcting the text of one section: a word the PDF or the web page broke,
// a passage that does not belong (page numbers, footnotes, an index) cut out.
// Paragraphs are separated by a blank line.

import React, { useEffect, useRef, useState } from 'react';
import { fa, Icon } from '../common/ui';

interface TextEditorProps {
  title: string; // "بخش ۳ از ۱۲"
  text: string;
  unsavedPicks: number; // words picked in the section, lost when its text changes
  onSave: (text: string) => Promise<void>;
  onClose: () => void;
}

const words = (text: string) => text.match(/\S+/g)?.length || 0;

export const TextEditor: React.FC<TextEditorProps> = ({ title, text, unsavedPicks, onSave, onClose }) => {
  const [value, setValue] = useState(text);
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const changed = value.trim() !== text.trim();
  useEffect(() => { area.current?.focus(); }, []);

  const close = () => {
    if (changed && !window.confirm('تغییرهای متن ذخیره نشده‌اند. بسته شود؟')) return;
    onClose();
  };
  const save = async (next = value) => {
    if (saving) return;
    if (unsavedPicks > 0 && !window.confirm(`${fa(unsavedPicks)} واژهٔ انتخاب‌شدهٔ این بخش هنوز کارت نشده و با تغییر متن از فهرست می‌رود. ادامه بدهم؟`)) return;
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };
  // Cutting the whole section: it stays in the chapter, empty, and reading
  // passes over it.
  const removeAll = () => {
    if (!window.confirm('متن کل این بخش حذف شود؟ بخش خالی می‌ماند و هنگام خواندن از رویش رد می‌شوی.')) return;
    save('');
  };
  // The paragraph the cursor is in, cut out.
  const removeParagraph = () => {
    const el = area.current;
    if (!el) return;
    const at = el.selectionStart;
    const start = value.lastIndexOf('\n\n', Math.max(0, at - 1));
    const from = start < 0 ? 0 : start + 2;
    const endAt = value.indexOf('\n\n', at);
    const to = endAt < 0 ? value.length : endAt + 2;
    const next = (value.slice(0, from) + value.slice(to)).replace(/\n{3,}/g, '\n\n').trim();
    setValue(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(Math.min(from, next.length), Math.min(from, next.length)); });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch md:items-center justify-center md:p-8" role="dialog" aria-modal="true" aria-label="ویرایش متن"
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
      <div dir="rtl" className="font-fa w-full md:max-w-3xl md:rounded-3xl bg-white dark:bg-slate-800 text-ink dark:text-slate-100 flex flex-col max-h-full shadow-2xl">
        <header className="flex items-center gap-2 p-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex-1 min-w-0">
            <h2 className="font-extrabold">ویرایش متن</h2>
            <p className="text-xs text-ink-muted dark:text-slate-400">{title} · {fa(words(value))} واژه{changed ? ` (پیش از ویرایش ${fa(words(text))})` : ''}</p>
          </div>
          <button type="button" onClick={close} aria-label="بستن" className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700"><Icon.Close size={20} /></button>
        </header>
        <p className="px-4 pt-3 text-xs text-ink-muted dark:text-slate-400 leading-relaxed">
          هر جای متن را درست کن یا پاک کن. پاراگراف‌ها با یک خط خالی از هم جدا می‌شوند. تغییر روی همهٔ دستگاه‌هایت می‌رسد. کارت‌ها و یادداشت‌هایی که ساخته‌ای می‌مانند.
        </p>
        <textarea ref={area} dir="ltr" lang="en" value={value} onChange={e => setValue(e.target.value)} spellCheck
          className="flex-1 min-h-[50vh] m-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-600 bg-[#FBF6EC] dark:bg-slate-900 font-read text-[17px] leading-relaxed text-slate-800 dark:text-slate-100 focus:outline-none focus:border-brand-500 resize-none" />
        <footer className="flex flex-wrap items-center gap-2 p-4 pt-0">
          <button type="button" onClick={() => save()} disabled={!changed || saving} className="min-h-[44px] px-6 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold disabled:opacity-50">
            {saving ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
          <button type="button" onClick={removeParagraph} disabled={!value.trim()} className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-600 text-sm disabled:opacity-50">
            حذف پاراگرافی که مکان‌نما در آن است
          </button>
          {changed && <button type="button" onClick={() => setValue(text)} className="min-h-[44px] px-4 rounded-xl text-sm text-ink-muted dark:text-slate-400 hover:underline">برگرداندن متن اصلی</button>}
          <span className="flex-1" />
          <button type="button" onClick={removeAll} disabled={saving || !text.trim()} className="min-h-[44px] px-4 rounded-xl text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40">حذف کل این بخش</button>
        </footer>
      </div>
    </div>
  );
};
