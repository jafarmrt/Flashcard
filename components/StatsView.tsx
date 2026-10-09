import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../services/localDBService';
import type { Flashcard, Occurrence, Source, StudyLog } from '../types';
import { calculateStreak } from '../services/gamificationService';
import { stageCounts, STAGE_NAMES, type MasteryStage } from '../services/masteryService';
import { bookGrowth, hardestWords, isLearned, reviewsPerDay, type BookGrowth } from '../services/readingStats';
import { fa, Icon } from './common/ui';

interface StatsViewProps {
  cards: Flashcard[];
  sources: Source[];
  occurrences: Occurrence[];
  onReviewCards: (ids: string[]) => void;
  onOpenSource: (sourceId: string) => void;
}

const WEEKS = 12;
const LINE_COLORS = ['#5B4BDB', '#0EA5E9', '#10B981', '#F59E0B', '#F43F5E'];

const Panel: React.FC<{ title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }> = ({ title, hint, children, action }) => (
  <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3 min-w-0">
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <h2 className="font-bold text-ink dark:text-white">{title}</h2>
        {hint && <p className="text-xs text-ink-muted dark:text-slate-400 mt-0.5">{hint}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

const Tile: React.FC<{ value: string; label: string; tone?: string }> = ({ value, label, tone = 'text-ink dark:text-white' }) => (
  <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 flex flex-col gap-1">
    <p className={`text-2xl md:text-3xl font-extrabold ${tone}`}>{value}</p>
    <p className="text-xs text-ink-muted dark:text-slate-400">{label}</p>
  </div>
);

// Reviews per day, last 30 days; today is the last bar (on the left in RTL).
const ActivityBars: React.FC<{ days: { day: string; count: number }[] }> = ({ days }) => {
  const max = Math.max(1, ...days.map(d => d.count));
  return (
    <div className="flex items-end gap-[3px] h-28" role="img" aria-label={`مرورهای ${fa(days.length)} روز اخیر`}>
      {days.map((d, i) => (
        <div key={d.day} className="flex-1 h-full flex items-end" title={`${d.day}: ${fa(d.count)} مرور`}>
          <div className={`w-full rounded-t ${i === days.length - 1 ? 'bg-brand-500' : d.count ? 'bg-brand-200 dark:bg-brand-800' : 'bg-slate-100 dark:bg-slate-700'}`}
            style={{ height: `${d.count ? Math.max(8, (d.count / max) * 100) : 4}%` }} />
        </div>
      ))}
    </div>
  );
};

// Cards from each book, week by week (cumulative), oldest week on the right.
const GrowthChart: React.FC<{ books: BookGrowth[] }> = ({ books }) => {
  const width = 320;
  const height = 140;
  const pad = 8;
  const max = Math.max(1, ...books.flatMap(b => b.points));
  const x = (i: number) => width - pad - (i * (width - 2 * pad)) / (WEEKS - 1);
  const y = (v: number) => height - pad - (v / max) * (height - 2 * pad);
  return (
    <div className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-36" role="img" aria-label="رشد کارت‌های هر کتاب در دوازده هفتهٔ اخیر">
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={pad} x2={width - pad} y1={y(max * f)} y2={y(max * f)} className="stroke-slate-100 dark:stroke-slate-700" strokeWidth="1" />
        ))}
        {books.map((b, n) => (
          <polyline key={b.sourceId} fill="none" stroke={LINE_COLORS[n % LINE_COLORS.length]} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
            points={b.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        ))}
      </svg>
      <div className="flex justify-between text-[11px] text-ink-muted dark:text-slate-400"><span>{fa(WEEKS)} هفته پیش</span><span>این هفته</span></div>
    </div>
  );
};

