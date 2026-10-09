import React, { useEffect, useMemo, useState } from 'react';
import type { Flashcard } from '../types';
import { callProxy } from '../services/apiService';
import { addDays, dayString } from '../services/streakService';
import {
    cardsByMaker, DICTIONARY_SERVICE, MYMEMORY_DAILY_CHARS, MYMEMORY_DAILY_CHARS_WITH_EMAIL, readUsage, recentErrors,
    totalsByService, translationCharsOn, TRANSLATION_SERVICE, usageByDay, USAGE_KEEP_DAYS, type UsageRow,
} from '../services/usageLog';
import { fa, Icon } from './common/ui';

interface UsageViewProps {
    cards: Flashcard[];
    onBack: () => void;
}

interface ServerStorage {
    backend: 'redis' | 'file';
    recordBytes: number;
    chapters: number;
    chapterBytes: number;
    translationEmail: boolean;
}

const SERVICE_NAME: Record<string, string> = {
    [DICTIONARY_SERVICE]: 'دیکشنری‌های رایگان',
    [TRANSLATION_SERVICE]: 'ترجمهٔ MyMemory',
};
const MAKER_NAME: Record<string, string> = {
    dictionary: 'دیکشنری‌های رایگان',
    rules: 'قاعده‌های برنامه',
    manual: 'دستی',
    import: 'از فایل',
    unknown: 'نامشخص (کارت‌های قدیمی)',
};
const TASK_NAME: Record<string, string> = {
    extract: 'ساخت کارت از متن', sense: 'معنی در جمله', grammar: 'ساختار جمله', practice: 'تمرین جمله‌سازی',
    check: 'چک معنی', details: 'تکمیل کارت', quiz: 'آزمون', pronunciation: 'تلفظ', other: 'دیگر',
    lookup: 'جست‌وجوی واژه', translate: 'ترجمهٔ جمله',
};

// English names stay left to right inside the Persian text.
const ltr = (s: string) => `⁨${s}⁩`;
const serviceName = (s: string) => SERVICE_NAME[s] || ltr(s);
const makerName = (s: string) => MAKER_NAME[s] || ltr(s);

const size = (bytes: number) => {
    if (bytes < 1024) return `${fa(bytes)} بایت`;
    if (bytes < 1024 * 1024) return `${fa(Math.round(bytes / 1024))} کیلوبایت`;
    return `${fa(Math.round((bytes / 1024 / 1024) * 10) / 10)} مگابایت`;
};

const dayLabel = (day: string, today: string) => {
    if (day === today) return 'امروز';
    if (day === addDays(today, -1)) return 'دیروز';
    try {
        return new Date(`${day}T12:00:00Z`).toLocaleDateString('fa-IR', { weekday: 'short', day: 'numeric', month: 'short' });
    } catch {
        return day;
    }
};

const Panel: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
    <section className="bg-white dark:bg-slate-800 rounded-3xl p-5">
        <h2 className="text-lg font-extrabold text-ink dark:text-white">{title}</h2>
        {hint && <p className="text-sm text-ink-muted dark:text-slate-400 mt-0.5">{hint}</p>}
        <div className="mt-3">{children}</div>
    </section>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="text-sm text-ink-muted dark:text-slate-400">{children}</p>
);

