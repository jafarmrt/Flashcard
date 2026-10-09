import React, { useMemo, useState } from 'react';
import type { Chapter, ChapterText, Flashcard, KnownWord, Source } from '../../types';
import { buildProfile, coverageOf, CoverageError, knownByFrom, savedProfile, saveProfile, VERDICT_TEXT, type BookProfile, type Coverage } from '../../services/coverage';
import { callProxy } from '../../services/apiService';
import { learnerStep } from '../../services/wordLevel';
import { fa } from '../common/ui';

interface BookCoverageProps {
  source: Source;
  chapters: Chapter[];
  cards: Flashcard[];
  knownWords: KnownWord[];
  userLevel?: string;
  loadText: (chapterId: string) => Promise<ChapterText>;
}

const VERDICT_STYLE: Record<Coverage['verdict'], string> = {
  easy: 'text-emerald-700 dark:text-emerald-300',
  fits: 'text-emerald-700 dark:text-emerald-300',
  stretch: 'text-amber-800 dark:text-amber-200',
  hard: 'text-red-700 dark:text-red-300',
};

// A ring that fills with the share of the text's words the learner knows.
const Ring: React.FC<{ percent: number; verdict: Coverage['verdict'] }> = ({ percent, verdict }) => {
  const r = 34;
  const length = 2 * Math.PI * r;
  const color = verdict === 'hard' ? '#DC2626' : verdict === 'stretch' ? '#D97706' : '#059669';
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" className="shrink-0" aria-hidden="true">
      <circle cx="42" cy="42" r={r} fill="none" strokeWidth="9" className="stroke-slate-200 dark:stroke-slate-700" />
      <circle cx="42" cy="42" r={r} fill="none" strokeWidth="9" stroke={color} strokeLinecap="round"
        strokeDasharray={`${(length * Math.min(100, percent)) / 100} ${length}`} transform="rotate(-90 42 42)" />
      <text x="42" y="47" textAnchor="middle" className="fill-current text-ink dark:text-white" fontSize="17" fontWeight="800">{fa(Math.round(percent))}٪</text>
    </svg>
  );
};

// "Is this book for me?": how much of its text the learner knows and the
// level it reads at. Measured once per device (one lookup of 400 words) and
// kept; the share known updates as cards grow.
export const BookCoverage: React.FC<BookCoverageProps> = ({ source, chapters, cards, knownWords, userLevel, loadText }) => {
  const [profile, setProfile] = useState<BookProfile | null>(() => savedProfile(source.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const knownBy = useMemo(() => knownByFrom(cards, knownWords), [cards, knownWords]);
  const coverage: Coverage | null = useMemo(() => (profile ? coverageOf(profile, userLevel, knownBy) : null), [profile, userLevel, knownBy]);
  const started = chapters.some(c => c.completed.length > 0);

  const run = async () => {
    setError('');
    try {
      const texts: string[] = [];
      for (let i = 0; i < chapters.length; i++) {
        setBusy(chapters.length > 1 ? `خواندن فصل ${fa(i + 1)} از ${fa(chapters.length)}…` : 'خواندن متن…');
        texts.push((await loadText(chapters[i].id)).chunks.join('\n\n'));
      }
      setBusy('سنجیدن واژه‌ها…');
      const built = await buildProfile(texts, async words => (await callProxy('word-frequencies', { words })).frequencies || {});
      saveProfile(source.id, built);
      setProfile(built);
    } catch (e) {
      console.error('Book evaluation failed:', e);
      setError(e instanceof CoverageError && e.reason === 'no-words'
        ? 'در این متن واژهٔ انگلیسی‌ای برای سنجیدن پیدا نشد.'
        : e instanceof CoverageError
          ? 'بیشتر واژه‌ها سنجیده نشدند (اتصال کند یا شلوغ بود)؛ کمی بعد دوباره امتحان کن.'
          : 'سنجش انجام نشد؛ اتصال را بررسی کن و دوباره امتحان کن.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="ارزیابی کتاب" className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="font-bold text-ink dark:text-white flex-1">{started ? 'سختی این کتاب برای تو' : 'پیش از شروع: این کتاب برای تو چقدر سخت است؟'}</h2>
        {profile && !busy && <button type="button" onClick={run} className="text-sm text-brand-500 dark:text-brand-300 hover:underline">دوباره بسنج</button>}
      </div>

      {!profile || !coverage ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 min-w-[14rem] text-sm text-ink-muted dark:text-slate-400">
            برنامه واژه‌های متن را با سطح تو، کارت‌هایت و فهرست «بلدم» می‌سنجد: چند درصدشان را بلدی و متن در چه سطحی است.
          </p>
          <button type="button" onClick={run} disabled={!!busy}
            className="min-h-[44px] px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold disabled:opacity-60">
            {busy || 'سنجیدن سختی'}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <Ring percent={coverage.percent} verdict={coverage.verdict} />
            <div className="flex flex-col gap-1 min-w-0">
              <p className="text-lg font-extrabold text-ink dark:text-white">{fa(coverage.percent)}٪ واژه‌های متن را بلدی</p>
              <p className={`text-sm font-bold ${VERDICT_STYLE[coverage.verdict]}`}>{VERDICT_TEXT[coverage.verdict]}</p>
            </div>
          </div>
          <ul className="flex flex-wrap gap-2 text-sm">
            <li className="rounded-full bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100 px-3 py-1">سطح متن: {coverage.textLevel === 'C2+' ? <><bdi className="font-en">C2</bdi> و بالاتر</> : <bdi className="font-en">{coverage.textLevel}</bdi>}</li>
            <li className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1">حدود {fa(coverage.unknownPer300)} واژهٔ ناآشنا در هر بخش</li>
            {coverage.personal > 0 && <li className="rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100 px-3 py-1">{fa(coverage.personal)}٪ از کارت‌ها و «بلدم»</li>}
            <li className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1">{fa(profile.types)} واژهٔ متفاوت</li>
          </ul>
          <p className="text-xs text-ink-muted dark:text-slate-400">
            تخمین از روی {fa(profile.head.length + profile.tail.length)} واژهٔ نمونه، با سطح <bdi className="font-en">{learnerStep(userLevel)}</bdi> تو (تنظیمات). برای خواندن راحت حدود ۹۵٪ کافی است.
          </p>
        </>
      )}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    </section>
  );
};
