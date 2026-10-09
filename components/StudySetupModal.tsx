import React, { useState, useMemo } from 'react';
import { Flashcard, StudySessionOptions } from '../types';
import { isDue, isNewCard } from '../services/srsService';
import { fa, Icon } from './common/ui';

interface StudySetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (options: StudySessionOptions) => void;
  cards: Flashcard[];
}

export const StudySetupModal: React.FC<StudySetupModalProps> = ({ isOpen, onClose, onStart, cards }) => {
  const [filter, setFilter] = useState<StudySessionOptions['filter']>('all-due');
  const [limit, setLimit] = useState(20);

  const filteredCards = useMemo(() => {
    switch (filter) {
      case 'new':
        return cards.filter(isNewCard);
      case 'review':
        return cards.filter(c => !isNewCard(c) && isDue(c));
      case 'all-cards':
        return cards; // No filter, return all cards
      case 'all-due':
      default:
        return cards.filter(c => isDue(c));
    }
  }, [cards, filter]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStart({ filter, limit: limit > 0 ? limit : Infinity });
  };

  if (!isOpen) {
    return null;
  }

  const cardCount = filteredCards.length;
  const sessionSize = limit > 0 ? Math.min(cardCount, limit) : cardCount;

  const filterOptions: { id: StudySessionOptions['filter']; label: string; hint: string }[] = [
    { id: 'all-due', label: 'همهٔ کارت‌های موعددار', hint: 'تازه‌ها و قبلی‌هایی که وقت مرورشان رسیده' },
    { id: 'new', label: 'فقط کارت‌های تازه', hint: 'کارت‌هایی که هنوز مرور نکرده‌ای' },
    { id: 'review', label: 'فقط کارت‌های قبلی', hint: 'کارت‌های دیده‌شده‌ای که موعدشان رسیده' },
    { id: 'all-cards', label: 'همهٔ کارت‌ها (مرور فشرده)', hint: 'بی‌توجه به موعد، برای مرور پیش از امتحان' },
  ];

  return (
    <div
        dir="rtl"
        className="font-fa fixed inset-0 bg-black/60 z-50 flex justify-center items-center p-4 backdrop-blur-sm"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="study-setup-title"
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl w-full max-w-md max-h-full overflow-y-auto animate-toast-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 flex items-start gap-3 border-b border-slate-100 dark:border-slate-700">
          <div className="flex-1 min-w-0">
            <h2 id="study-setup-title" className="text-xl font-extrabold text-ink dark:text-white">تنظیم مرور</h2>
            <p className="text-sm text-ink-muted dark:text-slate-400 mt-1">انتخاب کن امروز کدام کارت‌ها مرور شوند.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="بستن" className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-ink-muted dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            <Icon.Close size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
            <div className="p-5 flex flex-col gap-5">
                {/* Filter Options */}
                <fieldset>
                    <legend className="text-sm font-bold text-ink dark:text-slate-200 mb-2">کدام کارت‌ها</legend>
                    <div className="flex flex-col gap-2">
                        {filterOptions.map(({ id, label, hint }) => (
                            <label key={id} className="flex items-center gap-3 p-3 rounded-2xl cursor-pointer bg-slate-50 dark:bg-slate-700/50 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-brand-900/40 has-[:checked]:ring-2 has-[:checked]:ring-brand-500 transition-all">
                                <input
                                    type="radio"
                                    name="filter"
                                    value={id}
                                    checked={filter === id}
                                    onChange={() => setFilter(id)}
                                    className="h-4 w-4 shrink-0 accent-brand-500"
                                />
                                <span className="flex flex-col min-w-0">
                                    <span className="text-sm font-bold text-ink dark:text-slate-100">{label}</span>
                                    <span className="text-xs text-ink-muted dark:text-slate-400">{hint}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>

                {/* Card Limit */}
                <div>
                    <label htmlFor="card-limit" className="block text-sm font-bold text-ink dark:text-slate-200">
                        بیشترین تعداد کارت در این جلسه
                    </label>
                    <div className="mt-2 flex items-center gap-3">
                        <input
                            type="number"
                            id="card-limit"
                            dir="ltr"
                            value={limit}
                            onChange={(e) => setLimit(Math.max(0, parseInt(e.target.value, 10)))}
                            min="1"
                            className="w-28 min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-ink dark:text-white font-en text-center focus:border-brand-500 focus:outline-none"
                        />
                        <p className="text-xs text-ink-muted dark:text-slate-400">صفر یعنی بدون محدودیت.</p>
                    </div>
                </div>
            </div>

            <div className="p-5 bg-slate-50 dark:bg-slate-900/50 flex flex-wrap justify-between items-center gap-3">
                <p className="text-sm font-bold text-brand-600 dark:text-brand-300">
                    {fa(sessionSize)} از {fa(cardCount)} کارت
                </p>
                <div className="flex gap-2">
                     <button type="button" onClick={onClose} className="min-h-[44px] px-4 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-white dark:hover:bg-slate-700 transition-colors">
                        لغو
                    </button>
                    <button type="submit" disabled={sessionSize === 0} className="min-h-[44px] px-5 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        شروع مرور
                    </button>
                </div>
            </div>
        </form>
      </div>
    </div>
  );
};
