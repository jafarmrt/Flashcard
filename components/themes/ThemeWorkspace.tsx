import React, { useMemo, useState } from 'react';
import type { Deck, Flashcard, PracticeAnswer } from '../../types';
import type { CardPlace } from '../../services/library';
import type { AiRequestOptions } from '../../services/geminiService';
import {
  cardHasTheme,
  normalizeThemeName,
  sameTheme,
  SCENE_ROLE_LABELS,
  type SceneRole,
  wordRoleOf,
} from '../../services/wordThemes';
import { isDue } from '../../services/srsService';
import { displayDeckName } from '../../services/drivingMode';
import { fa, Icon } from '../common/ui';
import { MicroStoryPractice } from './MicroStoryPractice';
import { ContrastPractice } from './ContrastPractice';

interface ThemeWorkspaceProps {
  themeName: string;
  allCards: Flashcard[];
  decks: Deck[];
  places?: Map<string, CardPlace[]>;
  practice?: PracticeAnswer[];
  aiOptions?: AiRequestOptions;
  userLevel?: string;
  onBack: () => void;
  onRenameTheme: (from: string, to: string) => Promise<void>;
  onDeleteTheme: (theme: string) => Promise<void>;
  onUpdateMembers: (theme: string, memberIds: Set<string>) => Promise<void>;
  onStudyCards: (cards: Flashcard[]) => void;
  onQuizCards: (cardIds: string[]) => void;
  onEditCard: (card: Flashcard) => void;
  onPracticeAnswer: (cardId: string, right: boolean, chose?: string) => void;
}

const ROLE_ORDER: SceneRole[] = ['nouns', 'verbs', 'modifiers', 'phrases'];

