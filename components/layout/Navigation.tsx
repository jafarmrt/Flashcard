import React from 'react';
import { DbRepair } from './DbRepair';
import type { View, HealthStatus, SyncStatus } from '../../hooks/useAppLogic';
import { calculateLevel } from '../../services/gamificationService';
import { UserProfile } from '../../types';
import { Icon, fa } from '../common/ui';

const DECK_VIEWS: View[] = ['DECKS', 'LIST', 'FORM', 'BULK_ADD'];
const ME_VIEWS: View[] = ['ME', 'SETTINGS', 'USAGE', 'CHANGELOG', 'ACHIEVEMENTS', 'PROFILE', 'STATS', 'PRACTICE'];
const TEXT_VIEWS: View[] = ['TEXTS', 'READER', 'AI_EXTRACT'];

export const SYNC_LABEL: Record<SyncStatus, string> = {
  idle: 'همگام‌سازی آماده',
  syncing: 'در حال همگام‌سازی…',
  synced: 'همگام با سرور',
  offline: 'آفلاین، ذخیره روی همین دستگاه',
  error: 'همگام‌سازی ناموفق',
};
const SYNC_DOT: Record<SyncStatus, string> = {
  idle: 'bg-slate-400', syncing: 'bg-amber-500 animate-pulse', synced: 'bg-emerald-600', offline: 'bg-slate-400', error: 'bg-red-500',
};

interface SidebarProps {
  view: View;
  dueCount: number;
  userProfile: UserProfile | null;
  username?: string;
  syncStatus: SyncStatus;
  health: { label: string; status: HealthStatus }[];
  hasCards: boolean;
  onNavigate: (view: View) => void;
  onStartReview: () => void;
  onAddCard: () => void;
}

