import React, { useEffect, useMemo, useState } from 'react';
import { Chapter, ChapterText, Flashcard, KnownWord, Source, SpeechAttempt, StudyLog, UserProfile } from '../types';
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
import { fa, Icon, Kbd, STAGE_COLORS } from './common/ui';

const NO_KNOWN: KnownWord[] = [];

interface TodayViewProps {
  userProfile: UserProfile | null;
  username?: string;
  cards: Flashcard[];
  studyLogs: StudyLog[];
  sources: Source[];
  chapters: Chapter[];
  dueCount: number; // the day's queue (services/dailyQueue)
  heldBack?: number; // new cards left for the next days by the daily cap
  knownWords?: KnownWord[];
  onMoreNew?: () => void; // start ten of the new cards kept for later
  loadText?: (chapterId: string) => Promise<ChapterText>; // for the first lines of the next section
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
  userProfile, username, cards, studyLogs, sources, chapters, dueCount, newDueCount, heldBack = 0, knownWords = NO_KNOWN, onMoreNew, loadText, onStartReview, onOpenSetup, onNavigate, onOpenChunk, speechAttempts = [],
}) => {

  const today = dayString(new Date());
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
      </header>

      {reading?.next && (
        <section aria-label="ادامهٔ کتاب" className="bg-white dark:bg-slate-800 rounded-3xl p-5 md:p-6 flex flex-col gap-3">
          <div className="flex justify-between items-baseline gap-3">
            <h2 className="font-extrabold text-lg text-ink dark:text-white">{readToday ? 'امروز خواندی. یک بخش دیگر؟' : 'فقط همین یک بخش'}</h2>
            {invite && <span className="text-sm text-ink-muted dark:text-slate-400 whitespace-nowrap">حدود {fa(invite.minutes)} دقیقه</span>}
          </div>
          <p className="text-sm text-ink-muted dark:text-slate-400">
            <bdi dir="auto" className="font-en font-bold text-ink dark:text-white">{reading.source.title}</bdi>
            {reading.list.length > 1 && reading.next.chapter.title !== reading.source.title && <> · <bdi dir="auto" className="font-en">{reading.next.chapter.title}</bdi></>}
            {' · '}بخش {fa(reading.next.chunk + 1)} از {fa(reading.next.chapter.chunkCount)}
          </p>
          {invite?.before && (
            <div className="flex flex-col gap-0.5 text-sm text-ink-muted dark:text-slate-400">
              <span>کجا بودیم:</span>
              <p dir="ltr" lang="en" className="font-read italic leading-relaxed text-left">{invite.before}</p>
            </div>
          )}
          {invite && <p dir="ltr" lang="en" className="font-read text-[17px] leading-8 text-slate-800 dark:text-slate-100 text-left">{invite.teaser}</p>}
          <button type="button" onClick={() => onOpenChunk(reading.next!.chapter, reading.next!.chunk)}
            className="self-start inline-flex items-center gap-2 min-h-[52px] px-7 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-lg">
            <Icon.Book size={20} />{invite ? 'ادامه بده' : 'بخوان'}
          </button>
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
        <section className="md:col-span-2 bg-brand-500 text-white rounded-3xl p-5 md:p-7 flex flex-wrap items-center gap-5 md:gap-7">
          <div className="flex-1 min-w-[15rem] flex flex-col gap-3">
            <div>
              <h2 className="text-xl md:text-2xl font-extrabold">
                {dueCount > 0 ? 'مرور کارت‌ها' : 'مرور'}
              </h2>
              <p className="mt-1 text-sm md:text-base text-white/90">
                {dueCount > 0
                  ? `${fa(dueCount)} کارت برای امروز${newDueCount > 0 ? `، ${fa(newDueCount)} تا تازه` : ''}.${heldBack > 0 ? ` ${fa(heldBack)} کارت تازهٔ دیگر برای روزهای بعد کنار ماند (سقف روزانه در تنظیمات).` : ''}`
                  : heldBack > 0 ? `کارت‌های امروز تمام شد. ${fa(heldBack)} کارت تازه برای روزهای بعد مانده؛ اگر وقت داری چندتایش را همین حالا شروع کن.`
                  : 'کارت موعدداری نمانده. با مرور آزاد یا یک بخش تازه از متن ادامه بده.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {dueCount > 0 ? (
                <button type="button" onClick={() => onStartReview('auto')}
                  className="inline-flex items-center gap-2.5 min-h-[52px] px-6 rounded-2xl bg-white text-ink font-extrabold text-lg hover:bg-brand-50">
                  شروع مرور
                  <span className="rounded-full bg-brand-100 text-brand-700 text-sm px-2.5 py-0.5">{fa(dueCount)} کارت</span>
                  <Kbd className="text-ink-muted">Space</Kbd>
                </button>
              ) : heldBack > 0 && onMoreNew ? (
                // Today's allowance is used up and nothing else is due: the
                // cards kept for later can still be started by choice.
                <button type="button" onClick={onMoreNew}
                  className="inline-flex items-center min-h-[52px] px-6 rounded-2xl bg-white text-ink font-extrabold text-lg hover:bg-brand-50">
                  {fa(Math.min(10, heldBack))} کارت تازهٔ دیگر
                </button>
              ) : (
                <button type="button" onClick={onOpenSetup} disabled={totalWords === 0}
                  className="inline-flex items-center min-h-[52px] px-6 rounded-2xl bg-white text-ink font-extrabold text-lg hover:bg-brand-50 disabled:opacity-50">
                  مرور آزاد
                </button>
              )}
              <button type="button" onClick={() => onStartReview('flip')} disabled={dueCount === 0} title="فقط برگرداندن کارت‌ها"
                className="min-h-[52px] px-4 rounded-2xl bg-white/15 hover:bg-white/25 font-bold disabled:opacity-40">برگرداندن</button>
              <button type="button" onClick={() => onStartReview('cloze')} disabled={dueCount === 0} title="واژه در جملهٔ کتاب جا افتاده؛ بنویسش"
                className="min-h-[52px] px-4 rounded-2xl bg-white/15 hover:bg-white/25 font-bold disabled:opacity-40">جای خالی</button>
              <button type="button" onClick={() => onNavigate('PRACTICE')} disabled={totalWords === 0}
                className="min-h-[52px] px-4 rounded-2xl bg-white/15 hover:bg-white/25 font-bold disabled:opacity-40">آزمون چهارگزینه‌ای</button>
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
