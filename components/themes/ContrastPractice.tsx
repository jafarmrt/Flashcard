import React, { useEffect, useState } from 'react';
import type { Flashcard, PracticeAnswer } from '../../types';
import type { CardPlace } from '../../services/library';
import type { AiRequestOptions } from '../../services/geminiService';
import { generateContrastUnits, type ContrastUnit } from '../../services/wordThemes';
import { fa, Icon } from '../common/ui';

interface ContrastPracticeProps {
  themeName: string;
  cards: Flashcard[];
  places?: Map<string, CardPlace[]>;
  practice?: PracticeAnswer[];
  aiOptions?: AiRequestOptions;
  onAnswer?: (cardId: string, right: boolean, chose?: string) => void;
  onBack: () => void;
}

const sameWord = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export const ContrastPractice: React.FC<ContrastPracticeProps> = ({
  themeName,
  cards,
  places,
  practice = [],
  aiOptions,
  onAnswer,
  onBack,
}) => {
  const [units, setUnits] = useState<ContrastUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [firstChoice, setFirstChoice] = useState<'A' | 'B' | null>(null);
  const [checked, setChecked] = useState(false);
  const [rightPairs, setRightPairs] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    generateContrastUnits(themeName, cards, places, practice, aiOptions)
      .then(built => {
        if (!alive) return;
        setUnits(built);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setUnits([]);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // Run once on mount for this bundle session so recording answers does not reset units mid-drill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeName]);

  if (loading) {
    return (
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col items-center gap-3 text-center">
        <p className="text-base font-bold text-ink dark:text-white">در حال آماده‌سازی جفت‌های نزدیک در «{themeName}»…</p>
        <p className="text-sm text-ink-muted dark:text-slate-400">مرز معنایی و کاربردی واژه‌های شبیه کنار هم بررسی می‌شود.</p>
      </section>
    );
  }

  if (units.length === 0) {
    return (
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col items-center gap-4 text-center">
        <p className="text-base font-bold text-ink dark:text-white">برای تفکیک واژه‌ها دست‌کم دو واژه در این بسته لازم است.</p>
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] px-5 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          بازگشت به بسته
        </button>
      </section>
    );
  }

  if (finished) {
    return (
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col items-center gap-4 text-center">
        <h2 className="text-2xl font-extrabold text-ink dark:text-white">تمرین تفکیک تمام شد</h2>
        <p className="tabular-nums">
          <span className="text-4xl font-extrabold text-brand-500 dark:text-brand-300">{fa(rightPairs)}</span>
          <span className="text-base text-ink-muted dark:text-slate-400 ms-2">از {fa(units.length)} جفت کاملاً درست</span>
        </p>
        <p className="text-sm text-ink-muted dark:text-slate-400 max-w-md">
          واژه‌هایی که جابه‌جا زده شد در «اشتباه‌های من» ثبت شدند تا در مرورهای بعدی هم کنار هم یادآوری شوند.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="min-h-[48px] px-6 rounded-2xl text-sm font-extrabold text-white bg-brand-500 hover:bg-brand-600"
        >
          بازگشت به بسته
        </button>
      </section>
    );
  }

  const unit = units[index];
  const wordA = unit.cardA.front.trim();
  const wordB = unit.cardB.front.trim();
  const chosenWord1 = firstChoice === 'A' ? wordA : firstChoice === 'B' ? wordB : '';
  const chosenWord2 = firstChoice === 'A' ? wordB : firstChoice === 'B' ? wordA : '';
  const isRight1 = checked && sameWord(chosenWord1, unit.sentence1.answerWord);
  const isRight2 = checked && sameWord(chosenWord2, unit.sentence2.answerWord);

  const handleCheck = () => {
    if (!firstChoice || checked) return;
    const ok1 = sameWord(chosenWord1, unit.sentence1.answerWord);
    const ok2 = sameWord(chosenWord2, unit.sentence2.answerWord);
    setChecked(true);
    if (ok1 && ok2) setRightPairs(n => n + 1);
    onAnswer?.(unit.sentence1.cardId, ok1, ok1 ? undefined : chosenWord1);
    onAnswer?.(unit.sentence2.cardId, ok2, ok2 ? undefined : chosenWord2);
  };

  const handleNext = () => {
    setFirstChoice(null);
    setChecked(false);
    if (index + 1 < units.length) setIndex(i => i + 1);
    else setFinished(true);
  };

  const renderBlankSentence = (
    labelFa: string,
    blank: ContrastUnit['sentence1'],
    chosen: string,
    isRight: boolean,
  ) => {
    const englishContext = !blank.before.startsWith('معنی «');
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-2">
        <span className="text-xs font-bold text-ink-muted dark:text-slate-400">{labelFa}</span>
        <p
          dir={englishContext ? 'ltr' : 'rtl'}
          className={`text-base leading-8 text-ink dark:text-slate-100 ${englishContext ? 'font-en text-left' : ''}`}
        >
          <span>{blank.before}</span>
          <span
            dir="ltr"
            className={`inline-block mx-1 px-2.5 py-0.5 rounded-lg font-en font-bold ${
              !chosen
                ? 'border border-dashed border-slate-300 dark:border-slate-600 text-slate-400'
                : !checked
                  ? 'bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-200 border border-brand-400'
                  : isRight
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200'
                    : 'bg-red-100 dark:bg-red-900/40 text-red-900 dark:text-red-200 line-through'
            }`}
          >
            {chosen || '……'}
          </span>
          {checked && !isRight && (
            <span dir="ltr" className="inline-block mx-1 px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200 font-en font-bold">
              {blank.answerWord}
            </span>
          )}
          <span>{blank.after}</span>
        </p>
      </div>
    );
  };

  return (
    <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-8 flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="بازگشت به بسته"
            className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-ink dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
          >
            <Icon.Back size={20} />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-extrabold text-ink dark:text-white truncate">تفکیک واژه‌های نزدیک</h2>
            <p className="text-xs text-ink-muted dark:text-slate-400 tabular-nums">
              بستهٔ {themeName} · جفت {fa(index + 1)} از {fa(units.length)}
            </p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[unit.cardA, unit.cardB].map(c => (
          <div key={c.id} className="rounded-2xl bg-slate-50 dark:bg-slate-900/60 p-4 flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <bdi dir="ltr" className="font-en text-lg font-extrabold text-ink dark:text-white">{c.front}</bdi>
              <span className="text-xs text-ink-muted dark:text-slate-400">
                {[c.partOfSpeech, c.register].filter(Boolean).join(' · ')}
              </span>
            </div>
            <p className="text-sm text-ink dark:text-slate-200">{c.back}</p>
          </div>
        ))}
      </div>

      <p className="rounded-2xl bg-slate-50 dark:bg-slate-900/40 px-4 py-3 text-sm leading-7 text-ink dark:text-slate-200">
        <span className="font-bold text-ink dark:text-white">تفاوت کلیدی: </span>
        <bdi dir="auto">{unit.differenceFa}</bdi>
      </p>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-bold text-ink dark:text-white">
          واژهٔ جملهٔ اول را انتخاب کن (واژهٔ دیگر در جملهٔ دوم قرار می‌گیرد):
        </p>
        <div dir="ltr" className="flex flex-wrap gap-2.5">
          <button
            type="button"
            disabled={checked}
            onClick={() => setFirstChoice('A')}
            className={`min-h-[44px] px-5 rounded-xl border-2 font-en text-base font-bold transition-colors whitespace-nowrap ${
              firstChoice === 'A'
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-200'
                : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/60 text-ink dark:text-white hover:border-brand-400'
            }`}
          >
            1: {wordA} / 2: {wordB}
          </button>
          <button
            type="button"
            disabled={checked}
            onClick={() => setFirstChoice('B')}
            className={`min-h-[44px] px-5 rounded-xl border-2 font-en text-base font-bold transition-colors whitespace-nowrap ${
              firstChoice === 'B'
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-200'
                : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/60 text-ink dark:text-white hover:border-brand-400'
            }`}
          >
            1: {wordB} / 2: {wordA}
          </button>
        </div>

        {renderBlankSentence('جملهٔ اول', unit.sentence1, chosenWord1, isRight1)}
        {renderBlankSentence('جملهٔ دوم', unit.sentence2, chosenWord2, isRight2)}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        {checked ? (
          <>
            <p role="status" className={`text-sm font-bold ${isRight1 && isRight2 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-200'}`}>
              {isRight1 && isRight2 ? 'آفرین! هر دو در جای درست خودشان نشستند.' : 'جای دو واژه برعکس بود؛ شکل درست بالا مشخص شد.'}
            </p>
            <button
              type="button"
              onClick={handleNext}
              className="min-h-[48px] px-6 rounded-2xl text-sm font-extrabold text-white bg-brand-500 hover:bg-brand-600 whitespace-nowrap ms-auto"
            >
              {index + 1 < units.length ? 'جفت بعدی' : 'پایان تمرین'}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!firstChoice}
            onClick={handleCheck}
            className="min-h-[48px] px-6 rounded-2xl text-sm font-extrabold text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-40 whitespace-nowrap ms-auto"
          >
            بررسی پاسخ
          </button>
        )}
      </div>
    </section>
  );
};
