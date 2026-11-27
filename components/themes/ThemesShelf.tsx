import React, { useEffect, useMemo, useState } from 'react';
import type { Deck, Flashcard, PracticeAnswer } from '../../types';
import type { CardPlace } from '../../services/library';
import type { AiRequestOptions } from '../../services/geminiService';
import type { RefreshSource } from '../../services/cardRefresh';
import {
  cardHasTheme,
  normalizeThemeName,
  sameTheme,
  SCENE_ROLE_SHORT,
  type SceneRole,
  STARTER_THEMES,
  themeSummaries,
} from '../../services/wordThemes';
import { fa, Icon } from '../common/ui';
import { ThemeWorkspace } from './ThemeWorkspace';
import { ThemeBatchModal } from './ThemeBatchModal';

interface ThemesShelfProps {
  cards: Flashcard[];
  decks: Deck[];
  savedThemes?: string[];
  places?: Map<string, CardPlace[]>;
  practice?: PracticeAnswer[];
  aiOptions?: AiRequestOptions;
  aiSources?: RefreshSource[];
  userLevel?: string;
  onCreateTheme: (name: string, memberIds: Set<string>) => Promise<void>;
  onRenameTheme: (from: string, to: string) => Promise<void>;
  onDeleteTheme: (theme: string) => Promise<void>;
  onUpdateMembers: (theme: string, memberIds: Set<string>) => Promise<void>;
  onApplyBatchThemes: (assignments: Map<string, string[]>, mode: 'merge' | 'replace') => Promise<void>;
  onStudyCards: (cards: Flashcard[]) => void;
  onQuizCards: (cardIds: string[]) => void;
  onEditCard: (card: Flashcard) => void;
  onPracticeAnswer: (cardId: string, right: boolean, chose?: string) => void;
}

const ROLE_KEYS: SceneRole[] = ['nouns', 'verbs', 'modifiers', 'phrases'];

