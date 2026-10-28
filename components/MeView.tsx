import React from 'react';
import { DbRepair } from './layout/DbRepair';
import type { View, HealthStatus, SyncStatus } from '../hooks/useAppLogic';
import { UserProfile } from '../types';
import { Icon } from './common/ui';
import { SYNC_LABEL } from './layout/Navigation';

interface MeViewProps {
  userProfile: UserProfile | null;
  username?: string;
  syncStatus: SyncStatus;
  health: { label: string; status: HealthStatus }[];
  hasCards: boolean;
  onNavigate: (view: View) => void;
}

// The phone's "Me" tab: profile, progress and every secondary section.
export const MeView: React.FC<MeViewProps> = ({ userProfile, username, syncStatus, health, hasCards, onNavigate }) => {
  const links: { view: View; label: string; hint: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { view: 'PRACTICE', label: 'تمرین مکالمه و آزمون', hint: 'آزمون چندگزینه‌ای و تمرین تلفظ', icon: <Icon.Chat />, disabled: !hasCards },
    { view: 'STATS', label: 'پیشرفت', hint: 'خواندن، واژه‌ها و کارنامهٔ سال', icon: <Icon.Chart /> },
    { view: 'PROFILE', label: 'پروفایل', hint: 'نام و معرفی', icon: <Icon.User /> },
    { view: 'SETTINGS', label: 'تنظیمات', hint: 'هوش مصنوعی، تلگرام، CSV، همگام‌سازی', icon: <Icon.Gear /> },
    { view: 'CHANGELOG', label: 'تغییرات نسخه‌ها', hint: '', icon: <Icon.Log /> },
  ];

  return (
    <div dir="rtl" className="font-fa flex flex-col gap-4 max-w-xl mx-auto w-full">
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex items-center gap-4">
        <span className="w-14 h-14 rounded-full bg-brand-200 text-brand-700 flex items-center justify-center text-xl font-extrabold">
          {(userProfile?.firstName || username || '?').slice(0, 1)}
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-extrabold text-ink dark:text-white truncate">{userProfile?.firstName || username}</h1>
        </div>
      </section>

      <nav className="bg-white dark:bg-slate-800 rounded-3xl divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
        {links.map(l => (
          <button key={l.view} type="button" disabled={l.disabled} onClick={() => onNavigate(l.view)}
            className="w-full flex items-center gap-3 min-h-[56px] px-4 text-right hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-40">
            <span className="text-brand-500 dark:text-brand-300">{l.icon}</span>
            <span className="flex-1">
              <span className="block font-bold text-ink dark:text-white">{l.label}</span>
              {l.hint && <span className="block text-xs text-ink-muted dark:text-slate-400">{l.hint}</span>}
            </span>
            <Icon.Back size={18} className="rotate-180 text-slate-400" />
          </button>
        ))}
      </nav>

      <p className="text-center text-xs text-ink-muted dark:text-slate-400">{SYNC_LABEL[syncStatus]}</p>
      <p dir="ltr" className="flex justify-center gap-3 text-[11px] text-slate-400">
        {health.map(h => (
          <span key={h.label} className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${h.status === 'ok' ? 'bg-emerald-500' : h.status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />{h.label}
          </span>
        ))}
      </p>
      {health.some(h => h.label === 'DB' && h.status === 'error') && <DbRepair />}
    </div>
  );
};
