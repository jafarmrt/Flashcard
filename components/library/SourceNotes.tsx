import React, { useMemo, useState } from 'react';
import type { Chapter, Source, TextNote } from '../../types';
import { notesInOrder, notesMarkdown } from '../../services/notes';
import { fa } from '../common/ui';

interface SourceNotesProps {
  source: Source;
  chapters: Chapter[]; // this source's, in order
  notes: TextNote[];
  onOpenChunk: (chapter: Chapter, index: number) => void;
}

type Filter = 'all' | 'comment' | 'translation';

// A file name from the title: letters, digits and dashes only.
const fileName = (title: string) => `${title.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'notes'}-notes.md`;

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Every note and kept translation of a book, in reading order, each one a
// tap away from its place in the text; the whole list as a Markdown file.
export const SourceNotes: React.FC<SourceNotesProps> = ({ source, chapters, notes, onOpenChunk }) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [copied, setCopied] = useState(false);
  const mine = useMemo(() => notes.filter(n => n.sourceId === source.id && !n.isDeleted), [notes, source.id]);
  const ordered = useMemo(() => notesInOrder(mine, new Map(chapters.map(c => [c.id, c.order]))), [mine, chapters]);
  const shown = filter === 'all' ? ordered : ordered.filter(n => n.kind === filter);
  const byId = useMemo(() => new Map(chapters.map(c => [c.id, c])), [chapters]);
  const counts = { comment: mine.filter(n => n.kind === 'comment').length, translation: mine.filter(n => n.kind === 'translation').length };

  const markdown = () => notesMarkdown(source.title, filter === 'all' ? mine : mine.filter(n => n.kind === filter), chapters);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* no clipboard: the download is still there */ }
  };

  if (mine.length === 0) {
    return (
      <p className="bg-white dark:bg-slate-800 rounded-3xl p-5 text-sm text-ink-muted dark:text-slate-400">
        هنوز یادداشتی برای این کتاب نداری. هنگام خواندن، روی واژه یا جمله بزن و «یادداشت» یا «نگه‌داشتن ترجمه» را انتخاب کن تا این‌جا جمع شود.
      </p>
    );
  }

  let lastChapter: string | null = null;
  return (
    <section aria-label="یادداشت‌های کتاب" className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {([['all', `همه (${fa(mine.length)})`], ['comment', `یادداشت (${fa(counts.comment)})`], ['translation', `ترجمه (${fa(counts.translation)})`]] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id}
            className={`min-h-[36px] px-3 rounded-full text-sm ${filter === id ? 'bg-brand-100 text-brand-700 font-bold dark:bg-brand-900/60 dark:text-brand-200' : 'border border-slate-200 dark:border-slate-600'}`}>{label}</button>
        ))}
        <span className="flex-1" />
        <button type="button" onClick={copy} className="min-h-[40px] px-3 rounded-xl text-sm border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700">{copied ? 'کپی شد' : 'کپی'}</button>
        <button type="button" onClick={() => download(fileName(source.title), markdown())}
          className="min-h-[40px] px-4 rounded-xl text-sm font-bold bg-ink text-white dark:bg-white dark:text-ink">خروجی (Markdown)</button>
      </div>
      <ol className="flex flex-col gap-3">
        {shown.map(n => {
          const chapter = byId.get(n.chapterId);
          const heading = chapters.length > 1 && n.chapterId !== lastChapter ? chapter : undefined;
          lastChapter = n.chapterId;
          return (
            <li key={n.id} className="flex flex-col gap-2">
              {heading && <h3 dir="auto" className="font-en font-bold text-ink dark:text-white pt-2">{heading.title}</h3>}
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-4 flex flex-col gap-2">
                <blockquote dir="ltr" lang="en" className="font-read text-[15px] leading-7 text-slate-700 dark:text-slate-200 border-l-4 border-brand-300 dark:border-brand-700 pl-3">{n.quote}</blockquote>
                <p dir="auto" className="text-ink dark:text-slate-100 whitespace-pre-line">{n.text}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted dark:text-slate-400">
                  <span className={`rounded-full px-2 py-0.5 ${n.kind === 'translation' ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100' : 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'}`}>
                    {n.kind === 'translation' ? `ترجمه${n.by ? ` · ${n.by}` : ''}` : 'یادداشت'}
                  </span>
                  <span>بخش {fa(n.chunk + 1)}</span>
                  <span className="flex-1" />
                  {chapter && n.chunk < chapter.chunkCount && (
                    <button type="button" onClick={() => onOpenChunk(chapter, n.chunk)} className="min-h-[32px] px-2 rounded-lg text-brand-600 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-slate-700">رفتن به متن</button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
