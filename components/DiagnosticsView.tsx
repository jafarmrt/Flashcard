// File: /components/DiagnosticsView.tsx
// In-app diagnostics & troubleshooting panel: sync queue state, service
// connectivity, classified recent errors, offline cache status, and PWA install.

import React, { useCallback, useEffect, useState } from 'react';
import type { HealthStatus, SyncStatus } from '../hooks/useAppLogic';
import { db } from '../services/localDBService';
import { toSyncedSettings } from '../services/settingsSync';
import type { SyncState } from '../services/syncClient';
import { classifyErrorReason, pendingSyncSummary, type PendingSyncSummary } from '../services/syncRunner';
import { readUsage, recentErrors, type UsageRow } from '../services/usageLog';
import { APP_VERSION } from '../services/appVersion';
import { DbRepair } from './layout/DbRepair';
import { SYNC_LABEL } from './layout/Navigation';
import { fa, Icon } from './common/ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const standalone =
      (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(standalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return { isInstallable: !!deferredPrompt, isInstalled, isIOS, install };
}

export interface DiagnosticsViewProps {
  username?: string;
  syncStatus: SyncStatus;
  lastSyncAt: number | null;
  lastSyncError: string;
  health: { label: string; status: HealthStatus }[];
  onSyncNow: () => Promise<void> | void;
  onRecheckHealth: () => Promise<void> | void;
  onBack: () => void;
}

interface CacheReport {
  swActive: boolean;
  shellCount: number;
  assetCount: number;
  usedMb: number | null;
}

const HEALTH_NAMES: Record<string, string> = {
  DB: 'پایگاه دادهٔ مرورگر (IndexedDB)',
  AI: 'سرور و درگاه هوش مصنوعی',
  'Free Dict.': 'دیکشنری رایگان',
  MW: 'دیکشنری مریام-وبستر',
};

const HEALTH_STATUS_TEXT: Record<HealthStatus, string> = {
  ok: 'آماده',
  checking: 'در حال بررسی…',
  error: 'خطا یا قطع',
};

const relativeTimeFa = (ms: number | null): string => {
  if (!ms) return 'در این نشست هنوز همگام نشده';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 45) return 'چند لحظه پیش';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${fa(mins)} دقیقه پیش`;
  const hours = Math.floor(mins / 60);
  return `${fa(hours)} ساعت پیش`;
};

const readSavedSettingsRaw = () => {
  try {
    return JSON.parse(localStorage.getItem('appSettings') || '{}');
  } catch {
    return {};
  }
};

export const DiagnosticsView: React.FC<DiagnosticsViewProps> = ({
  username,
  syncStatus,
  lastSyncAt,
  lastSyncError,
  health,
  onSyncNow,
  onRecheckHealth,
  onBack,
}) => {
  const [queue, setQueue] = useState<PendingSyncSummary | null>(null);
  const [errors, setErrors] = useState<UsageRow[]>([]);
  const [cacheReport, setCacheReport] = useState<CacheReport | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [confirmClearCache, setConfirmClearCache] = useState(false);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheMessage, setCacheMessage] = useState('');
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  const pwa = usePWAInstall();

  const inspectLocalState = useCallback(async () => {
    try {
      const savedSettings = readSavedSettingsRaw();
      const [
        decks, cards, sources, chapters, occurrences, knownWords,
        speechAttempts, notes, practice, logs, profile, achievements,
        chapterTexts, syncMeta, usageRows,
      ] = await Promise.all([
        db.decks.toArray(),
        db.flashcards.toArray(),
        db.sources.toArray(),
        db.chapters.toArray(),
        db.occurrences.toArray(),
        db.knownWords.toArray(),
        db.speechAttempts.toArray(),
        db.notes.toArray(),
        db.practice.toArray(),
        db.studyHistory.toArray(),
        db.userProfile.get(1),
        db.userAchievements.toArray(),
        db.chapterTexts.toArray(),
        db.meta.get('sync'),
        readUsage(),
      ]);

      const savedSync = syncMeta?.value as SyncState | undefined;
      const summary = pendingSyncSummary(
        {
          decks, cards, sources, chapters, occurrences, knownWords,
          speechAttempts, notes, practice, logs, profile, achievements,
          settings: toSyncedSettings(savedSettings),
        },
        savedSync && (!username || savedSync.user.toLowerCase() === username.toLowerCase()) ? savedSync : undefined,
        chapterTexts,
        savedSettings,
      );
      setQueue(summary);
      setErrors(recentErrors(usageRows, 5));
    } catch (e) {
      console.warn('Diagnostics read failed:', e);
    }

    try {
      const swActive = Boolean(navigator.serviceWorker?.controller);
      let shellCount = 0;
      let assetCount = 0;
      if (typeof caches !== 'undefined') {
        const names = await caches.keys();
        for (const name of names) {
          const c = await caches.open(name);
          const keys = await c.keys();
          if (name.startsWith('lc-shell')) shellCount += keys.length;
          else if (name.startsWith('lc-assets')) assetCount += keys.length;
        }
      }
      let usedMb: number | null = null;
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        if (typeof est.usage === 'number') usedMb = Math.max(1, Math.round(est.usage / (1024 * 1024)));
      }
      setCacheReport({ swActive, shellCount, assetCount, usedMb });
    } catch {
      setCacheReport({ swActive: false, shellCount: 0, assetCount: 0, usedMb: null });
    }
  }, [username]);

  useEffect(() => {
    inspectLocalState();
  }, [inspectLocalState, syncStatus, lastSyncAt]);

  useEffect(() => {
    const onNet = () => setOnline(navigator.onLine);
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    return () => {
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
    };
  }, []);

  const handleSyncClick = async () => {
    await onSyncNow();
    await inspectLocalState();
  };

  const handleHealthClick = async () => {
    setCheckingHealth(true);
    try {
      await onRecheckHealth();
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleRefreshAppCache = async () => {
    setCacheBusy(true);
    setCacheMessage('');
    // The cached files are what lets the app open without the internet:
    // they are dropped only when the server answers now. Offline, or on a
    // network that blocks the site, the app could not open again until the
    // connection came back.
    // (A POST to the API: the service worker would answer '/' from the cache.)
    const reachable = navigator.onLine !== false && await fetch('/api/proxy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ping' }), cache: 'no-store',
    }).then(r => r.ok, () => false);
    if (!reachable) {
      setCacheBusy(false);
      setCacheMessage('اکنون به سرور برنامه دسترسی نیست؛ کش دست نخورد تا برنامه بی‌اینترنت هم باز شود. وقتی وصل شدی دوباره امتحان کن.');
      return;
    }
    try {
      if (typeof caches !== 'undefined') {
        const names = await caches.keys();
        await Promise.all(
          names.filter(n => n.startsWith('lc-shell') || n.startsWith('lc-assets')).map(n => caches.delete(n)),
        );
      }
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.update().catch(() => undefined)));
      }
      setConfirmClearCache(false);
      setCacheMessage('کش فایل‌های برنامه پاک شد؛ در حال بارگذاری نسخهٔ تازه…');
      setTimeout(() => window.location.reload(), 600);
    } catch {
      setCacheBusy(false);
      setCacheMessage('تازه‌سازی کش انجام نشد. اینترنت را بررسی کن و دوباره امتحان کن.');
    }
  };

  const syncIssue = lastSyncError ? classifyErrorReason(lastSyncError, syncStatus === 'offline' || !online) : null;
  const button = 'min-h-[44px] px-4 rounded-xl text-sm font-bold border border-slate-200 dark:border-slate-600 text-ink dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50';
  const primaryBtn = 'min-h-[44px] px-5 rounded-xl text-sm font-bold bg-brand-500 hover:bg-brand-600 text-white transition-colors disabled:opacity-50';

  const pendingItems = queue ? [
    queue.byTable.cards > 0 && `${fa(queue.byTable.cards)} کارت`,
    queue.byTable.decks > 0 && `${fa(queue.byTable.decks)} دسته`,
    (queue.byTable.sources + queue.byTable.chapters + queue.byTable.occurrences) > 0 &&
      `${fa(queue.byTable.sources + queue.byTable.chapters + queue.byTable.occurrences)} تغییر کتابخانه`,
    queue.unsentLogs > 0 && `${fa(queue.unsentLogs)} مرور ثبت‌شده`,
    (queue.byTable.practice + queue.byTable.speechAttempts) > 0 &&
      `${fa(queue.byTable.practice + queue.byTable.speechAttempts)} پاسخ تمرین و تلفظ`,
    (queue.byTable.notes + queue.byTable.knownWords) > 0 &&
      `${fa(queue.byTable.notes + queue.byTable.knownWords)} یادداشت و واژهٔ بلدم`,
    queue.unuploadedChapters > 0 && `${fa(queue.unuploadedChapters)} متن فصل آپلودنشده`,
    queue.unsentKeys > 0 && `${fa(queue.unsentKeys)} کلید منتظر ارسال`,
  ].filter((x): x is string => Boolean(x)) : [];

  return (
    <div dir="rtl" className="font-fa max-w-4xl mx-auto w-full flex flex-col gap-5">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="بازگشت"
          className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-ink dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800"
        >
          <Icon.Back size={22} />
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-ink dark:text-white">وضعیت و عیب‌یابی</h1>
          <p className="text-sm text-ink-muted dark:text-slate-400">
            نسخهٔ <span dir="ltr" className="font-en tabular-nums">{APP_VERSION}</span>
            {username ? <> · حساب <span dir="ltr" className="font-en">{username}</span></> : null}
            {' · '}
            <span>{online ? 'اینترنت مرورگر وصل است' : 'مرورگر آفلاین است'}</span>
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
        <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-ink dark:text-white">همگام‌سازی و صف آفلاین</h2>
              <p className="text-sm text-ink-muted dark:text-slate-400 mt-0.5 tabular-nums">
                <span>{SYNC_LABEL[syncStatus]}</span>
                {queue ? <> · نوبت سرور: {fa(queue.rev)}</> : null}
                {' · '}
                <span>{relativeTimeFa(lastSyncAt)}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={handleSyncClick}
              disabled={syncStatus === 'syncing'}
              className={primaryBtn}
            >
              {syncStatus === 'syncing' ? 'در حال همگام‌سازی…' : 'همگام‌سازی الان'}
            </button>
          </div>

          {syncIssue && (
            <div role="alert" className="rounded-2xl bg-amber-50 dark:bg-amber-900/30 p-4 flex flex-col gap-1 text-sm">
              <p className="font-bold text-amber-950 dark:text-amber-100">{syncIssue.label}</p>
              <p className="text-amber-900 dark:text-amber-200 leading-relaxed">{syncIssue.advice}</p>
              <p dir="ltr" className="font-en text-xs text-ink-muted dark:text-slate-400 break-words mt-1">{lastSyncError}</p>
            </div>
          )}

          {queue && (
            <div className="border-t border-slate-100 dark:border-slate-700 pt-3 flex flex-col gap-2 text-sm">
              {queue.totalPending === 0 ? (
                <p className="text-emerald-700 dark:text-emerald-300 font-bold">
                  صف ارسال خالی است؛ همهٔ تغییرهای این دستگاه به سرور رسیده است.
                </p>
              ) : (
                <>
                  <p className="font-bold text-ink dark:text-white tabular-nums">
                    در صف ارسال به سرور ({fa(queue.totalPending)} مورد):
                  </p>
                  <p className="text-ink-muted dark:text-slate-300 leading-relaxed tabular-nums">
                    {pendingItems.join(' · ')}
                  </p>
                </>
              )}
              {queue.missingOrStaleChapters > 0 && (
                <p className="text-xs text-ink-muted dark:text-slate-400 tabular-nums">
                  متن {fa(queue.missingOrStaleChapters)} فصل هنوز از سرور گرفته نشده یا نسخهٔ ویرایش‌شدهٔ تازه‌تری روی سرور دارد؛ پس از همگام‌سازی در پس‌زمینه دریافت می‌شود.
                </p>
              )}
            </div>
          )}
        </section>

        <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-ink dark:text-white">سلامت سرویس‌ها</h2>
              <p className="text-sm text-ink-muted dark:text-slate-400 mt-0.5">
                بررسی زندهٔ پایگاه دادهٔ مرورگر، سرور و دیکشنری‌ها
              </p>
            </div>
            <button type="button" onClick={handleHealthClick} disabled={checkingHealth} className={button}>
              {checkingHealth ? 'در حال بررسی…' : 'بررسی دوباره'}
            </button>
          </div>

          <dl className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
            {health.map(h => (
              <div key={h.label} className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-ink dark:text-slate-200">{HEALTH_NAMES[h.label] || h.label}</dt>
                <dd className={`font-bold whitespace-nowrap ${
                  h.status === 'ok'
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : h.status === 'error'
                      ? 'text-red-700 dark:text-red-300'
                      : 'text-amber-700 dark:text-amber-300'
                }`}>
                  {HEALTH_STATUS_TEXT[h.status]}
                </dd>
              </div>
            ))}
          </dl>

          {health.some(h => h.label === 'DB' && h.status === 'error') && <DbRepair />}
        </section>
      </div>

      <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-ink dark:text-white">حافظهٔ آفلاین و نصب برنامه</h2>
          <p className="text-sm text-ink-muted dark:text-slate-400 mt-0.5 tabular-nums">
            {cacheReport ? (
              <>
                <span>سرویس‌ورکر آفلاین: {cacheReport.swActive ? 'فعال' : 'غیرفعال در این نشست'}</span>
                {' · '}
                <span>فایل‌های پوسته: {fa(cacheReport.shellCount)}</span>
                {' · '}
                <span>فایل‌های ذخیرهٔ برنامه: {fa(cacheReport.assetCount)}</span>
                {cacheReport.usedMb !== null ? <> · فضای مصرفی مرورگر: حدود {fa(cacheReport.usedMb)} مگابایت</> : null}
              </>
            ) : 'در حال خواندن وضعیت حافظه…'}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-700 pt-3">
          <p className="text-sm text-ink-muted dark:text-slate-300 max-w-xl">
            اگر پس از به‌روزرسانی، صفحه‌ای قدیمی مانده یا باز نمی‌شود، کش فایل‌های برنامه را تازه کن. کارت‌ها، کتاب‌ها و تنظیمات دست‌نخورده می‌مانند.
          </p>
          {confirmClearCache ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={cacheBusy} onClick={() => setConfirmClearCache(false)} className={button}>
                انصراف
              </button>
              <button type="button" disabled={cacheBusy} onClick={handleRefreshAppCache} className={primaryBtn}>
                {cacheBusy ? 'در حال تازه‌سازی…' : 'تأیید و بارگذاری دوباره'}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmClearCache(true)} className={button}>
              تازه‌سازی کش برنامه
            </button>
          )}
        </div>
        {cacheMessage && (
          <p role="status" className="text-sm font-bold text-brand-700 dark:text-brand-300">{cacheMessage}</p>
        )}

        {!pwa.isInstalled && (pwa.isInstallable || pwa.isIOS) && (
          <div className="border-t border-slate-100 dark:border-slate-700 pt-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-ink dark:text-white">نصب روی صفحهٔ اصلی گوشی</h3>
                <p className="text-xs text-ink-muted dark:text-slate-400 mt-0.5">
                  برنامه تمام‌صفحه و بدون نوار مرورگر، حتی بی‌اینترنت باز می‌شود.
                </p>
              </div>
              {pwa.isInstallable ? (
                <button type="button" onClick={pwa.install} className={primaryBtn}>
                  نصب برنامه
                </button>
              ) : (
                <button type="button" onClick={() => setShowIOSGuide(v => !v)} className={button}>
                  {showIOSGuide ? 'بستن راهنما' : 'راهنمای نصب روی iPhone / iPad'}
                </button>
              )}
            </div>
            {showIOSGuide && pwa.isIOS && (
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-4 text-sm text-ink dark:text-slate-200 leading-7">
                ۱. در مرورگر Safari دکمهٔ <strong>Share</strong> (مربع با فلش رو به بالا) را بزن.<br />
                ۲. پایین برو و <strong>Add to Home Screen</strong> را انتخاب کن.
              </div>
            )}
          </div>
        )}
      </section>

      <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-ink dark:text-white">خطاهای اخیر سرویس‌ها</h2>
          <p className="text-sm text-ink-muted dark:text-slate-400 mt-0.5">
            پنج خطای آخر ثبت‌شده روی این دستگاه به همراه علت احتمالی
          </p>
        </div>

        {errors.length === 0 ? (
          <p className="text-sm text-ink-muted dark:text-slate-400">خطایی در درخواست‌های اخیر ثبت نشده است.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
            {errors.map((err, idx) => {
              const info = classifyErrorReason(err.error || '');
              return (
                <li key={err.id ?? idx} className="py-3 flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-bold text-ink dark:text-white">
                      <bdi dir="ltr" className="font-en">{err.service}</bdi>
                      {' · '}
                      <span className="text-amber-800 dark:text-amber-200">{info.label}</span>
                    </span>
                    <span className="text-xs text-ink-muted dark:text-slate-400 tabular-nums">{err.day}</span>
                  </div>
                  <p className="text-xs text-ink-muted dark:text-slate-300">{info.advice}</p>
                  {err.error && (
                    <p dir="ltr" className="font-en text-xs text-ink-muted dark:text-slate-400 break-words">{err.error}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};

export default DiagnosticsView;
