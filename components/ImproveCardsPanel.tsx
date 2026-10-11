import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Flashcard } from '../types';
import type { RefreshSource } from '../services/cardRefresh';
import type { RefreshField } from '../services/cardRefresh';
import {
  CardImprovement, DEFAULT_IMPROVE_FIELDS, IMPROVE_FIELDS, ImproveField, ImproveMode, improveBatch, improveBatchSize,
  improveCandidates, improveFieldName, improveRequestCount,
} from '../services/cardImprove';
import { fa, Icon } from './common/ui';

export interface ImprovementPick {
  id: string;
  improvement: CardImprovement;
  fields: RefreshField[];
  onlyEmpty: boolean; // "fill empty parts only": a part filled meanwhile stays
}

interface ImproveCardsPanelProps {
  cards: Flashcard[]; // the cards shown in the list now (its deck, search and filter)
  sources: RefreshSource[]; // the AI services set up on this device
  onApply: (picks: ImprovementPick[]) => Promise<void>;
  onClose: () => void;
}

const FIELDS_KEY = 'improveFields';
const DEFAULT_LIMIT = 30;

const loadFields = (): ImproveField[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(FIELDS_KEY) || 'null');
    if (Array.isArray(saved)) return IMPROVE_FIELDS.filter(f => saved.includes(f));
  } catch { /* storage may be blocked */ }
  return DEFAULT_IMPROVE_FIELDS;
};

const saveFields = (fields: ImproveField[]) => {
  try { localStorage.setItem(FIELDS_KEY, JSON.stringify(fields)); } catch { /* storage may be blocked */ }
};

const RTL_FIELDS: RefreshField[] = ['back', 'notes', 'commonMistake', 'register', 'wordRoot', 'reference'];
// English with Persian meanings after "=": each line finds its own direction.
const MIXED_FIELDS: RefreshField[] = ['synonyms', 'wordFamily', 'collocations'];

const button = 'min-h-[44px] px-4 rounded-xl text-sm font-bold disabled:opacity-40';
const quiet = `${button} text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700`;
const primary = `${button} text-white bg-brand-500 hover:bg-brand-600`;

