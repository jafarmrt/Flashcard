import React from 'react';
import { UserAchievement } from '../types';
import { ALL_ACHIEVEMENTS } from '../services/achievements';
import { fa, Icon } from './common/ui';

interface AchievementsViewProps {
  earnedAchievements: UserAchievement[];
  onBack: () => void;
}

export const AchievementsView: React.FC<AchievementsViewProps> = ({ earnedAchievements, onBack }) => {
  const earnedIds = new Set(earnedAchievements.map(a => a.achievementId));
  // Fix: Explicitly type the Map to prevent its value from being inferred as `unknown`.
  const earnedMap = new Map<string, string>(earnedAchievements.map(a => [a.achievementId, a.dateEarned]));
  const earnedCount = ALL_ACHIEVEMENTS.filter(a => earnedIds.has(a.id)).length;

  return (
    <div dir="rtl" className="font-fa max-w-4xl mx-auto w-full flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label="بازگشت به تنظیمات" title="بازگشت به تنظیمات"
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-ink dark:text-white hover:bg-slate-200 dark:hover:bg-slate-800">
          <Icon.Back size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-ink dark:text-white">نشان‌ها</h1>
          <p className="text-sm text-ink-muted dark:text-slate-400">{fa(earnedCount)} از {fa(ALL_ACHIEVEMENTS.length)} نشان را گرفته‌ای.</p>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ALL_ACHIEVEMENTS.map(ach => {
          const isEarned = earnedIds.has(ach.id);
          const earnedDate = earnedMap.get(ach.id);

          return (
            <div
              key={ach.id}
              className={`rounded-3xl p-5 flex flex-col items-center text-center gap-2 transition-all ${isEarned
                ? 'bg-white dark:bg-slate-800 ring-2 ring-amber-400 dark:ring-amber-500'
                : 'bg-slate-100 dark:bg-slate-800/50 opacity-70'}`}
            >
              <div className={`text-5xl mb-1 ${isEarned ? '' : 'grayscale'}`} aria-hidden="true">{ach.icon}</div>
              <h3 className={`text-lg font-bold ${isEarned ? 'text-ink dark:text-white' : 'text-ink-muted dark:text-slate-400'}`}>
                {ach.name}
              </h3>
              <p className="text-sm text-ink-muted dark:text-slate-400 flex-grow">
                {ach.description}
              </p>
              {isEarned && earnedDate ? (
                <p className="mt-2 text-xs font-bold rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 px-3 py-1">
                  گرفته شده در {new Date(earnedDate).toLocaleDateString('fa-IR')}
                </p>
              ) : !isEarned && (
                <p className="mt-2 inline-flex items-center gap-1 text-xs text-ink-muted dark:text-slate-400">
                  <Icon.Lock size={13} />هنوز نگرفته‌ای
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
