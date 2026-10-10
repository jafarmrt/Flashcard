import React, { useMemo, useState } from 'react';
import type { AiRequestOptions } from '../services/geminiService';
import { contextLabel, dollars, filterModels, listModels, type AiModel } from '../services/aiModels';
import { fa, Icon } from './common/ui';

const SHOWN = 150;

// The models a service offers, read from it with the key typed above, to
// pick one by tapping instead of typing its name. OpenRouter also says
// which are free and what the others cost.
export const ModelPicker: React.FC<{ options: AiRequestOptions; value: string; onPick: (id: string) => void }> = ({ options, value, onPick }) => {
    const [open, setOpen] = useState(false);
    const [models, setModels] = useState<AiModel[] | null>(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [freeOnly, setFreeOnly] = useState(false);

    const load = () => {
        setOpen(true);
        setError('');
        setModels(null);
        listModels(options)
            .then(list => setModels(list))
            .catch((e: Error) => setError(e?.message || 'فهرست مدل‌ها گرفته نشد.'));
    };

    const shown = useMemo(() => (models ? filterModels(models, search, freeOnly) : []), [models, search, freeOnly]);
    const hasFree = !!models?.some(m => m.free);
    const hasPrices = !!models?.some(m => m.priceIn !== undefined);

    if (!open) {
        return (
            <button type="button" onClick={load} className="self-start min-h-[36px] px-3 rounded-xl text-sm text-brand-600 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-slate-700">
                دیدن مدل‌های این سرویس
            </button>
        );
    }

    return (
        <div className="flex flex-col gap-2 rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-3">
            <div className="flex items-center gap-2">
                <span className="font-bold text-ink dark:text-white text-sm flex-1">مدل‌های این سرویس</span>
                <button type="button" onClick={() => setOpen(false)} aria-label="بستن فهرست مدل‌ها" className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700">
                    <Icon.Close size={16} />
                </button>
            </div>
            {error ? (
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-red-700 dark:text-red-300"><bdi dir="auto">{error}</bdi></p>
                    <button type="button" onClick={load} className="text-sm text-brand-600 dark:text-brand-300 hover:underline">دوباره</button>
                </div>
            ) : models === null ? (
                <p className="text-sm text-ink-muted dark:text-slate-400" role="status">در حال گرفتن فهرست…</p>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-3">
                        <input type="search" dir="ltr" value={search} onChange={e => setSearch(e.target.value)} placeholder="deepseek, flash, free…" aria-label="جست‌وجوی مدل"
                            className="flex-1 min-w-[10rem] min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-en focus:border-brand-500 focus:outline-none" />
                        {hasFree && (
                            <label className="flex items-center gap-1.5 text-sm text-ink dark:text-slate-100 cursor-pointer">
                                <input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)} className="w-4 h-4 accent-brand-500" />
                                فقط رایگان‌ها
                            </label>
                        )}
                    </div>
                    <p className="text-xs text-ink-muted dark:text-slate-400">
                        {fa(shown.length)} مدل{hasPrices ? '؛ قیمت‌ها به دلار برای هر یک میلیون توکن است: ورودی / خروجی.' : ''} روی هر مدل بزنی انتخاب می‌شود.
                    </p>
                    <ul className="flex flex-col gap-1 max-h-72 overflow-y-auto" dir="ltr">
                        {shown.slice(0, SHOWN).map(m => {
                            const chosen = m.id === value;
                            return (
                                <li key={m.id}>
                                    <button type="button" onClick={() => onPick(m.id)} aria-pressed={chosen}
                                        className={`w-full text-left rounded-xl px-3 py-2 flex items-center gap-2 ${chosen ? 'bg-brand-100 dark:bg-brand-900/50 ring-1 ring-brand-400' : 'bg-white dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-slate-700'}`}>
                                        <span className="flex-1 min-w-0">
                                            <span className="block font-en text-sm font-bold text-ink dark:text-white truncate">{m.id}</span>
                                            {m.name && <span className="block font-en text-xs text-ink-muted dark:text-slate-400 truncate">{m.name}</span>}
                                        </span>
                                        {m.context ? <span className="shrink-0 text-xs text-ink-muted dark:text-slate-400 font-en">{contextLabel(m.context)}</span> : null}
                                        {m.free ? (
                                            <span dir="rtl" className="shrink-0 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 px-2 py-0.5">رایگان</span>
                                        ) : m.priceIn !== undefined && m.priceOut !== undefined ? (
                                            <span className="shrink-0 text-xs font-en text-ink dark:text-slate-200">{dollars(m.priceIn)} / {dollars(m.priceOut)}</span>
                                        ) : null}
                                        {chosen && <Icon.Check size={16} className="shrink-0 text-brand-600 dark:text-brand-300" />}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    {shown.length > SHOWN && <p className="text-xs text-ink-muted dark:text-slate-400">{fa(SHOWN)} تای اول نشان داده شد؛ برای بقیه جست‌وجو کن.</p>}
                </>
            )}
        </div>
    );
};

export default ModelPicker;
