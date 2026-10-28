import React, { useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { Icon } from './common/ui';

interface ProfileViewProps {
  userProfile: UserProfile | null;
  onSave: (profileData: Partial<UserProfile>) => void;
  onBack: () => void;
}

const input = 'w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 focus:border-brand-500 focus:outline-none';

export const ProfileView: React.FC<ProfileViewProps> = ({ userProfile, onSave, onBack }) => {
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

  if (!userProfile) return <p dir="rtl" className="font-fa text-center p-10 text-ink-muted">در حال آماده‌سازی نمایه…</p>;

  const fullName = [formData.firstName, formData.lastName].filter(Boolean).join(' ') || 'بدون نام';

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

    </div>
  );
};
