import React, { useEffect, useMemo, useState } from 'react';
import {
  Chapter,
  ChapterText,
  ExtractedWordCard,
  Flashcard,
  KnownWord,
  LessonDuration,
  SavedStudyLesson,
  Source,
  SpeechAttempt,
  StudyLog,
  TextNote,
  UserProfile,
} from '../types';
import { dueSchedules, liveAttempts } from '../services/speechPractice';
import { minutesLeft, todayPlan, type PlanStep } from '../services/todayPlan';
import { lastDays, readingByDay } from '../services/readingTime';
import type { StudyMode, View } from '../hooks/useAppLogic';
import { stageCounts, STAGE_NAMES, MasteryStage } from '../services/masteryService';
import { dayString, weekStrip } from '../services/calendar';
import { currentReading } from '../services/library';
import { weekSummary } from '../services/weekSummary';
import { nextReading, readingInvite, readOn, type ReadingInvite } from '../services/readingInvite';
import { backupDue, daysSinceBackup } from '../services/backup';
import { DEFAULT_REVIEW_BATCH, REVIEW_BATCH_OPTIONS } from '../services/dailyQueue';
import { LESSON_BLUEPRINTS, LESSON_DURATIONS, liveStudyLessons, todayOpenLesson } from '../services/studyLesson';
import { DriveBookmarksTray } from './driving/DriveBookmarksTray';
import { fa, Icon, Kbd, STAGE_COLORS } from './common/ui';

const NO_KNOWN: KnownWord[] = [];
const NO_NOTES: TextNote[] = [];
const NO_FLAGS: string[] = [];
const NO_LESSONS: SavedStudyLesson[] = [];