const NavLink: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number; disabled?: boolean }> =
  ({ active, onClick, icon, label, badge, disabled }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-current={active ? 'page' : undefined}
    className={`w-full flex items-center gap-3 min-h-[44px] px-3 rounded-xl text-right transition-colors disabled:opacity-40 ${active
      ? 'bg-brand-100 text-brand-700 font-bold dark:bg-brand-900/60 dark:text-brand-200'
      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
    {icon}
    <span className="flex-1">{label}</span>
    {badge ? <span className="rounded-full bg-flame-500 text-white text-xs font-bold px-2 py-0.5">{fa(badge)}</span> : null}
  </button>
);

// Desktop side menu: every section of the app in one place.
export const Sidebar: React.FC<SidebarProps> = ({ view, dueCount, userProfile, username, syncStatus, health, hasCards, onNavigate, onStartReview, onAddCard }) => {
  const level = calculateLevel(userProfile?.xp || 0).level;
  return (
    <aside className="hidden md:flex flex-col gap-1 w-64 shrink-0 h-screen sticky top-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 px-3 py-5">
      <button type="button" onClick={() => onNavigate('TODAY')} className="flex items-center gap-2.5 px-2 pb-5">
        <span className="w-9 h-9 rounded-xl bg-brand-500 text-white flex items-center justify-center"><Icon.Cards size={20} /></span>
        <span dir="ltr" className="font-en font-bold text-xl text-ink dark:text-white">Lingua Cards</span>
      </button>

      <NavLink active={view === 'TODAY'} onClick={() => onNavigate('TODAY')} icon={<Icon.Home size={20} />} label="امروز" />
      <NavLink active={view === 'STUDY'} onClick={onStartReview} icon={<Icon.Cards size={20} />} label="مرور" badge={dueCount} disabled={!hasCards} />
      <NavLink active={view === 'PRACTICE'} onClick={() => onNavigate('PRACTICE')} icon={<Icon.Chat size={20} />} label="تمرین مکالمه و آزمون" disabled={!hasCards} />
      <NavLink active={TEXT_VIEWS.includes(view)} onClick={() => onNavigate('TEXTS')} icon={<Icon.Book size={20} />} label="کتابخانه" />
      <NavLink active={DECK_VIEWS.includes(view)} onClick={() => onNavigate('DECKS')} icon={<Icon.Layers size={20} />} label="واژه‌ها و دسته‌ها" />
      <NavLink active={view === 'STATS' || view === 'ACHIEVEMENTS'} onClick={() => onNavigate('STATS')} icon={<Icon.Chart size={20} />} label="آمار و نشان‌ها" />
      <NavLink active={['SETTINGS', 'USAGE', 'CHANGELOG', 'PROFILE'].includes(view)} onClick={() => onNavigate('SETTINGS')} icon={<Icon.Gear size={20} />} label="تنظیمات" />

      <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2">
        <span className="px-3 text-xs text-ink-muted dark:text-slate-400">افزودن</span>
        <button type="button" onClick={onAddCard}
          className="flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-ink text-white font-bold hover:bg-ink-soft dark:bg-white dark:text-ink">
          <Icon.Plus size={18} />کارت تازه
        </button>
        <div className="grid grid-cols-3 gap-1.5 text-xs">
          <button type="button" onClick={() => onNavigate('BULK_ADD')} className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">گروهی</button>
          <button type="button" onClick={() => onNavigate('TEXTS')} className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">از متن</button>
          <button type="button" onClick={() => onNavigate('SETTINGS')} className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800" title="ورود و خروج CSV در تنظیمات">CSV</button>
        </div>
      </div>

      <div className="flex-1" />
      <button type="button" onClick={() => onNavigate('PROFILE')} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-right">
        <span className="w-9 h-9 rounded-full bg-brand-200 text-brand-700 flex items-center justify-center font-extrabold">
          {(userProfile?.firstName || username || '?').slice(0, 1)}
        </span>
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-bold text-ink dark:text-white truncate">{userProfile?.firstName || username} · سطح {fa(level)}</span>
          <span className="flex items-center gap-1.5 text-xs text-ink-muted dark:text-slate-400">
            <span className={`w-2 h-2 rounded-full ${SYNC_DOT[syncStatus]}`} />{SYNC_LABEL[syncStatus]}
          </span>
        </span>
      </button>
      <div dir="ltr" className="flex justify-center gap-3 pt-2 text-[11px] text-slate-400">
        {health.map(h => (
          <span key={h.label} className="flex items-center gap-1" title={`${h.label}: ${h.status}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${h.status === 'ok' ? 'bg-emerald-500' : h.status === 'error' ? 'bg-red-500' : 'bg-amber-500 animate-pulse'}`} />{h.label}
          </span>
        ))}
      </div>
      {health.some(h => h.label === 'DB' && h.status === 'error') && <DbRepair />}
    </aside>
  );
};

// Phone tab bar: four tabs; everything else is one step inside them.
export const BottomTabs: React.FC<{ view: View; onNavigate: (view: View) => void }> = ({ view, onNavigate }) => {
  const tabs: { view: View; label: string; icon: React.ReactNode; active: boolean }[] = [
    { view: 'TODAY', label: 'امروز', icon: <Icon.Home />, active: view === 'TODAY' },
    { view: 'TEXTS', label: 'کتابخانه', icon: <Icon.Book />, active: TEXT_VIEWS.includes(view) },
    { view: 'DECKS', label: 'واژه‌ها', icon: <Icon.Layers />, active: DECK_VIEWS.includes(view) },
    { view: 'ME', label: 'من', icon: <Icon.User />, active: ME_VIEWS.includes(view) },
  ];
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 grid grid-cols-4 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {tabs.map(t => (
        <button key={t.view} type="button" onClick={() => onNavigate(t.view)} aria-current={t.active ? 'page' : undefined}
          className={`flex flex-col items-center justify-center gap-1 min-h-[48px] text-xs ${t.active ? 'text-brand-500 font-bold dark:text-brand-300' : 'text-ink-muted dark:text-slate-400'}`}>
          {t.icon}<span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
};

// Floating add button on phones.
export const AddFab: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button type="button" onClick={onClick} aria-label="افزودن کارت"
    className="md:hidden fixed left-5 bottom-24 z-20 w-14 h-14 rounded-2xl bg-ink text-white shadow-lg flex items-center justify-center animate-fab-in dark:bg-white dark:text-ink">
    <Icon.Plus size={26} />
  </button>
);