// Improving many cards with an AI: pick the parts, the cards and the service,
// see the cost in requests, then keep only the changes you tick.
export const ImproveCardsPanel: React.FC<ImproveCardsPanelProps> = ({ cards, sources, onApply, onClose }) => {
  const [fields, setFields] = useState<ImproveField[]>(loadFields);
  const [mode, setMode] = useState<ImproveMode>('empty');
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [sourceId, setSourceId] = useState(sources[0]?.id || '');
  const [step, setStep] = useState<'setup' | 'running' | 'review'>('setup');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<CardImprovement[]>([]);
  const [picked, setPicked] = useState<Map<string, Set<RefreshField>>>(new Map());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const stop = useRef(false);
  const [stopping, setStopping] = useState(false);
  // Leaving the panel some other way stops the remaining requests.
  useEffect(() => () => { stop.current = true; }, []);

  const candidates = useMemo(() => improveCandidates(cards, fields, mode), [cards, fields, mode]);
  const count = Math.min(candidates.length, Math.max(1, limit || 1));
  const requests = fields.length ? improveRequestCount(count, mode, fields) : 0;
  const source = sources.find(s => s.id === sourceId);

  const toggleField = (f: ImproveField) => {
    const next = fields.includes(f) ? fields.filter(x => x !== f) : IMPROVE_FIELDS.filter(x => x === f || fields.includes(x));
    setFields(next);
    saveFields(next);
  };

  const run = async () => {
    if (!source?.options || count === 0) return;
    const todo = candidates.slice(0, count);
    const size = improveBatchSize(mode, fields);
    stop.current = false;
    setStopping(false);
    setError('');
    setResults([]);
    setStep('running');
    setProgress({ done: 0, total: todo.length });
    const found: CardImprovement[] = [];
    for (let i = 0; i < todo.length && !stop.current; i += size) {
      const batch = todo.slice(i, i + size);
      try {
        found.push(...await improveBatch(batch, fields, mode, source.options));
        setResults([...found]);
      } catch (e) {
        console.error('Improving cards failed:', e);
        const message = (e as Error)?.message || '';
        setError(/429|quota|rate/i.test(message) ? `سهمیهٔ ${source.name} تمام شد.` : `${source.name} جواب نداد: ${message.slice(0, 160)}`);
        // No quota, no network or a wrong key fail the same way for the
        // rest: stop rather than pay for failing requests.
        break;
      }
      setProgress({ done: Math.min(i + size, todo.length), total: todo.length });
    }
    setPicked(new Map(found.map(r => [r.card.id, new Set(r.changes.map(c => c.field))] as [string, Set<RefreshField>])));
    setStep('review');
  };

  const toggle = (id: string, field: RefreshField) => setPicked((prev: Map<string, Set<RefreshField>>) => {
    const next = new Map<string, Set<RefreshField>>(prev);
    const set = new Set<RefreshField>(next.get(id) || []);
    if (set.has(field)) set.delete(field); else set.add(field);
    next.set(id, set);
    return next;
  });
  const setAll = (on: boolean) => setPicked(new Map(results.map(r => [r.card.id, new Set(on ? r.changes.map(c => c.field) : [])] as [string, Set<RefreshField>])));
  const pickedCount: number = Array.from((picked as Map<string, Set<RefreshField>>).values()).reduce((n: number, s: Set<RefreshField>) => n + s.size, 0);

  const apply = async () => {
    setSaving(true);
    try {
      await onApply(results
        .map(r => ({ id: r.card.id, improvement: r, fields: Array.from(picked.get(r.card.id) || []), onlyEmpty: mode === 'empty' }))
        .filter(p => p.fields.length > 0));
      onClose();
    } catch (e) {
      console.error('Saving improvements failed:', e);
      setError('ذخیره نشد. دوباره امتحان کن.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="improve-title" onClick={step === 'setup' ? onClose : undefined}>
      <div dir="rtl" className="font-fa w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <header className="flex items-center gap-3">
          <h2 id="improve-title" className="flex-1 text-xl font-extrabold text-ink dark:text-white">بهبود کارت‌ها با هوش مصنوعی</h2>
          {step !== 'running' && (
            <button type="button" onClick={onClose} aria-label="بستن" className="w-10 h-10 rounded-full flex items-center justify-center text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700"><Icon.Close size={20} /></button>
          )}
        </header>

        {step === 'setup' && (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-bold text-ink dark:text-white mb-1">کدام بخش‌ها بهبود پیدا کنند؟</legend>
              <p className="text-xs text-ink-muted dark:text-slate-400">هر بخش بیشتر، جواب طولانی‌تر و هزینهٔ بیشتر.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {IMPROVE_FIELDS.map(f => (
                  <label key={f} className={`flex items-center gap-2 min-h-[44px] px-3 rounded-xl border cursor-pointer text-sm ${fields.includes(f) ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/30 dark:border-brand-600' : 'border-slate-200 dark:border-slate-600'}`}>
                    <input type="checkbox" checked={fields.includes(f)} onChange={() => toggleField(f)} className="w-4 h-4 accent-brand-500 shrink-0" />
                    <span className="text-ink dark:text-slate-100">{improveFieldName(f)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-bold text-ink dark:text-white mb-1">با بخش‌هایی که پر هستند چه کند؟</legend>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="radio" name="improve-mode" checked={mode === 'empty'} onChange={() => setMode('empty')} className="mt-1 accent-brand-500" />
                <span><b>فقط جاهای خالی را پر کن.</b> <span className="text-ink-muted dark:text-slate-400">ارزان‌تر؛ هر چه کارت دارد دست نمی‌خورد.</span></span>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="radio" name="improve-mode" checked={mode === 'all'} onChange={() => setMode('all')} className="mt-1 accent-brand-500" />
                <span><b>بخش‌های پر را هم بازنویسی و اصلاح کن.</b> <span className="text-ink-muted dark:text-slate-400">گران‌تر؛ قبل از ذخیره، هر تغییر را می‌بینی و تیک می‌زنی.</span></span>
              </label>
            </fieldset>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-bold text-ink dark:text-white">سرویس هوش مصنوعی</span>
                <select value={sourceId} onChange={e => setSourceId(e.target.value)} className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-ink dark:text-white">
                  {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-bold text-ink dark:text-white">حداکثر چند کارت؟</span>
                <input type="number" min={1} max={500} value={limit} onChange={e => setLimit(Math.max(0, Math.min(500, Number(e.target.value) || 0)))}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-ink dark:text-white" />
              </label>
            </div>

            <p className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-4 text-sm leading-7 text-ink dark:text-slate-200">
              {fields.length === 0 ? 'دست‌کم یک بخش را انتخاب کن.'
                : candidates.length === 0 ? (mode === 'empty' ? 'در کارت‌های این فهرست، این بخش‌ها جای خالی ندارند.' : 'کارتی برای بهبود در این فهرست نیست.')
                : <>{fa(count)} کارت از {fa(candidates.length)} کارتِ این فهرست، با <b>{fa(requests)} درخواست</b> به <bdi dir="auto">{source?.name || '—'}</bdi>. کارت‌های گرامر جدا هستند و در این کار نمی‌آیند. برای کارت‌های دیگر، فهرست را با دسته، جست‌وجو یا «نمایش» محدود کن.</>}
            </p>

            <div className="sticky bottom-0 -mx-5 sm:-mx-6 px-5 sm:px-6 py-3 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={onClose} className={quiet}>انصراف</button>
              <button type="button" onClick={run} disabled={!source || fields.length === 0 || candidates.length === 0} className={primary}>شروع بهبود</button>
            </div>
          </>
        )}

        {step === 'running' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink dark:text-slate-200">در حال بهبود: {fa(progress.done)} از {fa(progress.total)} کارت · {fa(results.length)} کارت پیشنهاد گرفت</p>
            <div className="h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
            <button type="button" disabled={stopping} onClick={() => { stop.current = true; setStopping(true); }} className={`${quiet} self-end`}>
              {stopping ? 'بعد از همین درخواست می‌ایستد…' : 'توقف و دیدن پیشنهادها'}
            </button>
          </div>
        )}

        {step === 'review' && (
          <>
            {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
            {results.length === 0 ? (
              <p className="text-sm text-ink-muted dark:text-slate-300">هوش مصنوعی چیزی متفاوت با کارت‌های فعلی پیشنهاد نکرد.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex-1 text-ink dark:text-slate-200">{fa(results.length)} کارت پیشنهاد گرفت. هر تغییری را که می‌خواهی تیک بزن.</span>
                  <button type="button" onClick={() => setAll(true)} className="min-h-[36px] px-3 rounded-lg text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-slate-700">همه</button>
                  <button type="button" onClick={() => setAll(false)} className="min-h-[36px] px-3 rounded-lg text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-slate-700">هیچ‌کدام</button>
                </div>
                <ul className="flex flex-col gap-3">
                  {results.map(r => (
                    <li key={r.card.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 flex flex-col gap-2">
                      <p className="flex items-baseline gap-2">
                        <bdi dir="ltr" className="font-en font-bold text-ink dark:text-white">{r.card.front}</bdi>
                        {r.card.back && <span className="text-sm text-ink-muted dark:text-slate-400">{r.card.back}</span>}
                      </p>
                      {r.changes.map(c => {
                        const ltr = !RTL_FIELDS.includes(c.field) && !MIXED_FIELDS.includes(c.field);
                        const dir = MIXED_FIELDS.includes(c.field) ? 'auto' : ltr ? 'ltr' : 'rtl';
                        return (
                          <label key={c.field} className="flex items-start gap-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 p-2.5 cursor-pointer">
                            <input type="checkbox" checked={!!picked.get(r.card.id)?.has(c.field)} onChange={() => toggle(r.card.id, c.field)} className="mt-1 w-5 h-5 accent-brand-500 shrink-0" />
                            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                              <span className="text-xs font-bold text-ink-muted dark:text-slate-400">{improveFieldName(c.field as ImproveField)}</span>
                              <span dir={dir} className={`text-sm whitespace-pre-line break-words text-ink dark:text-white ${ltr ? 'font-en text-left' : ''}`}>{c.proposed}</span>
                              {c.current && <span dir={dir} className={`text-xs whitespace-pre-line break-words text-ink-muted dark:text-slate-400 line-through decoration-slate-400/60 ${ltr ? 'font-en text-left' : ''}`}>{c.current}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="sticky bottom-0 -mx-5 sm:-mx-6 px-5 sm:px-6 py-3 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={onClose} className={quiet}>{results.length ? 'هیچ‌کدام را نمی‌خواهم' : 'بستن'}</button>
              {results.length > 0 && (
                <button type="button" onClick={apply} disabled={saving || pickedCount === 0} className={primary}>
                  {saving ? 'در حال ذخیره…' : `ذخیرهٔ ${fa(pickedCount)} تغییر`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
