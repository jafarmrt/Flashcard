import React, { useEffect, useMemo } from 'react';
import { Chapter, Flashcard, Source, StudyLog, UserProfile } from '../types';
import type { StudyMode, View } from '../hooks/useAppLogic';
import { calculateLevel } from '../services/gamificationService';
import { stageCounts, STAGE_NAMES, MasteryStage } from '../services/masteryService';
import { availableFreezes, dayString, weekStrip, weeklyReviewCounts } from '../services/streakService';
import { chaptersOf, continuePoint, sourceProgress } from '../services/library';
import { DEFAULT_DAILY_REVIEW_GOAL } from '../services/xpRules';
import { fa, GoalRing, Icon, Kbd, STAGE_COLORS, StreakChip } from './common/ui';

interface TodayViewProps {
  userProfile: UserProfile | null;
  username?: string;
  streak: number;
  cards: Flashcard[];
  studyLogs: StudyLog[];
  sources: Source[];
  chapters: Chapter[];
  dueCount: number;
  newDueCount: number;
  onStartReview: (mode: StudyMode) => void;
  onOpenSetup: () => void;
  onNavigate: (view: View) => void;
  onOpenChunk: (chapter: Chapter, index: number) => void;
}

const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
const DAY_STYLE = {
  studied: 'bg-flame-500',
  frozen: 'bg-sky-200 text-sky-800 dark:bg-sky-800 dark:text-sky-100',
  missed: 'bg-slate-200 dark:bg-slate-700',
  today: 'border-2 border-dashed border-flame-500',
  future: 'bg-slate-100 dark:bg-slate-800',
};

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3 min-w-0 ${className}`}>{children}</section>
);

export const TodayView: React.FC<TodayViewProps> = ({
  userProfile, username, streak, cards, studyLogs, sources, chapters, dueCount, newDueCount, onStartReview, onOpenSetup, onNavigate, onOpenChunk,
}) => {
  const level = calculateLevel(userProfile?.xp || 0);
  const goal = userProfile?.dailyGoals?.goals.find(g => g.type === 'STUDY');
  const goalTarget = goal?.target || DEFAULT_DAILY_REVIEW_GOAL;
  const goalDone = goal?.progress || 0;
  const remaining = Math.max(0, goalTarget - goalDone);

  const today = dayString(new Date());
  const studied = useMemo(() => new Set(studyLogs.map(l => l.date)), [studyLogs]);
  const frozen = useMemo(() => new Set(userProfile?.frozenDates || []), [userProfile]);
  const week = weekStrip(studied, frozen, today);
  const weekly = weeklyReviewCounts(studyLogs.map(l => l.date), today);
  const freezes = availableFreezes(userProfile?.streakFreezesEarned, userProfile?.frozenDates);
  const stages = stageCounts(cards);
  const totalWords = cards.length;

  // The book or article read most recently and not finished yet.
  const reading = useMemo(() => {
    const open = sources
      .filter(s => !s.isDeleted)
      .map(source => {
        const list = chaptersOf(source.id, chapters);
        return { source, list, progress: sourceProgress(list), next: continuePoint(source, list) };
      })
      .filter(r => r.next && !r.progress.finished)
      .sort((a, b) => b.source.updatedAt.localeCompare(a.source.updatedAt));
    return open[0];
  }, [sources, chapters]);

  // Space starts the review from anywhere on this screen (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== 'Space' || dueCount === 0 || el.closest('input, textarea, select, button, [contenteditable]')) return;
      e.preventDefault();
      onStartReview('flip');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dueCount, onStartReview]);

  const greeting = userProfile?.firstName || username || '';
  const dateLabel = new Date().toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div dir="rtl" className="font-fa flex flex-col gap-5 max-w-5xl mx-auto w-full">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink-muted dark:text-slate-400">{dateLabel}</p>
          <h1 className="text-2xl md:text-3xl font-extrabold text-ink dark:text-white">سلام{greeting ? ` ${greeting}` : ''}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <StreakChip streak={streak} />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200 px-3 py-1.5 font-bold text-sm">
            <Icon.Star size={15} />سطح {fa(level.level)}
            <span className="hidden sm:inline font-normal">· {fa(level.xpForNextLevel - level.xp)} امتیاز تا سطح بعد</span>
          </span>
        </div>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="md:col-span-2 bg-brand-500 text-white rounded-3xl p-5 md:p-7 flex flex-wrap items-center gap-5 md:gap-7">
          <GoalRing value={goalDone} target={goalTarget} size={104} />
          <div className="flex-1 min-w-[15rem] flex flex-col gap-3">
            <div>
              <h2 className="text-xl md:text-2xl font-extrabold">
                {remaining > 0 ? `هدف امروز: ${fa(remaining)} مرور دیگر` : 'هدف امروز کامل شد'}
              </h2>
              <p className="mt-1 text-sm md:text-base text-white/90">
                {dueCount > 0
                  ? `${fa(dueCount)} کارت موعد دارد${newDueCount > 0 ? `، ${fa(newDueCount)} تا تازه` : ''}.`
                  : 'کارت موعدداری نمانده. با مرور آزاد یا یک بخش تازه از متن ادامه بده.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {dueCount > 0 ? (
                <button type="button" onClick={() => onStartReview('flip')}
                  className="inline-flex items-center gap-2.5 min-h-[52px] px-6 rounded-2xl bg-white text-ink font-extrabold text-lg hover:bg-brand-50">
                  شروع مرور
                  <span className="rounded-full bg-brand-100 text-brand-700 text-sm px-2.5 py-0.5">{fa(dueCount)} کارت</span>
                  <Kbd className="text-ink-muted">Space</Kbd>
                </button>
              ) : (
                <button type="button" onClick={onOpenSetup} disabled={totalWords === 0}
                  className="inline-flex items-center min-h-[52px] px-6 rounded-2xl bg-white text-ink font-extrabold text-lg hover:bg-brand-50 disabled:opacity-50">
                  مرور آزاد
                </button>
              )}
              <button type="button" onClick={() => onStartReview('type')} disabled={dueCount === 0}
                className="min-h-[52px] px-4 rounded-2xl bg-white/15 hover:bg-white/25 font-bold disabled:opacity-40">نوشتنی</button>
              <button type="button" onClick={() => onNavigate('PRACTICE')} disabled={totalWords === 0}
                className="min-h-[52px] px-4 rounded-2xl bg-white/15 hover:bg-white/25 font-bold disabled:opacity-40">مکالمه و آزمون</button>
              <button type="button" onClick={onOpenSetup} disabled={totalWords === 0}
                className="min-h-[52px] px-4 rounded-2xl bg-white/15 hover:bg-white/25 font-bold disabled:opacity-40">انتخاب دسته</button>
            </div>
          </div>
        </section>

        <Card>
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-ink dark:text-white">این هفته</h2>
            <span className="flex items-center gap-1 text-xs text-ink-muted dark:text-slate-400">
              <Icon.Shield size={14} />{freezes > 0 ? `${fa(freezes)} محافظ زنجیره` : 'محافظی نداری'}
            </span>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center text-xs text-ink-muted dark:text-slate-400">
            {week.map((d, i) => (
              <div key={d.day} className={`flex flex-col items-center gap-1.5 ${d.status === 'today' ? 'font-bold text-ink dark:text-white' : ''}`}>
                <span>{WEEKDAYS[i]}</span>
                <span className={`w-8 h-8 rounded-[10px] flex items-center justify-center ${DAY_STYLE[d.status]}`}
                  title={d.status === 'frozen' ? 'محافظ زنجیره' : undefined}>
                  {d.status === 'frozen' && <Icon.Shield size={15} />}
                </span>
              </div>
            ))}
          </div>
          <p className="text-sm text-ink-muted dark:text-slate-400">
            {fa(weekly.thisWeek)} مرور در ۷ روز گذشته، {fa(weekly.lastWeek)} در هفتهٔ قبلش.
            {weekly.thisWeek > weekly.lastWeek && weekly.lastWeek > 0 ? ' از خودت جلو افتادی.' : ''}
          </p>
        </Card>

        <Card>
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-ink dark:text-white">باغ واژه‌ها</h2>
            <button type="button" onClick={() => onNavigate('DECKS')} className="text-sm text-brand-500 dark:text-brand-300 hover:underline">{fa(totalWords)} واژه</button>
          </div>
          {totalWords > 0 ? (
            <>
              <div className="flex h-3.5 rounded-full overflow-hidden gap-0.5" role="img"
                aria-label={([0, 1, 2, 3, 4] as MasteryStage[]).map(s => `${STAGE_NAMES[s]} ${fa(stages[s])}`).join('، ')}>
                {([0, 1, 2, 3, 4] as MasteryStage[]).map(s => stages[s] > 0 && (
                  <div key={s} className={STAGE_COLORS[s]} style={{ flex: stages[s] }} />
                ))}
              </div>
              <div className="flex flex-wrap justify-between gap-x-3 text-xs text-ink-muted dark:text-slate-400">
                {([0, 1, 2, 3, 4] as MasteryStage[]).map(s => <span key={s}>{STAGE_NAMES[s]} {fa(stages[s])}</span>)}
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-muted dark:text-slate-400">هنوز واژه‌ای نداری. یک متن بخوان یا کارت تازه بساز.</p>
          )}
        </Card>

        <Card className="md:col-span-2">
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-ink dark:text-white">{reading ? 'ادامهٔ خواندن' : 'خواندن کتاب و مقاله'}</h2>
            <button type="button" onClick={() => onNavigate('TEXTS')} className="text-sm text-brand-500 dark:text-brand-300 hover:underline">کتابخانه</button>
          </div>
          {reading && reading.next ? (
            <button type="button" onClick={() => onOpenChunk(reading.next!.chapter, reading.next!.chunk)} className="flex items-center gap-4 text-right rounded-2xl p-1 -m-1 hover:bg-slate-50 dark:hover:bg-slate-700/50">
              <span className="w-12 h-12 rounded-2xl bg-brand-100 text-brand-500 dark:bg-brand-900/60 dark:text-brand-200 flex items-center justify-center shrink-0"><Icon.Book /></span>
              <span className="flex-1 min-w-0 flex flex-col gap-2">
                <span dir="auto" className="font-en font-bold text-ink dark:text-white truncate">{reading.source.title}</span>
                <span className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" role="progressbar" aria-valuenow={reading.progress.percent} aria-valuemin={0} aria-valuemax={100}>
                  <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${reading.progress.percent}%` }} />
                </span>
                {reading.list.length > 1 && <span dir="auto" className="text-xs text-ink-muted dark:text-slate-400 truncate">{reading.next.chapter.title}</span>}
              </span>
              <span className="text-sm text-ink-muted dark:text-slate-400 whitespace-nowrap">
                {reading.list.length > 1 ? `${fa(reading.progress.percent)}٪ خوانده شده` : `بخش ${fa(reading.next.chunk + 1)} از ${fa(reading.next.chapter.chunkCount)}`}
              </span>
            </button>
          ) : (
            <p className="text-sm text-ink-muted dark:text-slate-400">
              یک کتاب (EPUB)، مقاله یا متن انگلیسی به کتابخانه اضافه کن تا به بخش‌های ۳۰۰ واژه‌ای تقسیم شود و واژه‌های سختش کارت شوند.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
};
