import React, { useEffect, useMemo } from 'react';
import { Chapter, Flashcard, Source, SpeechAttempt, StudyLog, UserProfile } from '../types';
import { dueSchedules, liveAttempts } from '../services/speechPractice';
import { minutesLeft, todayPlan, type PlanStep } from '../services/todayPlan';
import { lastDays, minutes, readingByDay } from '../services/readingTime';
import type { StudyMode, View } from '../hooks/useAppLogic';
import { stageCounts, STAGE_NAMES, MasteryStage } from '../services/masteryService';
import { dayString, weekStrip, weeklyReviewCounts } from '../services/calendar';
import { currentReading } from '../services/library';
import { fa, Icon, Kbd, STAGE_COLORS } from './common/ui';

interface TodayViewProps {
  userProfile: UserProfile | null;
  username?: string;
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
  speechAttempts?: SpeechAttempt[];
}

const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3 min-w-0 ${className}`}>{children}</section>
);

type Reading = { source: Source; next: { chapter: Chapter; chunk: number } | null } | undefined;

const STEP_TEXT: Record<PlanStep['id'], { title: string; done: string }> = {
  read: { title: 'خواندن بخش بعدی', done: 'بخش امروز خوانده شد' },
  review: { title: 'مرور کارت‌ها', done: 'کارت‌های امروز مرور شد' },
  speak: { title: 'تمرین تلفظ', done: 'تلفظ امروز تمرین شد' },
};

// The day's plan as a short checklist: what to do, roughly how long, one tap
// to start each part.
const TodayPlan: React.FC<{ steps: PlanStep[]; reading: Reading; onRead: () => void; onReview: () => void; onSpeak: () => void }> = ({ steps, reading, onRead, onReview, onSpeak }) => {
  const left = minutesLeft(steps);
  const start: Record<PlanStep['id'], () => void> = { read: onRead, review: onReview, speak: onSpeak };
  const detail = (s: PlanStep): string => {
    if (s.id === 'read') return reading?.next ? `${reading.source.title}${reading.next.chapter.title && reading.next.chapter.title !== reading.source.title ? ` · ${reading.next.chapter.title}` : ''}` : '';
    if (s.id === 'review') return `${fa(s.count)} کارت`;
    return `${fa(s.count)} جمله از کتاب‌هایت`;
  };
  return (
    <section aria-label="برنامهٔ امروز" className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3">
      <div className="flex justify-between items-baseline gap-3">
        <h2 className="font-bold text-ink dark:text-white">برنامهٔ امروز</h2>
        <span className="text-sm text-ink-muted dark:text-slate-400">{left > 0 ? `حدود ${fa(left)} دقیقه` : 'تمام شد'}</span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button type="button" onClick={start[s.id]} disabled={s.id === 'read' ? !reading?.next : s.done}
              className={`w-full flex items-center gap-3 min-h-[56px] px-3 rounded-2xl text-right ${s.done ? 'opacity-70' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}>
              <span aria-hidden="true" className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm font-bold ${s.done ? 'bg-emerald-600 text-white' : 'bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200'}`}>
                {s.done ? '✓' : fa(i + 1)}
              </span>
              <span className="flex-1 min-w-0 flex flex-col">
                <span className={`font-bold text-ink dark:text-white ${s.done ? 'line-through decoration-1' : ''}`}>{s.done ? STEP_TEXT[s.id].done : STEP_TEXT[s.id].title}</span>
                {!s.done && <span dir="auto" className="text-sm text-ink-muted dark:text-slate-400 truncate">{detail(s)}</span>}
              </span>
              {!s.done && <span className="text-sm text-ink-muted dark:text-slate-400 whitespace-nowrap">{fa(s.minutes)} دقیقه</span>}
              {s.done && s.id === 'read' && reading?.next && <span className="text-sm text-brand-600 dark:text-brand-300 whitespace-nowrap">ادامه بخوان</span>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
};

export const TodayView: React.FC<TodayViewProps> = ({
  userProfile, username, cards, studyLogs, sources, chapters, dueCount, newDueCount, onStartReview, onOpenSetup, onNavigate, onOpenChunk, speechAttempts = [],
}) => {

  const today = dayString(new Date());
  const studied = useMemo(() => new Set(studyLogs.map(l => l.date)), [studyLogs]);
  const week = weekStrip(studied, today);
  const weekly = weeklyReviewCounts(studyLogs.map(l => l.date), today);
  const stages = stageCounts(cards);
  // This week's reading, from every book's log.
  const readWeek = useMemo(() => {
    const days = readingByDay(sources.filter(s => !s.isDeleted));
    const week = lastDays(7);
    const sum = week.reduce((t, d) => { const r = days.get(d); return r ? { ms: t.ms + r.ms, sections: t.sections + r.sections } : t; }, { ms: 0, sections: 0 });
    return { ...sum, days: new Set(week.filter(d => (days.get(d)?.sections || 0) > 0)) };
  }, [sources]);
  const totalWords = cards.length;

  // The book or article read most recently and not finished yet.
  const reading = useMemo(() => currentReading(sources, chapters), [sources, chapters]);

  // Today's plan: the next section, the due cards, the due sentences.
  const plan = useMemo(() => {
    const cardIds = new Set(cards.map(c => c.id));
    const live = liveAttempts(speechAttempts);
    return todayPlan({
      hasBook: !!reading,
      // A section finished today moves its chapter's date to today.
      readToday: chapters.some(c => !c.isDeleted && c.completed.length > 0 && dayString(new Date(c.updatedAt)) === today),
      dueCards: dueCount,
      reviewedToday: studyLogs.filter(l => l.date === today).length,
      dueSpeech: dueSchedules(live, today).filter(x => !!x.cardId && cardIds.has(x.cardId)).length,
      speechToday: live.filter(a => dayString(new Date(a.createdAt)) === today).length,
    });
  }, [cards, speechAttempts, reading, chapters, today, dueCount, studyLogs]);

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
      </header>

      {plan.length > 0 && (
        <TodayPlan steps={plan} reading={reading} onRead={() => reading?.next && onOpenChunk(reading.next.chapter, reading.next.chunk)}
          onReview={() => onStartReview('flip')} onSpeak={() => onNavigate('PRACTICE')} />
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <section className="md:col-span-2 bg-brand-500 text-white rounded-3xl p-5 md:p-7 flex flex-wrap items-center gap-5 md:gap-7">
          <div className="flex-1 min-w-[15rem] flex flex-col gap-3">
            <div>
              <h2 className="text-xl md:text-2xl font-extrabold">
                {dueCount > 0 ? 'مرور کارت‌ها' : 'مرور'}
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
              <button type="button" onClick={() => onStartReview('cloze')} disabled={dueCount === 0} title="واژه در جملهٔ کتاب جا افتاده؛ بنویسش"
                className="min-h-[52px] px-4 rounded-2xl bg-white/15 hover:bg-white/25 font-bold disabled:opacity-40">جای خالی</button>
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
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center text-xs text-ink-muted dark:text-slate-400">
            {week.map((d, i) => (
              <div key={d.day} className={`flex flex-col items-center gap-1.5 ${d.status === 'today' ? 'font-bold text-ink dark:text-white' : ''}`}>
                <span>{WEEKDAYS[i]}</span>
                <span className={`w-8 h-8 rounded-[10px] flex items-center justify-center ${readWeek.days.has(d.day) ? 'bg-emerald-600 text-white' : studied.has(d.day) ? 'bg-emerald-200 dark:bg-emerald-800' : d.status === 'today' ? 'border-2 border-dashed border-slate-300 dark:border-slate-600' : 'bg-slate-100 dark:bg-slate-800'}`}
                  title={readWeek.days.has(d.day) ? 'کتاب خواندی' : studied.has(d.day) ? 'مرور کردی' : undefined} />
              </div>
            ))}
          </div>
          <p className="text-sm text-ink-muted dark:text-slate-400">
              در ۷ روز گذشته: {fa(minutes(readWeek.ms))} دقیقه خواندن، {fa(readWeek.sections)} بخش، {fa(weekly.thisWeek)} مرور. روزهای پررنگ روزهایی است که کتاب خواندی.
          </p>
        </Card>

        <Card>
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-ink dark:text-white">واژه‌هایت</h2>
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

        <Card className="md:col-span-2 order-first">
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
