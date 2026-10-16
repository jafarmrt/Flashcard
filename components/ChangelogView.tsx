import React from 'react';
import { APP_VERSION, RELEASES } from '../services/appVersion';
import { Icon } from './common/ui';

interface ChangelogViewProps {
  onBack: () => void;
}

const persianDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });
};

// Every release, newest first, read from CHANGELOG.md.
export const ChangelogView: React.FC<ChangelogViewProps> = ({ onBack }) => (
  <div dir="rtl" className="font-fa max-w-3xl mx-auto w-full flex flex-col gap-5">
    <header className="flex items-center gap-3">
      <button type="button" onClick={onBack} aria-label="بازگشت به تنظیمات" title="بازگشت به تنظیمات"
        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-ink dark:text-white hover:bg-slate-200 dark:hover:bg-slate-800">
        <Icon.Back size={20} />
      </button>
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold text-ink dark:text-white">تغییرات نسخه‌ها</h1>
        <p className="text-sm text-ink-muted dark:text-slate-400">
          نسخهٔ فعلی: <span dir="ltr" className="font-en">{APP_VERSION}</span>
        </p>
      </div>
    </header>

    {RELEASES.map((release, i) => (
      <section key={release.version} aria-labelledby={`release-${release.version}`}
        className={`rounded-3xl p-5 bg-white dark:bg-slate-800 ${i === 0 ? 'ring-2 ring-brand-500/60' : ''}`}>
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span dir="ltr" className="font-en text-sm font-bold rounded-full bg-slate-100 dark:bg-slate-700 text-ink dark:text-white px-3 py-1">
            {release.version}
          </span>
          {i === 0 && <span className="text-xs font-bold rounded-full bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200 px-2 py-0.5">تازه‌ترین</span>}
          {release.date && <span className="text-xs text-ink-muted dark:text-slate-400">{persianDate(release.date)}</span>}
        </div>
        <div dir="ltr" className="font-en text-left">
          {release.title && <h2 id={`release-${release.version}`} className="text-lg font-bold text-ink dark:text-white mb-2">{release.title}</h2>}
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
            {release.items.map((item, j) => (
              <li key={j}>
                {item.label && <strong className="font-semibold text-ink dark:text-white">{item.label}: </strong>}
                {item.text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')}
              </li>
            ))}
          </ul>
        </div>
      </section>
    ))}
  </div>
);