interface TodayViewProps {
  userProfile: UserProfile | null;
  username?: string;
  cards: Flashcard[];
  studyLogs: StudyLog[];
  sources: Source[];
  chapters: Chapter[];
  dueCount: number; // bounded session queue count (services/dailyQueue)
  totalDueCount?: number; // total due cards before batch cap
  remainingDueCount?: number; // due cards waiting for later batches today
  reviewBatchSize?: number;
  onChangeReviewBatchSize?: (size: number) => void;
  studyLessons?: SavedStudyLesson[];
  onOpenLesson?: (duration?: LessonDuration) => void;
  heldBack?: number; // new cards left for the next days by the daily cap
  knownWords?: KnownWord[];
  notes?: TextNote[];
  flaggedCardIds?: string[];
  onMoreNew?: () => void; // start ten of the new cards kept for later
  loadText?: (chapterId: string) => Promise<ChapterText>; // for the first lines of the next section
  newDueCount: number;
  onStartReview: (mode: StudyMode) => void;
  onOpenSetup: () => void;
  onNavigate: (view: View) => void;
  onOpenChunk: (chapter: Chapter, index: number) => void;
  onOpenBookChunk?: (sourceId: string, chapterId: string, chunk: number) => void;
  onDismissDriveNote?: (noteId: string) => void;
  onSaveDriveCard?: (sourceId: string, chapterId: string, chunk: number, card: ExtractedWordCard) => Promise<number>;
  onStudyCustomCards?: (cards: Flashcard[], title: string) => void;
  onUnflagDriveCard?: (cardId: string) => void;
  onClearDriveFlags?: () => void;
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
  userProfile, username, cards, studyLogs, sources, chapters, dueCount,
  totalDueCount = dueCount, remainingDueCount = 0, reviewBatchSize = DEFAULT_REVIEW_BATCH,
  onChangeReviewBatchSize, studyLessons = NO_LESSONS, onOpenLesson,
  newDueCount, heldBack = 0, knownWords = NO_KNOWN,
  notes = NO_NOTES, flaggedCardIds = NO_FLAGS, onMoreNew, loadText, onStartReview, onOpenSetup, onNavigate, onOpenChunk,
  onOpenBookChunk, onDismissDriveNote, onSaveDriveCard, onStudyCustomCards, onUnflagDriveCard, onClearDriveFlags, speechAttempts = [],
}) => {
  const today = dayString(new Date());
  const openLessonToday = useMemo(() => todayOpenLesson(studyLessons, today), [studyLessons, today]);
  const completedLessonsToday = useMemo(
    () => liveStudyLessons(studyLessons).filter(l => l.day === today && l.status === 'completed'),
    [studyLessons, today],
  );
  const allRecordedLessonsCount = useMemo(() => liveStudyLessons(studyLessons).length, [studyLessons]);
  const studied = useMemo(() => new Set(studyLogs.map(l => l.date)), [studyLogs]);
  const week = weekStrip(studied, today);
  const stages = stageCounts(cards);
  // This week's reading, from every book's log.
  const readWeek = useMemo(() => {
    const days = readingByDay(sources.filter(s => !s.isDeleted));
    const week = lastDays(7);
    const sum = week.reduce((t, d) => { const r = days.get(d); return r ? { ms: t.ms + r.ms, sections: t.sections + r.sections } : t; }, { ms: 0, sections: 0 });
    return { ...sum, days: new Set(week.filter(d => (days.get(d)?.sections || 0) > 0)) };
  }, [sources]);
  const totalWords = cards.length;
  const backupDays = daysSinceBackup();
  const needsBackup = backupDue(backupDays, cards.length);
  const summary = useMemo(() => weekSummary({ sources, cards, logs: studyLogs, knownWords }), [sources, cards, studyLogs, knownWords]);

  // The book or article read most recently and not finished yet.
  const reading = useMemo(() => currentReading(sources, chapters), [sources, chapters]);

  // Today's plan: the next section, the due cards, the due sentences.
  const plan = useMemo(() => {
    const cardIds = new Set(cards.map(c => c.id));
    const live = liveAttempts(speechAttempts);
    return todayPlan({
      hasBook: !!reading,
      // A section finished today is in its book's reading log. (The chapter's
      // date was used, which an edit of the text also moved to today.)
      readToday: readOn(sources, today),
      dueCards: dueCount,
      reviewedToday: studyLogs.filter(l => l.date === today).length,
      dueSpeech: dueSchedules(live, today).filter(x => !!x.cardId && cardIds.has(x.cardId)).length,
      speechToday: live.filter(a => dayString(new Date(a.createdAt)) === today).length,
    });
  }, [cards, speechAttempts, reading, sources, today, dueCount, studyLogs]);

  // The first lines of the next section, and the last ones read: starting is
  // the hard part, so the start is on the page already (services/readingInvite).
  const readToday = readOn(sources, today);
  const nextId = reading?.next ? `${reading.next.chapter.id}:${reading.next.chunk}` : '';
  const [invite, setInvite] = useState<ReadingInvite | null>(null);
  useEffect(() => {
    let alive = true;
    setInvite(null);
    const next = nextReading(sources, chapters);
    if (!next || !loadText) return;
    (async () => {
      try {
        const text = await loadText(next.chapter.id);
        const previous = next.previous ? await loadText(next.previous.id).catch(() => null) : null;
        if (alive) setInvite(readingInvite(next, text.chunks, previous?.chunks));
      } catch {
        // The text is not on this device and the server did not answer: the
        // card shows without the lines.
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextId]);
  const restOfPlan = reading?.next ? plan.filter(step => step.id !== 'read') : plan;

  // Space starts the review from anywhere on this screen (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== 'Space' || dueCount === 0 || el.closest('input, textarea, select, button, [contenteditable]')) return;
      e.preventDefault();
      onStartReview('auto');
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
        {(sources.some(s => !s.isDeleted) || cards.length > 0) && (
          <button
            type="button"
            onClick={() => onNavigate('DRIVING')}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-2xl bg-white dark:bg-slate-800 border border-stone-200/80 dark:border-slate-700 text-sm font-bold text-ink dark:text-slate-100 hover:border-brand-400 transition-colors whitespace-nowrap"
          >
            <Icon.Headphones size={18} className="text-brand-600 dark:text-brand-300" />
            <span>حالت رانندگی</span>
          </button>
        )}
      </header>

      {onDismissDriveNote && onSaveDriveCard && onOpenBookChunk && onStudyCustomCards && onUnflagDriveCard && onClearDriveFlags && (
        <DriveBookmarksTray
          notes={notes}
          sources={sources}
          chapters={chapters}
          cards={cards}
          knownWords={knownWords}
          flaggedCardIds={flaggedCardIds}
          onDismissNote={onDismissDriveNote}
          onOpenChunk={onOpenBookChunk}
          onSaveReaderCard={onSaveDriveCard}
          onStudyFlaggedCards={list => onStudyCustomCards(list, 'واژه‌های نشان‌گذاری‌شده در رانندگی')}
          onUnflagCard={onUnflagDriveCard}
          onClearFlaggedCards={onClearDriveFlags}
        />
      )}

      {reading?.next && (
        <section aria-label="ادامهٔ کتاب" className="bg-white dark:bg-slate-800 rounded-3xl p-5 md:p-6 flex flex-col gap-3">
          <div className="flex justify-between items-baseline gap-3">
            <h2 className="font-extrabold text-lg text-ink dark:text-white">{readToday ? 'امروز خواندی. یک بخش دیگر؟' : 'فقط همین یک بخش'}</h2>
            {invite && <span className="text-sm text-ink-muted dark:text-slate-400 whitespace-nowrap">حدود {fa(invite.minutes)} دقیقه</span>}
          </div>
          <p className="text-sm text-ink-muted dark:text-slate-400">
            <bdi dir="auto" className="font-read font-bold text-ink dark:text-white">{reading.source.title}</bdi>
            {reading.list.length > 1 && reading.next.chapter.title !== reading.source.title && <> · <bdi dir="auto" className="font-read">{reading.next.chapter.title}</bdi></>}
            {' · '}بخش {fa(reading.next.chunk + 1)} از {fa(reading.next.chapter.chunkCount)}
          </p>
          {invite?.before && (
            <div className="flex flex-col gap-0.5 text-sm text-ink-muted dark:text-slate-400">
              <span>کجا بودیم:</span>
              <p dir="ltr" lang="en" className="font-read italic leading-relaxed text-left">{invite.before}</p>
            </div>
          )}
          {invite && <p dir="ltr" lang="en" className="font-read text-[17px] leading-8 text-slate-800 dark:text-slate-100 text-left">{invite.teaser}</p>}
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={() => onOpenChunk(reading.next!.chapter, reading.next!.chunk)}
              className="inline-flex items-center gap-2 min-h-[52px] px-7 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold text-lg">
              <Icon.Book size={20} />{invite ? 'ادامه بده' : 'بخوان'}
            </button>
            <button type="button" onClick={() => onNavigate('DRIVING')}
              className="inline-flex items-center gap-2 min-h-[52px] px-5 rounded-2xl bg-stone-100 hover:bg-stone-200/80 dark:bg-slate-700 dark:hover:bg-slate-600 text-ink dark:text-slate-100 font-bold text-sm">
              <Icon.Headphones size={18} />پیوسته‌خوانی صوتی
            </button>
          </div>
        </section>
      )}

      {restOfPlan.length > 0 && (
        <TodayPlan steps={restOfPlan} reading={reading} onRead={() => reading?.next && onOpenChunk(reading.next.chapter, reading.next.chunk)}
          onReview={() => onStartReview('auto')} onSpeak={() => onNavigate('PRACTICE')} />
      )}

      {needsBackup && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 px-4 py-2.5 text-sm">
          <span className="flex-1 min-w-[12rem]">{backupDays === null ? 'هنوز از حسابت پشتیبان نگرفته‌ای.' : `آخرین پشتیبان ${fa(backupDays)} روز پیش بود.`} یک فایل پشتیبان، کارت‌ها و کتاب‌هایت را از هر اتفاقی نگه می‌دارد.</span>
          <button type="button" onClick={() => onNavigate('SETTINGS')} className="font-bold underline underline-offset-4">پشتیبان بگیر</button>
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {totalWords === 0 ? (
          // A new account: no batch sizes and no review modes for zero cards,
          // only where cards come from.
          <section className="md:col-span-2 bg-white dark:bg-slate-800 rounded-3xl p-5 md:p-7 flex flex-col gap-2 border border-stone-200/80 dark:border-slate-700">
            <h2 className="text-lg font-extrabold text-ink dark:text-white">مرور واژه‌ها</h2>
            <p className="text-sm text-ink-muted dark:text-slate-300 leading-relaxed">هنوز کارتی نداری. هنگام خواندن روی هر واژه‌ای که نمی‌دانی بزن و «+ کارت» را بزن؛ مرورش از همین‌جا شروع می‌شود.</p>
          </section>
        ) : (
        <section className="md:col-span-2 bg-brand-500 text-white rounded-3xl p-5 md:p-7 flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex-1 min-w-[15rem]">
              <h2 className="text-xl md:text-2xl font-extrabold">
                {dueCount > 0 ? 'مرور هدفمند کارت‌ها' : 'مرور واژه‌ها'}
              </h2>
              <p className="mt-1 text-sm md:text-base text-white/90 leading-relaxed">
                {dueCount > 0
                  ? `${fa(dueCount)} واژه در این نوبت${newDueCount > 0 ? ` (${fa(newDueCount)} تازه)` : ''}${
                      remainingDueCount > 0
                        ? ` · از مجموع ${fa(totalDueCount)} کارت موعددار امروز (${fa(remainingDueCount)} واژه برای نوبت بعدی می‌ماند)`
                        : ''
                    }.${heldBack > 0 ? ` ${fa(heldBack)} کارت تازه هم طبق سقف روزانه برای فردا کنار گذاشته شد.` : ''}`
                  : heldBack > 0
                    ? `نوبت‌های امروز تمام شد. ${fa(heldBack)} کارت تازه برای روزهای بعد مانده؛ اگر وقت داری چندتایش را شروع کن.`
                    : 'کارت موعدداری نمانده. می‌توانی جلسهٔ آموزشی زمان‌بندی‌شده بسازی یا یک بخش کتاب بخوانی.'}
              </p>
            </div>
            {onChangeReviewBatchSize && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-white/80">اندازهٔ هر نوبت مرور</span>
                <div className="inline-flex items-center gap-1 p-1 rounded-2xl bg-black/15">
                  {REVIEW_BATCH_OPTIONS.map(size => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => onChangeReviewBatchSize(size)}
                      className={`min-h-[36px] px-3 rounded-xl text-xs font-bold transition-colors whitespace-nowrap tabular-nums ${
                        reviewBatchSize === size
                          ? 'bg-white text-ink shadow-sm'
                          : 'text-white/85 hover:bg-white/15'
                      }`}
                    >
                      {fa(size)} واژه
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {dueCount > 0 ? (
              <button
                type="button"
                onClick={() => onStartReview('auto')}
                className="inline-flex items-center gap-2.5 min-h-[52px] px-6 rounded-2xl bg-white text-ink font-extrabold text-lg hover:bg-brand-50 whitespace-nowrap"
              >
                <span>شروع مرور ({fa(dueCount)} واژه)</span>
                <Kbd className="text-ink-muted">Space</Kbd>
              </button>
            ) : heldBack > 0 && onMoreNew ? (
              <button
                type="button"
                onClick={onMoreNew}
                className="inline-flex items-center min-h-[52px] px-6 rounded-2xl bg-white text-ink font-extrabold text-lg hover:bg-brand-50 whitespace-nowrap"
              >
                {fa(Math.min(10, heldBack))} کارت تازهٔ دیگر
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenSetup}
                disabled={totalWords === 0}
                className="inline-flex items-center min-h-[52px] px-6 rounded-2xl bg-white text-ink font-extrabold text-lg hover:bg-brand-50 disabled:opacity-50 whitespace-nowrap"
              >
                مرور با انتخاب تعداد
              </button>
            )}
            <button
              type="button"
              onClick={() => onStartReview('flip')}
              disabled={dueCount === 0}
              title="فقط برگرداندن کارت‌ها"
              className="min-h-[52px] px-4 rounded-2xl bg-white/15 hover:bg-white/25 font-bold disabled:opacity-40 whitespace-nowrap"
            >
              برگرداندن
            </button>
            <button
              type="button"
              onClick={() => onStartReview('cloze')}
              disabled={dueCount === 0}
              title="واژه در جملهٔ کتاب جا افتاده؛ بنویسش"
              className="min-h-[52px] px-4 rounded-2xl bg-white/15 hover:bg-white/25 font-bold disabled:opacity-40 whitespace-nowrap"
            >
              جای خالی
            </button>
            <button
              type="button"
              onClick={() => onNavigate('PRACTICE')}
              disabled={totalWords === 0}
              className="min-h-[52px] px-4 rounded-2xl bg-white/15 hover:bg-white/25 font-bold disabled:opacity-40 whitespace-nowrap"
            >
              آزمون چهارگزینه‌ای
            </button>
            <button
              type="button"
              onClick={onOpenSetup}
              disabled={totalWords === 0}
              className="min-h-[52px] px-4 rounded-2xl bg-white/15 hover:bg-white/25 font-bold disabled:opacity-40 whitespace-nowrap"
            >
              تنظیم تعداد و دسته
            </button>
          </div>
        </section>
        )}

        {totalWords > 0 && onOpenLesson && (
          <section
            aria-label="جلسهٔ آموزشی زمان‌بندی‌شده"
            className="md:col-span-2 bg-white dark:bg-slate-800 rounded-3xl p-5 md:p-6 border border-stone-200/80 dark:border-slate-700/80 flex flex-col gap-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="text-lg md:text-xl font-extrabold text-ink dark:text-white">
                  جلسهٔ آموزشی روزانه (مرور + آزمون + تثبیت)
                </h2>
                <p className="text-sm text-ink-muted dark:text-slate-400 mt-1">
                  بر اساس واژه‌های ثبت‌شدهٔ خودت یک جلسهٔ ۳۰، ۴۵ یا ۶۰ دقیقه‌ای بساز؛ در تاریخ امروز ثبت می‌شود و هر زمان قابل مرور دوباره است.
                </p>
              </div>
              {allRecordedLessonsCount > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenLesson()}
                  className="text-sm font-bold text-brand-600 dark:text-brand-300 hover:underline whitespace-nowrap tabular-nums"
                >
                  آرشیو جلسه‌ها ({fa(allRecordedLessonsCount)})
                </button>
              )}
            </div>

            {openLessonToday && (
              <div className="rounded-2xl bg-brand-50 dark:bg-brand-900/30 border border-brand-200/70 dark:border-brand-800/60 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-ink dark:text-white">
                    {openLessonToday.titleFa} در حال انجام است
                  </p>
                  <p className="text-xs text-ink-muted dark:text-slate-300 mt-0.5 tabular-nums">
                    گام {fa(openLessonToday.currentStageIndex + 1)} از {fa(openLessonToday.stages.length)} · {fa(openLessonToday.cardIds.length)} واژه
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenLesson()}
                  className="min-h-[44px] px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold whitespace-nowrap"
                >
                  ادامهٔ جلسهٔ امروز
                </button>
              </div>
            )}

            {!openLessonToday && completedLessonsToday.length > 0 && (
              <p className="text-xs text-emerald-700 dark:text-emerald-300 font-bold tabular-nums">
                ✓ امروز {fa(completedLessonsToday.length)} جلسهٔ آموزشی تکمیل و ثبت شده است · می‌توانی دوباره مرورش کنی یا جلسهٔ تازه‌ای بسازی.
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {LESSON_DURATIONS.map(dur => {
                const bp = LESSON_BLUEPRINTS[dur];
                return (
                  <button
                    key={dur}
                    type="button"
                    onClick={() => onOpenLesson(dur)}
                    className="text-right rounded-2xl p-4 bg-stone-50 hover:bg-brand-50/70 dark:bg-slate-900/60 dark:hover:bg-slate-700/70 border border-stone-200/80 dark:border-slate-700 hover:border-brand-400 transition-colors flex flex-col gap-1.5 min-h-[88px]"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-base font-extrabold text-ink dark:text-white whitespace-nowrap tabular-nums">
                        {fa(dur)} دقیقه
                      </span>
                      <span className="text-xs text-brand-600 dark:text-brand-300 font-bold whitespace-nowrap tabular-nums">
                        {fa(bp.wordCount)} واژه
                      </span>
                    </span>
                    <span className="text-xs text-ink-muted dark:text-slate-400 leading-relaxed">
                      {bp.stageSummaryFa}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

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
          <ul className="grid grid-cols-3 gap-2 text-center">
            <li className="rounded-xl bg-slate-50 dark:bg-slate-800/60 py-2">
              <p className="text-lg font-extrabold text-ink dark:text-white">{fa(summary.minutes)}</p>
              <p className="text-[11px] text-ink-muted dark:text-slate-400">دقیقه خواندن{summary.previousMinutes > 0 ? ` (هفتهٔ پیش ${fa(summary.previousMinutes)})` : ''}</p>
            </li>
            <li className="rounded-xl bg-slate-50 dark:bg-slate-800/60 py-2">
              <p className="text-lg font-extrabold text-ink dark:text-white">{fa(summary.newCards)}</p>
              <p className="text-[11px] text-ink-muted dark:text-slate-400">کارت تازه{summary.knownAdded > 0 ? ` · ${fa(summary.knownAdded)} «بلدم»` : ''}</p>
            </li>
            <li className="rounded-xl bg-slate-50 dark:bg-slate-800/60 py-2">
              <p className="text-lg font-extrabold text-ink dark:text-white">{summary.remembered === null ? fa(summary.reviews) : `${fa(summary.remembered)}٪`}</p>
              <p className="text-[11px] text-ink-muted dark:text-slate-400">{summary.remembered === null ? 'مرور' : `از ${fa(summary.reviews)} مرور یادت ماند`}</p>
            </li>
          </ul>
          <p className="text-sm text-ink-muted dark:text-slate-400">
              در ۷ روز گذشته {fa(summary.sections)} بخش و {fa(summary.words)} واژه خواندی. روزهای پررنگ روزهایی است که کتاب خواندی.
              {summary.advice && <span className="block mt-1 text-ink dark:text-slate-200">{summary.advice}</span>}
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

        {!reading?.next && (
          <Card className="md:col-span-2 order-first">
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-ink dark:text-white">چیزی برای خواندن بیاور</h2>
              <button type="button" onClick={() => onNavigate('TEXTS')} className="text-sm text-brand-500 dark:text-brand-300 hover:underline">کتابخانه</button>
            </div>
            <p className="text-sm text-ink-muted dark:text-slate-400 leading-relaxed">
              چیزی که خودت دنبالش هستی بهتر از هر کتاب «مفیدی» خوانده می‌شود: کتابی که دوست داری (EPUB)، مقاله‌ای که می‌خواستی بخوانی (لینک)، یا زیرنویس قسمت بعدِ سریالی که می‌بینی (SRT): اول بخوانش، بعد ببین.
            </p>
            <button type="button" onClick={() => onNavigate('TEXTS')} className="self-start min-h-[44px] px-5 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-bold">افزودن به کتابخانه</button>
          </Card>
        )}
      </div>
    </div>
  );
};