export const ThemesShelf: React.FC<ThemesShelfProps> = ({
  cards,
  decks,
  savedThemes = [],
  places,
  practice,
  aiOptions,
  aiSources = [],
  userLevel,
  onCreateTheme,
  onRenameTheme,
  onDeleteTheme,
  onUpdateMembers,
  onApplyBatchThemes,
  onStudyCards,
  onQuizCards,
  onEditCard,
  onPracticeAnswer,
}) => {
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [cardQuery, setCardQuery] = useState('');
  const [pickedIds, setPickedIds] = useState<Set<string>>(() => new Set());
  const [savingNew, setSavingNew] = useState(false);

  const summaries = useMemo(
    () => themeSummaries(cards, savedThemes),
    [cards, savedThemes],
  );

  const liveVocab = useMemo(
    () => cards.filter(c => !c.isDeleted && c.kind !== 'grammar'),
    [cards],
  );

  const untaggedCount = useMemo(
    () => liveVocab.filter(c => !(c.themes && c.themes.length > 0)).length,
    [liveVocab],
  );

  useEffect(() => {
    if (activeTheme && !summaries.some(s => sameTheme(s.name, activeTheme))) {
      setActiveTheme(null);
    }
  }, [summaries, activeTheme]);

  const filteredCreateCards = useMemo(() => {
    const q = cardQuery.trim().toLowerCase();
    const list = q
      ? liveVocab.filter(c => c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q))
      : liveVocab;
    return list.slice(0, 40);
  }, [liveVocab, cardQuery]);

  if (activeTheme) {
    return (
      <ThemeWorkspace
        themeName={activeTheme}
        allCards={cards}
        decks={decks}
        places={places}
        practice={practice}
        aiOptions={aiOptions}
        userLevel={userLevel}
        onBack={() => setActiveTheme(null)}
        onRenameTheme={async (from, to) => {
          await onRenameTheme(from, to);
          setActiveTheme(normalizeThemeName(to) || null);
        }}
        onDeleteTheme={async theme => {
          await onDeleteTheme(theme);
          setActiveTheme(null);
        }}
        onUpdateMembers={onUpdateMembers}
        onStudyCards={onStudyCards}
        onQuizCards={onQuizCards}
        onEditCard={onEditCard}
        onPracticeAnswer={onPracticeAnswer}
      />
    );
  }

  const unusedStarters = STARTER_THEMES.filter(
    starter => !summaries.some(s => sameTheme(s.name, starter)),
  );

  const toggleCreateCard = (id: string) => {
    setPickedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = normalizeThemeName(newName);
    if (!clean || savingNew) return;
    setSavingNew(true);
    try {
      await onCreateTheme(clean, pickedIds);
      setNewName('');
      setCardQuery('');
      setPickedIds(new Set());
      setCreating(false);
      setActiveTheme(clean);
    } finally {
      setSavingNew(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <p className="text-sm text-ink-muted dark:text-slate-400">
          <span>واژه‌ها را بر پایهٔ صحنه و موضوع کنار هم بگذار تا با داستانک و تفکیک بهتر در ذهنت بمانند</span>
          {liveVocab.length > 0 && (
            <>
              <span aria-hidden="true"> · </span>
              <span className="tabular-nums">{fa(untaggedCount)} واژه بدون بسته</span>
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {liveVocab.length > 0 && (
            <button
              type="button"
              onClick={() => setBatchOpen(true)}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-bold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-900/60 transition-colors whitespace-nowrap"
            >
              <span>دسته‌بندی هوشمند کارت‌ها</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setCreating(v => !v)}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 transition-colors whitespace-nowrap"
          >
            <Icon.Plus size={18} />
            <span>بستهٔ تازه</span>
          </button>
        </div>
      </div>

      {creating && (
        <form
          onSubmit={handleCreateSubmit}
          className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-6 border border-slate-200 dark:border-slate-700 flex flex-col gap-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-extrabold text-ink dark:text-white">ساخت بستهٔ موضوعی تازه</h2>
            <button
              type="button"
              onClick={() => setCreating(false)}
              aria-label="بستن فرم بستهٔ تازه"
              className="min-h-[40px] min-w-[40px] rounded-full flex items-center justify-center text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <Icon.Close size={18} />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="new-theme-name" className="text-sm font-bold text-ink dark:text-white">
              نام بسته <span className="text-red-500">*</span>
            </label>
            <input
              id="new-theme-name"
              type="text"
              dir="rtl"
              required
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="مثلاً: جنگل و طبیعت، حیوانات، تاریخی…"
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-ink dark:text-white"
            />
            {unusedStarters.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-xs text-ink-muted dark:text-slate-400 me-1">پیشنهاد آماده:</span>
                {unusedStarters.slice(0, 6).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewName(t)}
                    className="min-h-[36px] px-3 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-600 text-ink dark:text-slate-200 hover:border-brand-400 whitespace-nowrap"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {liveVocab.length > 0 && (
            <div className="flex flex-col gap-2">
              <label htmlFor="new-theme-card-search" className="text-sm font-bold text-ink dark:text-white">
                انتخاب واژه‌های اولیه ({fa(pickedIds.size)} انتخاب شده — اختیاری)
              </label>
              <input
                id="new-theme-card-search"
                type="search"
                dir="auto"
                value={cardQuery}
                onChange={e => setCardQuery(e.target.value)}
                placeholder="جست‌وجوی واژه یا معنی…"
                className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-ink dark:text-white"
              />
              <div className="max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-2 rounded-2xl border border-slate-200 dark:border-slate-700">
                {filteredCreateCards.map(c => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2.5 min-h-[40px] px-2.5 py-1 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={pickedIds.has(c.id)}
                      onChange={() => toggleCreateCard(c.id)}
                      className="w-4 h-4 accent-brand-500 shrink-0"
                    />
                    <bdi dir="ltr" className="font-read font-bold text-ink dark:text-white truncate">{c.front}</bdi>
                    <span className="text-xs text-ink-muted dark:text-slate-400 truncate">{c.back}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="min-h-[44px] px-4 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={!normalizeThemeName(newName) || savingNew}
              className="min-h-[44px] px-5 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-40"
            >
              {savingNew ? 'در حال ساختن…' : 'ساخت بسته'}
            </button>
          </div>
        </form>
      )}

      {summaries.length === 0 ? (
        <section className="bg-white dark:bg-slate-800 rounded-3xl py-14 px-6 text-center flex flex-col items-center gap-3">
          <span className="w-14 h-14 rounded-2xl bg-brand-100 text-brand-500 dark:bg-brand-900/60 dark:text-brand-200 flex items-center justify-center">
            <Icon.Layers size={28} />
          </span>
          <h2 className="text-xl font-extrabold text-ink dark:text-white">هنوز بستهٔ موضوعی نساخته‌ای</h2>
          <p className="text-sm text-ink-muted dark:text-slate-400 max-w-lg leading-7">
            واژه‌های مربوط به یک فضا یا موضوع (مثل «جنگل و طبیعت»، «حیوانات»، «تاریخی») را در یک بسته بگذار تا هم‌زمان در دسته‌های کتاب‌هایت بمانند و این‌جا با داستانک کوتاه و تفکیک واژه‌های نزدیک تمرین شوند.
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="min-h-[44px] px-5 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 whitespace-nowrap"
            >
              ساخت اولین بسته
            </button>
            {liveVocab.length > 0 && (
              <button
                type="button"
                onClick={() => setBatchOpen(true)}
                className="min-h-[44px] px-5 rounded-xl text-sm font-bold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 whitespace-nowrap"
              >
                پیشنهاد هوشمند از کارت‌های فعلی
              </button>
            )}
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {summaries.map(summary => {
            const roleParts = ROLE_KEYS.filter(r => summary.roles[r] > 0).map(
              r => `${fa(summary.roles[r])} ${SCENE_ROLE_SHORT[r]}`,
            );
            const dueProgress = summary.cardCount > 0 ? (summary.dueCount / summary.cardCount) * 100 : 0;
            return (
              <div
                key={summary.name}
                className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col justify-between gap-4 min-w-0 transition-transform hover:-translate-y-0.5"
              >
                <div className="flex flex-col gap-1.5 min-w-0">
                  <h3 className="text-xl font-bold text-ink dark:text-white truncate">{summary.name}</h3>
                  <p className="text-xs text-ink-muted dark:text-slate-400 tabular-nums">
                    <span>{fa(summary.cardCount)} واژه</span>
                    {roleParts.length > 0 && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span>{roleParts.join(' · ')}</span>
                      </>
                    )}
                  </p>
                  {summary.previewWords.length > 0 && (
                    <p dir="ltr" className="font-read text-xs text-ink-muted dark:text-slate-400 truncate text-right pt-0.5">
                      {summary.previewWords.join(' · ')}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  <div>
                    <div className="flex justify-between items-center mb-1.5 text-xs font-bold tabular-nums">
                      <span className="text-brand-600 dark:text-brand-300">موعد مرور</span>
                      <span className="text-ink-muted dark:text-slate-300">
                        {fa(summary.dueCount)} از {fa(summary.cardCount)}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${dueProgress}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      aria-label={`باز کردن و تمرین بستهٔ ${summary.name}`}
                      onClick={() => setActiveTheme(summary.name)}
                      className="flex-1 min-h-[44px] px-4 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 transition-colors whitespace-nowrap"
                    >
                      باز کردن و تمرین
                    </button>
                    <button
                      type="button"
                      aria-label={`مرور بستهٔ ${summary.name}`}
                      disabled={summary.cardCount === 0}
                      onClick={() => onStudyCards(liveVocab.filter(c => cardHasTheme(c, summary.name)))}
                      className="min-h-[44px] px-3.5 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap"
                    >
                      مرور
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {batchOpen && (
        <ThemeBatchModal
          cards={liveVocab}
          existingThemes={summaries.map(s => s.name)}
          sources={aiSources}
          onApply={onApplyBatchThemes}
          onClose={() => setBatchOpen(false)}
        />
      )}
    </div>
  );
};
