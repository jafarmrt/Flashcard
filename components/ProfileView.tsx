import React, { useState, useEffect, useMemo } from 'react';
import { UserProfile, UserAchievement, Achievement } from '../types';
import { ALL_ACHIEVEMENTS } from '../services/achievements';
import { calculateLevel } from '../services/gamificationService';
import { fa, Icon } from './common/ui';

interface ProfileViewProps {
  userProfile: UserProfile | null;
  streak: number;
  earnedAchievements: UserAchievement[];
  onSave: (profileData: Partial<UserProfile>) => void;
  onBack: () => void;
  onNavigateToAchievements: () => void;
}

const input = 'w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 focus:border-brand-500 focus:outline-none';

export const ProfileView: React.FC<ProfileViewProps> = ({ userProfile, streak, earnedAchievements, onSave, onBack, onNavigateToAchievements }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<UserProfile>>({ firstName: '', lastName: '', bio: '' });

  useEffect(() => {
    if (userProfile && !isEditing) {
      setFormData({ firstName: userProfile.firstName || '', lastName: userProfile.lastName || '', bio: userProfile.bio || '' });
    }
  }, [userProfile, isEditing]);

  const handleSave = () => {
    onSave(formData);
    setIsEditing(false);
  };

  const handleCancel = () => {
    if (userProfile) setFormData({ firstName: userProfile.firstName || '', lastName: userProfile.lastName || '', bio: userProfile.bio || '' });
    setIsEditing(false);
  };

  const achievementsById = useMemo(() => new Map(ALL_ACHIEVEMENTS.map(a => [a.id, a])), []);
  const recentAchievements: Achievement[] = useMemo(() => [...earnedAchievements]
    .sort((a, b) => new Date(b.dateEarned).getTime() - new Date(a.dateEarned).getTime())
    .slice(0, 5)
    .map(ea => achievementsById.get(ea.achievementId))
    .filter((a): a is Achievement => a !== undefined), [earnedAchievements, achievementsById]);

  if (!userProfile) return <p dir="rtl" className="font-fa text-center p-10 text-ink-muted">در حال آماده‌سازی نمایه…</p>;

  const fullName = [formData.firstName, formData.lastName].filter(Boolean).join(' ') || 'بدون نام';
  const level = calculateLevel(userProfile.xp || 0);

  return (
    <div dir="rtl" className="font-fa max-w-3xl mx-auto w-full flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="تنظیمات" className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-white dark:hover:bg-slate-800"><Icon.Back /></button>
        <h1 className="text-2xl font-extrabold text-ink dark:text-white">نمایه</h1>
      </div>

      <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="w-20 h-20 rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200 flex items-center justify-center text-3xl font-extrabold" aria-hidden="true">
            {fullName.charAt(0).toUpperCase()}
          </span>
          <div className="flex-1 min-w-[10rem]">
            <h2 dir="auto" className="text-2xl font-extrabold text-ink dark:text-white">{fullName}</h2>
            <p className="text-ink-muted dark:text-slate-400">سطح {fa(level.level)}</p>
          </div>
          {!isEditing && (
            <button type="button" onClick={() => setIsEditing(true)} className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 font-bold">ویرایش نمایه</button>
          )}
        </div>

        {isEditing ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink-muted dark:text-slate-400">نام</span>
                <input type="text" id="firstName" dir="auto" value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} className={input} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink-muted dark:text-slate-400">نام خانوادگی</span>
                <input type="text" id="lastName" dir="auto" value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} className={input} />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink-muted dark:text-slate-400">دربارهٔ من</span>
              <textarea id="bio" dir="auto" rows={3} value={formData.bio} onChange={e => setFormData({ ...formData, bio: e.target.value })} className={input}
                placeholder="هدفت از یادگیری انگلیسی چیست؟" />
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={handleCancel} className="min-h-[44px] px-4 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700">لغو</button>
              <button type="button" onClick={handleSave} className="min-h-[44px] px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold">ذخیره</button>
            </div>
          </div>
        ) : (
          <p dir="auto" className="text-ink-muted dark:text-slate-300">{userProfile.bio || 'هنوز چیزی دربارهٔ خودت ننوشته‌ای.'}</p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 flex flex-col gap-1">
          <p className="text-2xl font-extrabold text-flame-500 dark:text-orange-300 flex items-center gap-1.5"><Icon.Flame size={22} />{fa(streak)} روز</p>
          <p className="text-xs text-ink-muted dark:text-slate-400">زنجیرهٔ مطالعه</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 flex flex-col gap-2">
          <p className="text-2xl font-extrabold text-brand-600 dark:text-brand-300">{fa(level.xp)} امتیاز</p>
          <span className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden flex" role="progressbar" aria-valuenow={level.progress} aria-valuemin={0} aria-valuemax={100}>
            <span className="bg-brand-500 rounded-full" style={{ width: `${level.progress}%` }} />
          </span>
          <p className="text-xs text-ink-muted dark:text-slate-400">{fa(level.xpForNextLevel - level.xp)} امتیاز تا سطح {fa(level.level + 1)}</p>
        </div>
      </section>

      <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold text-ink dark:text-white">نشان‌های تازه</h2>
          <button type="button" onClick={onNavigateToAchievements} className="text-sm text-brand-500 dark:text-brand-300 hover:underline">همهٔ نشان‌ها</button>
        </div>
        {recentAchievements.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {recentAchievements.map(ach => (
              <li key={ach.id} title={ach.description} className="flex items-center gap-2 rounded-2xl bg-slate-50 dark:bg-slate-700/50 px-3 py-2 text-sm">
                <span className="text-2xl" aria-hidden="true">{ach.icon}</span>
                <span className="font-bold text-ink dark:text-slate-100">{ach.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted dark:text-slate-400">هنوز نشانی نگرفته‌ای؛ با خواندن و مرور ادامه بده.</p>
        )}
      </section>
    </div>
  );
};
