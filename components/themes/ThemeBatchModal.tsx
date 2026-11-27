import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Flashcard } from '../../types';
import type { RefreshSource } from '../../services/cardRefresh';
import {
  normalizeThemeName,
  normalizeThemes,
  STARTER_THEMES,
  suggestThemesBatch,
  THEME_BATCH_SIZE,
} from '../../services/wordThemes';
import { fa, Icon } from '../common/ui';

interface ThemeBatchModalProps {
  cards: Flashcard[];
  existingThemes: string[];
  sources: RefreshSource[];
  onApply: (assignments: Map<string, string[]>, mode: 'merge' | 'replace') => Promise<void>;
  onClose: () => void;
}

interface ReviewGroup {
  key: string;
  originalName: string;
  editedName: string;
  cardIds: string[];
  selectedIds: Set<string>;
}

const buttonBase = 'min-h-[44px] px-4 rounded-xl text-sm font-bold disabled:opacity-40 whitespace-nowrap';
const quietBtn = `${buttonBase} text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700`;
const primaryBtn = `${buttonBase} text-white bg-brand-500 hover:bg-brand-600`;

export const ThemeBatchModal: React.FC<ThemeBatchModalProps> = ({
  cards,
  existingThemes,
  sources,
  onApply,
  onClose,
}) => {
  const aiSources = useMemo(() => sources.filter(s => s.kind === 'ai'), [sources]);
  const [scope, setScope] = useState<'untagged' | 'all'>('untagged');
  const [writeMode, setWriteMode] = useState<'merge' | 'replace'>('merge');
  const [limit, setLimit] = useState(40);
  const [sourceId, setSourceId] = useState(aiSources[0]?.id || '');
  const [guideText, setGuideText] = useState('');
  const [pickedGuides, setPickedGuides] = useState<string[]>([]);
  const [step, setStep] = useState<'setup' | 'running' | 'review'>('setup');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [groups, setGroups] = useState<ReviewGroup[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const stopRef = useRef(false);
  const [stopping, setStopping] = useState(false);

  useEffect(() => () => {
    stopRef.current = true;
  }, []);

  useEffect(() => {
    if (!aiSources.some(s => s.id === sourceId)) setSourceId(aiSources[0]?.id || '');
  }, [aiSources, sourceId]);

  const liveVocab = useMemo(
    () => cards.filter(c => !c.isDeleted && c.kind !== 'grammar' && c.front.trim() && c.back.trim()),
    [cards],
  );

  const candidates = useMemo(
    () => (scope === 'untagged' ? liveVocab.filter(c => !(c.themes && c.themes.length > 0)) : liveVocab),
    [liveVocab, scope],
  );

  const count = Math.min(candidates.length, Math.max(1, limit || 1));
  const requestCount = count > 0 ? Math.ceil(count / THEME_BATCH_SIZE) : 0;
  const activeSource = aiSources.find(s => s.id === sourceId);

  const quickSuggestions = useMemo(
    () => normalizeThemes([...existingThemes, ...STARTER_THEMES]).slice(0, 10),
    [existingThemes],
  );

  const cardsById = useMemo(() => new Map(liveVocab.map(c => [c.id, c])), [liveVocab]);

  const toggleGuide = (theme: string) => {
    setPickedGuides(prev =>
      prev.includes(theme) ? prev.filter(t => t !== theme) : [...prev, theme],
    );
  };

  const runCategorization = async () => {
    if (!activeSource?.options || count === 0) return;
    const todo = candidates.slice(0, count);
    const typedGuides = guideText.split(/[،,\n]+/).map(s => s.trim()).filter(Boolean);
    const allGuides = normalizeThemes([...pickedGuides, ...typedGuides]);

    stopRef.current = false;
    setStopping(false);
    setError('');
    setStep('running');
    setProgress({ done: 0, total: todo.length });

    const bucketMap = new Map<string, { name: string; cardIds: string[] }>();

    for (let i = 0; i < todo.length && !stopRef.current; i += THEME_BATCH_SIZE) {
      const batch = todo.slice(i, i + THEME_BATCH_SIZE);
      try {
        const proposals = await suggestThemesBatch(batch, existingThemes, allGuides, activeSource.options);
        for (const prop of proposals) {
          for (const theme of prop.themes) {
            const key = theme.toLowerCase();
            const entry = bucketMap.get(key) || { name: theme, cardIds: [] };
            if (!entry.cardIds.includes(prop.cardId)) entry.cardIds.push(prop.cardId);
            bucketMap.set(key, entry);
          }
        }
      } catch (e) {
        const msg = (e as Error)?.message || '';
        setError(/429|quota|rate/i.test(msg)
          ? `سهمیهٔ ${activeSource.name} تمام شد.`
          : `${activeSource.name} جواب نداد: ${msg.slice(0, 160)}`);
        break;
      }
      setProgress({ done: Math.min(i + THEME_BATCH_SIZE, todo.length), total: todo.length });
    }

    const builtGroups: ReviewGroup[] = Array.from(bucketMap.entries())
      .map(([key, val]) => ({
        key,
        originalName: val.name,
        editedName: val.name,
        cardIds: val.cardIds,
        selectedIds: new Set(val.cardIds),
      }))
      .sort((a, b) => b.cardIds.length - a.cardIds.length || a.originalName.localeCompare(b.originalName, 'fa'));

    setGroups(builtGroups);
    setStep('review');
  };

  const toggleCardInGroup = (groupKey: string, cardId: string) => {
    setGroups(prev =>
      prev.map(g => {
        if (g.key !== groupKey) return g;
        const nextSet = new Set(g.selectedIds);
        if (nextSet.has(cardId)) nextSet.delete(cardId);
        else nextSet.add(cardId);
        return { ...g, selectedIds: nextSet };
      }),
    );
  };

  const toggleWholeGroup = (groupKey: string, on: boolean) => {
    setGroups(prev =>
      prev.map(g => (g.key === groupKey ? { ...g, selectedIds: new Set(on ? g.cardIds : []) } : g)),
    );
  };

  const renameGroup = (groupKey: string, nextName: string) => {
    setGroups(prev =>
      prev.map(g => (g.key === groupKey ? { ...g, editedName: nextName } : g)),
    );
  };

  const totalSelectedAssignments = useMemo(() => {
    let n = 0;
    for (const g of groups) {
      if (normalizeThemeName(g.editedName)) n += g.selectedIds.size;
    }
    return n;
  }, [groups]);

  const handleSave = async () => {
    const assignments = new Map<string, string[]>();
    for (const g of groups) {
      const cleanName = normalizeThemeName(g.editedName);
      if (!cleanName) continue;
      for (const cardId of g.selectedIds) {
        const list = assignments.get(cardId) || [];
        list.push(cleanName);
        assignments.set(cardId, list);
      }
    }
    if (assignments.size === 0) return;
    setSaving(true);
    try {
      await onApply(assignments, scope === 'untagged' ? 'merge' : writeMode);
      onClose();
    } catch {
      setError('ذخیرهٔ بسته‌ها ناموفق بود. دوباره امتحان کن.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="theme-batch-title"
      onClick={step === 'setup' ? onClose : undefined}
    >
      <div
        dir="rtl"
        className="font-fa w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center gap-3">
          <h2 id="theme-batch-title" className="flex-1 text-xl font-extrabold text-ink dark:text-white">
            دسته‌بندی موضوعی کارت‌ها با هوش مصنوعی
          </h2>
          {step !== 'running' && (
            <button
              type="button"
              onClick={onClose}
              aria-label="بستن"
              className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <Icon.Close size={20} />
            </button>
          )}
        </header>

        {step === 'setup' && (
          <>
            <p className="text-sm leading-7 text-ink-muted dark:text-slate-300">
              هوش مصنوعی واژه‌ها را در بسته‌های صحنه‌ای و موضوعی (مثل جنگل، حیوانات، تاریخی) پیشنهاد می‌دهد؛ پیش از ذخیره، نام هر بسته و واژه‌هایش را خودت می‌بینی و ویرایش می‌کنی. دستهٔ اصلی کتاب‌ها تغییر نمی‌کند.
            </p>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-bold text-ink dark:text-white mb-1">کدام کارت‌ها بررسی شوند؟</legend>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="theme-scope"
                  checked={scope === 'untagged'}
                  onChange={() => setScope('untagged')}
                  className="mt-1 accent-brand-500"
                />
                <span>
                  <b>فقط کارت‌های بدون بسته</b>{' '}
                  <span className="text-ink-muted dark:text-slate-400">
                    ({fa(liveVocab.filter(c => !(c.themes && c.themes.length > 0)).length)} کارت)
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="theme-scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                  className="mt-1 accent-brand-500"
                />
                <span>
                  <b>همهٔ واژه‌ها</b>{' '}
                  <span className="text-ink-muted dark:text-slate-400">({fa(liveVocab.length)} کارت)</span>
                </span>
              </label>
            </fieldset>

            {scope === 'all' && (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-bold text-ink dark:text-white mb-1">کارت‌هایی که از قبل بسته دارند:</legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="theme-write-mode"
                      checked={writeMode === 'merge'}
                      onChange={() => setWriteMode('merge')}
                      className="accent-brand-500"
                    />
                    <span>بستهٔ جدید کنار قبلی‌ها اضافه شود</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="theme-write-mode"
                      checked={writeMode === 'replace'}
                      onChange={() => setWriteMode('replace')}
                      className="accent-brand-500"
                    />
                    <span>جایگزین بسته‌های قبلی شود</span>
                  </label>
                </div>
              </fieldset>
            )}

            <div className="flex flex-col gap-2">
              <label htmlFor="guide-themes-input" className="text-sm font-bold text-ink dark:text-white">
                بسته‌های دلخواه برای راهنمایی هوش مصنوعی (اختیاری)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {quickSuggestions.map(t => {
                  const active = pickedGuides.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleGuide(t)}
                      className={`min-h-[38px] px-3 rounded-xl text-xs font-bold border transition-colors whitespace-nowrap ${
                        active
                          ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-200'
                          : 'border-slate-200 dark:border-slate-600 text-ink-muted dark:text-slate-300 hover:border-brand-300'
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
              <input
                id="guide-themes-input"
                type="text"
                dir="rtl"
                value={guideText}
                onChange={e => setGuideText(e.target.value)}
                placeholder="مثلاً: نجوم، آشپزی، معماری (با کاما جدا کن)"
                className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-ink dark:text-white"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-bold text-ink dark:text-white">سرویس هوش مصنوعی</span>
                <select
                  value={sourceId}
                  onChange={e => setSourceId(e.target.value)}
                  disabled={aiSources.length === 0}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-ink dark:text-white"
                >
                  {aiSources.length === 0 ? (
                    <option value="">سرویسی تنظیم نشده</option>
                  ) : (
                    aiSources.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))
                  )}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-bold text-ink dark:text-white">حداکثر تعداد کارت</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={limit}
                  onChange={e => setLimit(Math.max(1, Math.min(200, Number(e.target.value) || 20)))}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-ink dark:text-white tabular-nums"
                />
              </label>
            </div>

            <p className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-4 text-sm leading-7 text-ink dark:text-slate-200">
              {aiSources.length === 0
                ? 'برای دسته‌بندی خودکار، ابتدا کلید یکی از سرویس‌های هوش مصنوعی را در «تنظیمات» وارد کن. ساخت دستی بسته‌ها بدون کلید هم همیشه فعال است.'
                : candidates.length === 0
                  ? 'همهٔ واژه‌ها از قبل بستهٔ موضوعی دارند. اگر می‌خواهی دوباره دسته‌بندی شوند، گزینهٔ «همهٔ واژه‌ها» را بزن.'
                  : <>{fa(count)} کارت از {fa(candidates.length)} کارت واجد شرایط، طی <b>{fa(requestCount)} درخواست</b> به <bdi dir="auto">{activeSource?.name || '—'}</bdi> فرستاده می‌شود.</>}
            </p>

            <div className="sticky bottom-0 -mx-5 sm:-mx-6 px-5 sm:px-6 py-3 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={onClose} className={quietBtn}>انصراف</button>
              <button
                type="button"
                onClick={runCategorization}
                disabled={!activeSource || candidates.length === 0}
                className={primaryBtn}
              >
                شروع دسته‌بندی هوشمند
              </button>
            </div>
          </>
        )}

        {step === 'running' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink dark:text-slate-200 tabular-nums">
              در حال دسته‌بندی: {fa(progress.done)} از {fa(progress.total)} کارت
            </p>
            <div className="h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div
                className="h-full bg-brand-500 transition-all"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
            <button
              type="button"
              disabled={stopping}
              onClick={() => {
                stopRef.current = true;
                setStopping(true);
              }}
              className={`${quietBtn} self-end`}
            >
              {stopping ? 'بعد از همین دسته می‌ایستد…' : 'توقف و دیدن پیشنهادها'}
            </button>
          </div>
        )}

        {step === 'review' && (
          <>
            {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
            {groups.length === 0 ? (
              <p className="text-sm text-ink-muted dark:text-slate-300">
                پیشنهادی دریافت نشد. اتصال یا کلید هوش مصنوعی را بررسی کن و دوباره امتحان کن.
              </p>
            ) : (
              <>
                <p className="text-sm text-ink dark:text-slate-200">
                  {fa(groups.length)} بسته پیشنهاد شد. می‌توانی نام هر بسته را ویرایش کنی (اگر دو بسته را هم‌نام کنی با هم یکی می‌شوند) یا تیک هر واژه را برداری.
                </p>
                <div className="flex flex-col gap-3">
                  {groups.map(group => {
                    const allChecked = group.selectedIds.size === group.cardIds.length;
                    return (
                      <div
                        key={group.key}
                        className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3.5 flex flex-col gap-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={allChecked && group.cardIds.length > 0}
                            onChange={e => toggleWholeGroup(group.key, e.target.checked)}
                            aria-label={`انتخاب همهٔ واژه‌های ${group.editedName}`}
                            className="w-5 h-5 accent-brand-500 shrink-0"
                          />
                          <input
                            type="text"
                            dir="rtl"
                            value={group.editedName}
                            onChange={e => renameGroup(group.key, e.target.value)}
                            aria-label="نام بستهٔ پیشنهادی"
                            className="flex-1 min-w-0 min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm font-bold text-ink dark:text-white"
                          />
                          <span className="text-xs text-ink-muted dark:text-slate-400 tabular-nums shrink-0">
                            {fa(group.selectedIds.size)} واژه
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {group.cardIds.map(cardId => {
                            const c = cardsById.get(cardId);
                            if (!c) return null;
                            const checked = group.selectedIds.has(cardId);
                            return (
                              <label
                                key={cardId}
                                className="flex items-center gap-2.5 min-h-[40px] px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 cursor-pointer text-sm"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleCardInGroup(group.key, cardId)}
                                  className="w-4 h-4 accent-brand-500 shrink-0"
                                />
                                <bdi dir="ltr" className="font-en font-bold text-ink dark:text-white truncate">{c.front}</bdi>
                                <span className="text-xs text-ink-muted dark:text-slate-400 truncate">{c.back}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="sticky bottom-0 -mx-5 sm:-mx-6 px-5 sm:px-6 py-3 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={onClose} className={quietBtn}>
                {groups.length ? 'انصراف' : 'بستن'}
              </button>
              {groups.length > 0 && (
                <button
                  type="button"
                  disabled={saving || totalSelectedAssignments === 0}
                  onClick={handleSave}
                  className={primaryBtn}
                >
                  {saving ? 'در حال ذخیره…' : `ذخیرهٔ ${fa(totalSelectedAssignments)} انتساب`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
