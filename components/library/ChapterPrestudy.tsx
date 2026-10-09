import React, { useEffect, useRef, useState } from 'react';
import type { Chapter, ChapterText, ExtractedWordCard, Settings } from '../../types';
import { extractFromLongText } from '../../services/extractionPipeline';
import { aiRequestOptions } from '../../services/aiSettings';
import { normalizeTerm } from '../../services/vocabMerge';
import { isBelowLevel } from '../../services/wordLevel';
import { fa, Icon } from '../common/ui';

// The first sections of a chapter carry most of its new words; looking at
// all of them would take long without AI.
export const PRESTUDY_SECTIONS = 3;
const PER_SECTION = 4;
const MAX_WORDS = 12;

interface Pick { item: ExtractedWordCard; chunk: number; on: boolean }

interface ChapterPrestudyProps {
  chapter: Chapter;
  settings: Settings;
  existingFronts: string[];
  knownTerms: string[];
  loadText: (chapterId: string) => Promise<ChapterText>;
  onPrestudy: (chapterId: string, picks: { item: ExtractedWordCard; chunk: number }[]) => Promise<void>;
}

// Before a chapter: its hard words, picked by the AI or the free
// dictionaries, become cards at the section they are in and are reviewed at
// once, so the chapter reads more easily.
export const ChapterPrestudy: React.FC<ChapterPrestudyProps> = ({ chapter, settings, existingFronts, knownTerms, loadText, onPrestudy }) => {
  const [state, setState] = useState<'idle' | 'loading' | 'shown' | 'saving'>('idle');
  const [progress, setProgress] = useState('');
  const [picks, setPicks] = useState<Pick[]>([]);
  const [error, setError] = useState('');
  const [skipped, setSkipped] = useState(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const level = settings.userLevel || 'B2';

  const find = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState('loading');
    setError('');
    try {
      const text = await loadText(chapter.id);
      const sections = text.chunks.slice(0, PRESTUDY_SECTIONS);
      const found: Pick[] = [];
      const seen = new Set<string>();
      let tried = 0;
      let failed = 0;
      for (let i = 0; i < sections.length && found.length < MAX_WORDS; i++) {
        setProgress(`بخش ${fa(i + 1)} از ${fa(sections.length)}…`);
        const result = await extractFromLongText({
          text: sections[i], level, perSection: PER_SECTION, source: settings.extractionSource || 'ai',
          existingFronts: [...existingFronts, ...found.map(p => p.item.front)], knownTerms, includeGrammar: false,
          aiOptions: aiRequestOptions(settings), signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        tried += result.sections;
        failed += result.failedSections;
        for (const item of result.cards) {
          const key = normalizeTerm(item.front);
          if (item.alreadyInDeck || item.kind === 'grammar' || seen.has(key) || found.length >= MAX_WORDS) continue;
          seen.add(key);
          found.push({ item, chunk: i, on: !(item.origin?.by === 'ai' && isBelowLevel(item.level, level)) });
        }
      }
      // Offline, every lookup fails without an exception: that is not "no
      // hard words".
      if (tried > 0 && failed === tried) throw new Error('every section failed');
      setPicks(found);
      setSkipped(failed);
      setState('shown');
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error('Pre-study failed:', e);
      setError('پیدا کردن واژه‌ها ناموفق بود؛ اتصال یا تنظیمات هوش مصنوعی را بررسی کن.');
      setState('idle');
    }
  };

  const chosen = picks.filter(p => p.on);
  const save = async () => {
    setState('saving');
    try {
      await onPrestudy(chapter.id, chosen.map(({ item, chunk }) => ({ item, chunk })));
    } catch (e) {
      console.error('Saving pre-study cards failed:', e);
      setError('ذخیرهٔ کارت‌ها ناموفق بود.');
      setState('shown');
    }
  };

  if (state === 'idle' || state === 'loading') {
    return (
      <section aria-label="پیش‌مطالعه" className="bg-sky-50 dark:bg-sky-900/30 rounded-3xl p-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[14rem] flex flex-col gap-1">
          <h2 className="font-bold text-ink dark:text-white">پیش‌مطالعهٔ این فصل</h2>
          <p className="text-sm text-ink-muted dark:text-slate-300">واژه‌های سخت {fa(PRESTUDY_SECTIONS)} بخش اول را پیش از خواندن ببین، کارت کن و یک دور مرور کن.</p>
          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        </div>
        <button type="button" onClick={find} disabled={state === 'loading'}
          className="min-h-[44px] px-5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white font-bold disabled:opacity-60">
          {state === 'loading' ? `در حال پیدا کردن… ${progress}` : 'پیدا کردن واژه‌ها'}
        </button>
      </section>
    );
  }

  return (
    <section aria-label="پیش‌مطالعه" className="bg-sky-50 dark:bg-sky-900/30 rounded-3xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="font-bold text-ink dark:text-white flex-1">
          {picks.length ? `${fa(picks.length)} واژهٔ سخت در ابتدای این فصل` : 'واژهٔ سخت تازه‌ای پیدا نشد'}
        </h2>
        <button type="button" onClick={() => { setPicks([]); setState('idle'); }} aria-label="بستن پیش‌مطالعه"
          className="w-9 h-9 rounded-xl flex items-center justify-center text-ink-muted hover:bg-white/70 dark:hover:bg-slate-700"><Icon.Close size={18} /></button>
      </div>
      {picks.length > 0 && (
        <>
          <ul className="flex flex-col divide-y divide-sky-100 dark:divide-sky-900/60 bg-white dark:bg-slate-800 rounded-2xl px-3">
            {picks.map((p, i) => (
              <li key={p.item.front} className="py-2.5">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={p.on} onChange={() => setPicks(list => list.map((q, j) => (j === i ? { ...q, on: !q.on } : q)))}
                    className="mt-1 w-[18px] h-[18px] accent-brand-500" aria-label={`انتخاب ${p.item.front}`} />
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <bdi dir="ltr" className="font-en font-bold text-ink dark:text-white">{p.item.front}</bdi>
                      {p.item.level && <span className="font-en text-[11px] rounded-full bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100 px-1.5">{p.item.level}</span>}
                      <span className="text-sm text-ink dark:text-slate-200">{p.item.back}</span>
                    </span>
                    <span className="text-[11px] text-ink-muted dark:text-slate-400">بخش {fa(p.chunk + 1)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button type="button" onClick={save} disabled={chosen.length === 0 || state === 'saving'}
            className="self-start min-h-[48px] px-6 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold disabled:opacity-50">
            {state === 'saving' ? 'در حال ساختن کارت‌ها…' : `ساختن ${fa(chosen.length)} کارت و مرور`}
          </button>
        </>
      )}
      {skipped > 0 && <p className="text-sm text-amber-800 dark:text-amber-200">{fa(skipped)} بخش بررسی نشد (اتصال)؛ شاید واژه‌های سخت بیشتری باشد.</p>}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    </section>
  );
};