export const StatsView: React.FC<StatsViewProps> = ({ cards, sources, occurrences, onReviewCards, onOpenSource }) => {
  const [logs, setLogs] = useState<StudyLog[] | null>(null);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const all = await db.studyHistory.toArray();
      const profile = await db.userProfile.get(1);
      if (!alive) return;
      setLogs(all);
      setStreak(calculateStreak(all, profile?.frozenDates));
    })();
    return () => { alive = false; };
  }, []);

  const live: Flashcard[] = useMemo(() => cards.filter(c => !c.isDeleted), [cards]);
  const days = useMemo(() => (logs ? reviewsPerDay(logs, 30) : []), [logs]);
  const books: BookGrowth[] = useMemo(() => bookGrowth(occurrences, live, sources, WEEKS), [occurrences, live, sources]);
  const hardest = useMemo(() => (logs ? hardestWords(logs, live, 10) : []), [logs, live]);
  const stages = useMemo(() => stageCounts(live), [live]);
  const learned = useMemo(() => live.filter(isLearned).length, [live]);

  if (!logs) return <p dir="rtl" className="font-fa text-center py-20 text-ink-muted">در حال آماده‌سازی آمار…</p>;

  const month = days.reduce((n, d) => n + d.count, 0);
  const activeDays = days.filter(d => d.count > 0).length;

  return (
    <div dir="rtl" className="font-fa max-w-4xl mx-auto w-full flex flex-col gap-5">
      <h1 className="text-2xl font-extrabold text-ink dark:text-white">آمار</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile value={`${fa(streak)} روز`} label="زنجیرهٔ مطالعه" tone="text-flame-500 dark:text-orange-300" />
        <Tile value={fa(month)} label="مرور در ۳۰ روز" />
        <Tile value={fa(learned)} label="واژهٔ آموخته (درخت و ریشه‌دار)" tone="text-emerald-700 dark:text-emerald-300" />
        <Tile value={fa(live.length)} label="همهٔ کارت‌ها" />
      </div>

      <Panel title="مرورهای هر روز" hint={`${fa(activeDays)} روز از ۳۰ روز اخیر مطالعه کردی.`}>
        <ActivityBars days={days} />
      </Panel>

      <Panel title="واژه‌های هر کتاب" hint="کارت‌هایی که از هر کتاب ساختی، هفته به هفته، و چندتایشان آموخته شده.">
        {books.length === 0 ? (
          <p className="text-sm text-ink-muted dark:text-slate-400">هنوز از کتاب یا متنی کارت نساخته‌ای.</p>
        ) : (
          <>
            <GrowthChart books={books} />
            <ul className="flex flex-col gap-2.5">
              {books.map((b, n) => {
                const pct = Math.round((b.learned / Math.max(1, b.total)) * 100);
                return (
                  <li key={b.sourceId}>
                    <button type="button" onClick={() => onOpenSource(b.sourceId)} className="w-full flex items-center gap-3 text-right rounded-2xl p-2 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: LINE_COLORS[n % LINE_COLORS.length] }} aria-hidden="true" />
                      <span className="flex-1 min-w-0 flex flex-col gap-1">
                        <span dir="auto" className="font-en font-bold text-ink dark:text-white truncate">{b.title}</span>
                        <span className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden flex" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                          <span className="bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                        </span>
                      </span>
                      <span className="text-xs text-ink-muted dark:text-slate-400 whitespace-nowrap">{fa(b.learned)} از {fa(b.total)} آموخته</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>

      <div className="grid gap-5 md:grid-cols-2">
        <Panel title="سخت‌ترین واژه‌ها" hint="بیشترین «دوباره» در مرورها."
          action={hardest.length > 0 ? (
            <button type="button" onClick={() => onReviewCards(hardest.map(h => h.card.id))}
              className="min-h-[40px] px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold whitespace-nowrap">مرور همین‌ها</button>
          ) : undefined}>
          {hardest.length === 0 ? (
            <p className="text-sm text-ink-muted dark:text-slate-400">هنوز واژه‌ای را «دوباره» نزده‌ای.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
              {hardest.map(h => (
                <li key={h.card.id} className="py-2 flex items-center gap-2 min-w-0">
                  <bdi dir="ltr" className="font-en font-bold text-ink dark:text-white truncate">{h.card.front}</bdi>
                  <span className="text-sm text-ink-muted dark:text-slate-300 truncate flex-1">{h.card.back}</span>
                  <span className="shrink-0 text-xs rounded-full bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-100 px-2 py-0.5">{fa(h.again)} بار از {fa(h.reviews)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title="رشد واژه‌ها" hint="هر کارت با مرورهای درست از دانه تا ریشه‌دار رشد می‌کند.">
          <ul className="flex flex-col gap-2">
            {([0, 1, 2, 3, 4] as MasteryStage[]).map(stage => {
              const pct = Math.round((stages[stage] / Math.max(1, live.length)) * 100);
              return (
                <li key={stage} className="flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0 text-ink dark:text-slate-200">{STAGE_NAMES[stage]}</span>
                  <span className="flex-1 h-2.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden flex">
                    <span className={`rounded-full ${stage >= 3 ? 'bg-emerald-500' : 'bg-brand-400'}`} style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-10 shrink-0 text-left text-ink-muted dark:text-slate-400">{fa(stages[stage])}</span>
                </li>
              );
            })}
          </ul>
          {live.length === 0 && <p className="text-sm text-ink-muted dark:text-slate-400 flex items-center gap-1.5"><Icon.Plus size={16} />با ساختن کارت شروع کن.</p>}
        </Panel>
      </div>
    </div>
  );
};