export const ThemeWorkspace: React.FC<ThemeWorkspaceProps> = ({
  themeName,
  allCards,
  decks,
  places,
  practice,
  aiOptions,
  userLevel,
  onBack,
  onRenameTheme,
  onDeleteTheme,
  onUpdateMembers,
  onStudyCards,
  onQuizCards,
  onEditCard,
  onPracticeAnswer,
}) => {
  const [mode, setMode] = useState<'overview' | 'story' | 'contrast' | 'members'>('overview');
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(themeName);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [draftMembers, setDraftMembers] = useState<Set<string>>(() => new Set());
  const [savingMembers, setSavingMembers] = useState(false);

  const liveVocab = useMemo(
    () => allCards.filter(c => !c.isDeleted && c.kind !== 'grammar'),
    [allCards],
  );

  const bundleCards = useMemo(
    () => liveVocab.filter(c => cardHasTheme(c, themeName)),
    [liveVocab, themeName],
  );

  const dueCount = useMemo(() => bundleCards.filter(c => isDue(c)).length, [bundleCards]);
  const decksById = useMemo(() => new Map(decks.map(d => [d.id, displayDeckName(d.name)])), [decks]);

  const byRole = useMemo(() => {
    const groups: Record<SceneRole, Flashcard[]> = { nouns: [], verbs: [], modifiers: [], phrases: [] };
    for (const card of bundleCards) {
      groups[wordRoleOf(card)].push(card);
    }
    return groups;
  }, [bundleCards]);

  if (mode === 'story') {
    return (
      <MicroStoryPractice
        themeName={themeName}
        cards={bundleCards}
        places={places}
        aiOptions={aiOptions}
        userLevel={userLevel}
        onAnswer={onPracticeAnswer}
        onBack={() => setMode('overview')}
      />
    );
  }

  if (mode === 'contrast') {
    return (
      <ContrastPractice
        themeName={themeName}
        cards={bundleCards}
        places={places}
        practice={practice}
        aiOptions={aiOptions}
        onAnswer={onPracticeAnswer}
        onBack={() => setMode('overview')}
      />
    );
  }

  const openMembersEditor = () => {
    setDraftMembers(new Set(bundleCards.map(c => c.id)));
    setMemberSearch('');
    setMode('members');
  };

  if (mode === 'members') {
    const q = memberSearch.trim().toLowerCase();
    const filtered = q
      ? liveVocab.filter(c => c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q))
      : liveVocab;

    const toggleMember = (id: string) => {
      setDraftMembers(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };

    const saveMembers = async () => {
      setSavingMembers(true);
      try {
        await onUpdateMembers(themeName, draftMembers);
        setMode('overview');
      } finally {
        setSavingMembers(false);
      }
    };

    return (
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-8 flex flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMode('overview')}
              aria-label="بازگشت به بسته"
              className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-ink dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
            >
              <Icon.Back size={20} />
            </button>
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold text-ink dark:text-white truncate">
                واژه‌های بستهٔ «{themeName}»
              </h2>
              <p className="text-xs text-ink-muted dark:text-slate-400 tabular-nums">
                {fa(draftMembers.size)} واژه انتخاب شده از {fa(liveVocab.length)} واژه
              </p>
            </div>
          </div>
        </header>

        <input
          type="search"
          dir="auto"
          value={memberSearch}
          onChange={e => setMemberSearch(e.target.value)}
          placeholder="جست‌وجوی واژه یا معنی برای افزودن یا برداشتن…"
          aria-label="جست‌وجوی واژه در کارت‌ها"
          className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-ink dark:text-white"
        />

        <div className="max-h-[52vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/60 border border-slate-200 dark:border-slate-700 rounded-2xl">
          {filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink-muted dark:text-slate-400">واژه‌ای با این جست‌وجو پیدا نشد.</p>
          ) : (
            filtered.map(c => {
              const checked = draftMembers.has(c.id);
              return (
                <label
                  key={c.id}
                  className="flex items-center gap-3 min-h-[48px] px-4 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMember(c.id)}
                    className="w-5 h-5 accent-brand-500 shrink-0"
                  />
                  <bdi dir="ltr" className="font-en font-bold text-ink dark:text-white">{c.front}</bdi>
                  <span className="text-sm text-ink-muted dark:text-slate-300 truncate flex-1">{c.back}</span>
                </label>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setMode('overview')}
            className="min-h-[44px] px-4 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            انصراف
          </button>
          <button
            type="button"
            disabled={savingMembers}
            onClick={saveMembers}
            className="min-h-[44px] px-5 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-50"
          >
            {savingMembers ? 'در حال ذخیره…' : 'ذخیرهٔ فهرست واژه‌ها'}
          </button>
        </div>
      </section>
    );
  }

  const submitRename = async () => {
    const clean = normalizeThemeName(draftName);
    if (clean && !sameTheme(clean, themeName)) {
      await onRenameTheme(themeName, clean);
    }
    setRenaming(false);
  };

  const quickRemoveCard = async (cardId: string) => {
    const nextIds = new Set(bundleCards.map(c => c.id));
    nextIds.delete(cardId);
    await onUpdateMembers(themeName, nextIds);
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-7 flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={onBack}
              aria-label="بازگشت به بسته‌های موضوعی"
              className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-ink dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
            >
              <Icon.Back size={20} />
            </button>
            <div className="min-w-0 flex-1">
              {renaming ? (
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    dir="rtl"
                    value={draftName}
                    onChange={e => setDraftName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitRename()}
                    autoFocus
                    aria-label="نام تازهٔ بسته"
                    className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-base font-bold text-ink dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={submitRename}
                    className="min-h-[44px] px-4 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600"
                  >
                    ذخیره
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(themeName);
                      setRenaming(false);
                    }}
                    className="min-h-[44px] px-3 rounded-xl text-sm font-bold text-ink-muted hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    لغو
                  </button>
                </div>
              ) : (
                <h2 className="text-2xl font-extrabold text-ink dark:text-white truncate">{themeName}</h2>
              )}
              <p className="mt-1 text-xs text-ink-muted dark:text-slate-400 tabular-nums">
                <span>{fa(bundleCards.length)} واژه</span>
                <span aria-hidden="true"> · </span>
                <span>{fa(dueCount)} موعد مرور</span>
                <span aria-hidden="true"> · </span>
                <span>مستقل از دستهٔ کتاب‌ها</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openMembersEditor}
              className="min-h-[44px] px-4 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              افزودن یا حذف واژه
            </button>
            {!renaming && (
              <button
                type="button"
                onClick={() => {
                  setDraftName(themeName);
                  setRenaming(true);
                }}
                className="min-h-[44px] px-3.5 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                تغییر نام
              </button>
            )}
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="min-h-[44px] px-3.5 rounded-xl text-sm font-bold text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 whitespace-nowrap"
              >
                حذف بسته
              </button>
            ) : (
              <div className="flex items-center gap-1.5 rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-1">
                <span className="text-xs text-red-800 dark:text-red-200">کارت‌ها پاک نمی‌شوند:</span>
                <button
                  type="button"
                  onClick={() => onDeleteTheme(themeName)}
                  className="min-h-[36px] px-3 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 whitespace-nowrap"
                >
                  تأیید حذف بسته
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="min-h-[36px] px-2.5 rounded-lg text-xs font-bold text-ink dark:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  انصراف
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-700/60">
          <button
            type="button"
            disabled={bundleCards.length === 0}
            onClick={() => setMode('story')}
            className="min-h-[48px] px-4 rounded-2xl text-sm font-extrabold text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            داستانک هم‌بافت
          </button>
          <button
            type="button"
            disabled={bundleCards.length < 2}
            onClick={() => setMode('contrast')}
            className="min-h-[48px] px-4 rounded-2xl text-sm font-bold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-900/60 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            تفکیک واژه‌های نزدیک
          </button>
          <button
            type="button"
            disabled={bundleCards.length === 0}
            onClick={() => onStudyCards(bundleCards)}
            className="min-h-[48px] px-4 rounded-2xl text-sm font-bold text-ink dark:text-slate-100 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            مرور فلش‌کارت‌ها
          </button>
          <button
            type="button"
            disabled={bundleCards.length < 2}
            onClick={() => onQuizCards(bundleCards.map(c => c.id))}
            className="min-h-[48px] px-4 rounded-2xl text-sm font-bold text-ink dark:text-slate-100 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            آزمون چهارگزینه‌ای
          </button>
        </div>
      </section>

      {bundleCards.length === 0 ? (
        <section className="bg-white dark:bg-slate-800 rounded-3xl p-8 text-center flex flex-col items-center gap-3">
          <p className="text-base font-bold text-ink dark:text-white">این بسته هنوز واژه‌ای ندارد.</p>
          <p className="text-sm text-ink-muted dark:text-slate-400 max-w-md">
            از میان کارت‌های فعلی‌ات واژه‌های مرتبط با «{themeName}» را انتخاب کن تا داستانک و تمرین تفکیک فعال شوند.
          </p>
          <button
            type="button"
            onClick={openMembersEditor}
            className="min-h-[44px] px-5 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600"
          >
            انتخاب واژه‌ها برای این بسته
          </button>
        </section>
      ) : (
        <div className="flex flex-col gap-4">
          {ROLE_ORDER.map(role => {
            const list = byRole[role];
            if (list.length === 0) return null;
            return (
              <section key={role} className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-base font-extrabold text-ink dark:text-white">{SCENE_ROLE_LABELS[role]}</h3>
                  <span className="text-xs text-ink-muted dark:text-slate-400 tabular-nums">{fa(list.length)} واژه</span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {list.map(card => {
                    const deckName = decksById.get(card.deckId);
                    const due = isDue(card);
                    return (
                      <div key={card.id} className="py-3 first:pt-1 last:pb-1 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                            <bdi dir="ltr" className="font-en text-base font-bold text-ink dark:text-white">{card.front}</bdi>
                            {card.partOfSpeech && (
                              <span dir="ltr" className="font-en text-xs text-ink-muted dark:text-slate-400">{card.partOfSpeech}</span>
                            )}
                            <span className="text-sm text-ink dark:text-slate-200">{card.back}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-ink-muted dark:text-slate-400 flex flex-wrap items-center gap-1.5">
                            {deckName && <bdi dir="auto" className="font-en">{deckName}</bdi>}
                            {deckName && due && <span aria-hidden="true">·</span>}
                            {due && <span className="text-brand-600 dark:text-brand-300">موعد مرور</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => onEditCard(card)}
                            aria-label={`ویرایش ${card.front}`}
                            className="min-h-[40px] px-3 rounded-xl text-xs font-bold text-ink-muted dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            ویرایش
                          </button>
                          <button
                            type="button"
                            onClick={() => quickRemoveCard(card.id)}
                            aria-label={`برداشتن ${card.front} از بستهٔ ${themeName}`}
                            title="برداشتن از این بسته"
                            className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-ink-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                          >
                            <Icon.Close size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