// What each service was asked on this device in the last 30 days, which
// failed and why, the cards each made, and how much data the app keeps.
export const UsageView: React.FC<UsageViewProps> = ({ cards, onBack }) => {
    const [rows, setRows] = useState<UsageRow[] | null>(null);
    const [server, setServer] = useState<ServerStorage | null>(null);
    const [serverError, setServerError] = useState('');
    const [device, setDevice] = useState<{ usage?: number; quota?: number } | null>(null);

    useEffect(() => {
        let alive = true;
        readUsage().then(r => alive && setRows(r)).catch(() => alive && setRows([]));
        callProxy('storage-usage', {}).then((s: ServerStorage) => alive && setServer(s))
            .catch((e: Error) => alive && setServerError(e?.message || 'خطا'));
        navigator.storage?.estimate?.().then(e => alive && setDevice({ usage: e.usage, quota: e.quota })).catch(() => undefined);
        return () => { alive = false; };
    }, []);

    const today = dayString(new Date());
    const monthStart = addDays(today, -(USAGE_KEEP_DAYS - 1));
    const data = useMemo(() => {
        const all = rows || [];
        return {
            today: totalsByService(all, today),
            month: totalsByService(all, monthStart),
            days: usageByDay(all, today, 7),
            errors: recentErrors(all, 10),
            translated: translationCharsOn(all, today),
            makers: cardsByMaker(cards, monthStart),
        };
    }, [rows, cards, today, monthStart]);

    const quota = server?.translationEmail ? MYMEMORY_DAILY_CHARS_WITH_EMAIL : MYMEMORY_DAILY_CHARS;
    const left = Math.max(0, quota - data.translated);
    const busiest = Math.max(1, ...data.days.map(d => d.services.reduce((n, s) => n + s.ok + s.failed, 0)));

    return (
        <div dir="rtl" className="font-fa max-w-3xl mx-auto w-full flex flex-col gap-4">
            <header className="flex items-center gap-3">
                <button type="button" onClick={onBack} aria-label="بازگشت" className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-800">
                    <Icon.Back size={20} />
                </button>
                <div>
                    <h1 className="text-2xl font-extrabold text-ink dark:text-white">گزارش مصرف</h1>
                    <p className="text-sm text-ink-muted dark:text-slate-400">درخواست‌های این دستگاه در {fa(USAGE_KEEP_DAYS)} روز گذشته</p>
                </div>
            </header>

            {rows === null ? <p className="py-10 text-center text-ink-muted" role="status">…</p> : (
                <>
                    <Panel title="درخواست به هر سرویس" hint="ناموفق‌ها جدا شمرده شده‌اند.">
                        {data.month.length === 0 ? <Empty>هنوز درخواستی ثبت نشده.</Empty> : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-ink-muted dark:text-slate-400 text-right">
                                        <th className="font-medium py-1">سرویس</th>
                                        <th className="font-medium py-1">امروز</th>
                                        <th className="font-medium py-1">{fa(USAGE_KEEP_DAYS)} روز</th>
                                        <th className="font-medium py-1">ناموفق</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.month.map(s => {
                                        const t = data.today.find(x => x.service === s.service);
                                        return (
                                            <tr key={s.service} className="border-t border-slate-100 dark:border-slate-700 text-ink dark:text-slate-100">
                                                <td className="py-2 font-bold">{serviceName(s.service)}</td>
                                                <td className="py-2">{fa(t ? t.ok + t.failed : 0)}</td>
                                                <td className="py-2">{fa(s.ok + s.failed)}</td>
                                                <td className={`py-2 ${s.failed ? 'text-red-600 dark:text-red-300 font-bold' : ''}`}>{fa(s.failed)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </Panel>

                    <Panel title="هفت روز اخیر">
                        <ul className="flex flex-col gap-2">
                            {data.days.map(d => {
                                const total = d.services.reduce((n, s) => n + s.ok + s.failed, 0);
                                const failed = d.services.reduce((n, s) => n + s.failed, 0);
                                return (
                                    <li key={d.day} className="flex items-center gap-3 text-sm">
                                        <span className="w-24 shrink-0 text-ink-muted dark:text-slate-400">{dayLabel(d.day, today)}</span>
                                        <span className="flex-1 h-3 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden flex">
                                            <span className="h-full bg-brand-500" style={{ width: `${((total - failed) / busiest) * 100}%` }} />
                                            <span className="h-full bg-red-400" style={{ width: `${(failed / busiest) * 100}%` }} />
                                        </span>
                                        <span className="w-28 shrink-0 text-ink dark:text-slate-100" title={d.services.map(s => `${serviceName(s.service)}: ${fa(s.ok + s.failed)}`).join('، ')}>
                                            {fa(total)}{failed ? <span className="text-red-600 dark:text-red-300"> ({fa(failed)} ناموفق)</span> : null}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </Panel>

                    <Panel title="کارت‌هایی که هر سرویس ساخت" hint={`کارت‌های ${fa(USAGE_KEEP_DAYS)} روز گذشته`}>
                        {data.makers.length === 0 ? <Empty>در این مدت کارتی ساخته نشده.</Empty> : (
                            <ul className="flex flex-wrap gap-2">
                                {data.makers.map(m => (
                                    <li key={m.maker} className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1.5 text-sm text-ink dark:text-slate-100">
                                        {makerName(m.maker)}: <b>{fa(m.count)}</b>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Panel>

                    <Panel title="سهمیهٔ ترجمهٔ رایگان امروز" hint="ترجمهٔ فارسی جمله‌ها و واژه‌ها با MyMemory است که سهمیهٔ روزانه دارد. این عدد تخمینی است: جست‌وجوهایی که سرور از قبل داشته شمرده نمی‌شوند.">
                        <div className="flex items-center gap-3">
                            <span className="flex-1 h-3 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                                <span className={`block h-full ${left < quota * 0.15 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${(left / quota) * 100}%` }} />
                            </span>
                            <span className="text-sm text-ink dark:text-slate-100 shrink-0">حدود {fa(left)} از {fa(quota)} نویسه مانده</span>
                        </div>
                        {!server?.translationEmail && server && (
                            <p className="mt-2 text-xs text-ink-muted dark:text-slate-400">با گذاشتن یک ایمیل در متغیر {ltr('MYMEMORY_EMAIL')} روی سرور، سهمیه حدود ده برابر می‌شود.</p>
                        )}
                    </Panel>

                    <Panel title="خطاهای اخیر">
                        {data.errors.length === 0 ? <Empty>خطایی ثبت نشده.</Empty> : (
                            <ul className="flex flex-col gap-2">
                                {data.errors.map(e => (
                                    <li key={e.id ?? e.at} className="rounded-2xl bg-red-50 dark:bg-red-950/40 p-3 text-sm">
                                        <div className="flex flex-wrap gap-x-2 text-red-800 dark:text-red-200 font-bold">
                                            <span>{serviceName(e.service)}</span>
                                            <span className="font-normal">{TASK_NAME[e.task] || e.task}</span>
                                            {e.status ? <span className="font-normal">کد {fa(e.status)}</span> : null}
                                            <span className="font-normal text-ink-muted dark:text-slate-400">{new Date(e.at).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                                        </div>
                                        <p dir="auto" className="mt-1 text-ink dark:text-slate-100 break-words">{e.error}</p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Panel>
                </>
            )}

            <Panel title="حجم داده‌ها">
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-3">
                        <dt className="text-ink-muted dark:text-slate-400">روی سرور ({server ? (server.backend === 'redis' ? ltr('Upstash Redis') : 'فایل سرور') : '…'})</dt>
                        <dd className="mt-1 text-ink dark:text-white">
                            {server ? <>کارت‌ها و تنظیمات: <b>{size(server.recordBytes)}</b><br />متن {fa(server.chapters)} فصل: <b>{size(server.chapterBytes)}</b></>
                                : serverError ? <span className="text-red-600 dark:text-red-300">{serverError}</span> : '…'}
                        </dd>
                    </div>
                    <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-3">
                        <dt className="text-ink-muted dark:text-slate-400">روی این دستگاه</dt>
                        <dd className="mt-1 text-ink dark:text-white">
                            {device?.usage != null ? <>به‌کاررفته: <b>{size(device.usage)}</b>{device.quota ? <><br />جای آزاد برای برنامه: <b>{size(Math.max(0, device.quota - device.usage))}</b></> : null}</> : 'مرورگر این را نمی‌گوید.'}
                        </dd>
                    </div>
                </dl>
            </Panel>
        </div>
    );
};

export default UsageView;
