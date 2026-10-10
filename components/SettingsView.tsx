import React, { useRef, useState } from 'react';
import { AiProviderId, AiProviderSetting, Settings } from '../types';
import { AI_PROVIDERS, providerInfo, providerKey, providerList, providerOptions, providerProblem } from '../services/aiSettings';
import { testAiConnection } from '../services/geminiService';
import { fa, Icon } from './common/ui';

interface SettingsViewProps {
    settings: Settings;
    onUpdateSettings: (newSettings: Partial<Settings>) => void;
    onExportCSV: () => void;
    onImportCSV: (csvText: string) => void;
    onResetApp: () => void;
    onDeleteAllCards: () => void;
    onNavigateToChangelog: () => void;
    onNavigateToAchievements: () => void;
    onNavigateToProfile: () => void;
    onNavigateToUsage: () => void;
    currentUser: { username: string } | null;
    onLogout: () => void;
}

const APP_VERSION = '7.0.0';

// Defined outside SettingsView: a component created inside it would be a new
// type on every render, so its inputs would lose focus after each key press.
const Row: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-700 last:border-b-0">
        <div className="min-w-0">
            <h3 className="font-bold text-ink dark:text-white">{title}</h3>
            {hint && <p className="text-sm text-ink-muted dark:text-slate-400 mt-0.5">{hint}</p>}
        </div>
        <div className="shrink-0">{children}</div>
    </div>
);

const Card: React.FC<{ title: string; children: React.ReactNode; tone?: 'danger' }> = ({ title, children, tone }) => (
    <section className={`rounded-3xl overflow-hidden ${tone === 'danger' ? 'bg-red-50 dark:bg-red-950/40 ring-1 ring-red-200 dark:ring-red-900' : 'bg-white dark:bg-slate-800'}`}>
        <h2 className={`px-5 pt-5 pb-2 text-lg font-extrabold ${tone === 'danger' ? 'text-red-800 dark:text-red-200' : 'text-ink dark:text-white'}`}>{title}</h2>
        {children}
    </section>
);

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
    return (
        <div role="group" aria-label={label} className="flex flex-wrap gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-700">
            {options.map(o => (
                <button key={String(o.value)} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
                    className={`min-h-[36px] px-3 rounded-lg text-sm ${value === o.value ? 'bg-white dark:bg-slate-600 shadow-sm font-bold text-brand-700 dark:text-white' : 'text-ink-muted dark:text-slate-300'}`}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

const button = 'min-h-[40px] px-4 rounded-xl text-sm font-bold border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700';
const input = 'w-full min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-en focus:border-brand-500 focus:outline-none';

type Draft = { key: string; model: string; baseUrl: string };

// The AI services, in the order they are tried. Each has its own key; when
// one fails (no quota left, a wrong key), the next is asked, and in the end
// the free dictionaries.
const AiProviders: React.FC<{ settings: Settings; onUpdateSettings: (s: Partial<Settings>) => void }> = ({ settings, onUpdateSettings }) => {
    const list = providerList(settings);
    const [open, setOpen] = useState<AiProviderId | null>(null);
    const [drafts, setDrafts] = useState<Partial<Record<AiProviderId, Draft>>>({});
    const [tests, setTests] = useState<Partial<Record<AiProviderId, { busy?: boolean; ok?: boolean; message?: string }>>>({});

    const keysNow = () => {
        const keys: Partial<Record<AiProviderId, string>> = {};
        for (const info of AI_PROVIDERS) {
            const key = providerKey(settings, info.id);
            if (key) keys[info.id] = key;
        }
        return keys;
    };
    const save = (next: AiProviderSetting[], keys = keysNow()) => onUpdateSettings({
        aiProviders: next, aiKeys: keys, aiProvider: undefined, aiBaseUrl: undefined, aiModel: undefined, customApiKey: undefined,
    });

    const draftOf = (entry: AiProviderSetting): Draft => drafts[entry.id] || { key: providerKey(settings, entry.id) || '', model: entry.model || '', baseUrl: entry.baseUrl || '' };
    const setDraft = (id: AiProviderId, patch: Partial<Draft>) => setDrafts(d => ({ ...d, [id]: { ...draftOf(list.find(e => e.id === id)!), ...patch } }));
    // Typed values are saved when the field is left.
    const commit = (entry: AiProviderSetting) => {
        const d = drafts[entry.id];
        if (!d) return;
        const keys = keysNow();
        if (d.key.trim()) keys[entry.id] = d.key.trim(); else delete keys[entry.id];
        save(list.map(e => (e.id === entry.id ? { ...e, model: d.model.trim() || undefined, baseUrl: d.baseUrl.trim() || undefined } : e)), keys);
        setDrafts(prev => { const copy = { ...prev }; delete copy[entry.id]; return copy; });
    };

    const enabledCount = list.filter(e => e.enabled).length;
    const move = (index: number, by: -1 | 1) => {
        const next = [...list];
        const [item] = next.splice(index, 1);
        next.splice(index + by, 0, item);
        save(next);
    };
    const toggle = (entry: AiProviderSetting) => save(list.map(e => (e.id === entry.id ? { ...e, enabled: !e.enabled } : e)));

    const test = async (entry: AiProviderSetting) => {
        commit(entry);
        const d = draftOf(entry);
        const options = providerOptions({ ...settings, aiKeys: { ...keysNow(), [entry.id]: d.key.trim() || undefined } }, { ...entry, model: d.model.trim() || entry.model, baseUrl: d.baseUrl.trim() || entry.baseUrl });
        setTests(t => ({ ...t, [entry.id]: { busy: true } }));
        const result = await testAiConnection(options);
        setTests(t => ({ ...t, [entry.id]: { ok: result.ok, message: result.ok ? 'وصل شد و جواب داد.' : result.message } }));
    };

    const usable = list.filter(e => e.enabled && !providerProblem(settings, e)).length;
    let order = 0;
    return (
        <div className="px-5 pb-5 flex flex-col gap-3">
            <p className="text-sm text-ink-muted dark:text-slate-400">
                از بالا به پایین امتحان می‌شوند: اگر سهمیهٔ رایگان اولی تمام شود یا کلیدش خطا بدهد، سراغ بعدی می‌رود و در آخر دیکشنری رایگان. کلیدها فقط روی همین دستگاه می‌مانند.
            </p>
            <ol className="flex flex-col gap-2">
                {list.map((entry, i) => {
                    const info = providerInfo(entry.id);
                    const problem = entry.enabled ? providerProblem(settings, entry) : null;
                    const inUse = entry.enabled && !problem;
                    if (inUse) order++;
                    const d = draftOf(entry);
                    const t = tests[entry.id];
                    const isOpen = open === entry.id;
                    return (
                        <li key={entry.id} className={`rounded-2xl ring-1 ${inUse ? 'ring-brand-200 dark:ring-brand-800' : 'ring-slate-200 dark:ring-slate-700'}`}>
                            <div className="flex items-center gap-2 p-2.5">
                                <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-extrabold shrink-0 ${inUse ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-400 dark:bg-slate-700'}`}>
                                    {inUse ? fa(order) : '–'}
                                </span>
                                <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                                    <input type="checkbox" checked={entry.enabled} onChange={() => toggle(entry)} disabled={entry.enabled && enabledCount === 1}
                                        className="w-[18px] h-[18px] accent-brand-500" aria-label={`استفاده از ${info.name}`} />
                                    <span className="font-bold text-ink dark:text-white truncate"><bdi>{info.name}</bdi></span>
                                    {problem && <span className="text-xs rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 px-2 py-0.5">{problem}؛ رد می‌شود</span>}
                                    {entry.id === 'gemini' && !providerKey(settings, 'gemini') && entry.enabled && <span className="text-xs text-ink-muted dark:text-slate-400">کلید سرور</span>}
                                </label>
                                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${info.name} بالاتر`} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30"><Icon.Back size={16} className="-rotate-90" /></button>
                                <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`${info.name} پایین‌تر`} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30"><Icon.Back size={16} className="rotate-90" /></button>
                                <button type="button" onClick={() => setOpen(isOpen ? null : entry.id)} aria-expanded={isOpen} className="min-h-[36px] px-3 rounded-xl text-sm text-brand-600 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-slate-700">
                                    {isOpen ? 'بستن' : 'کلید و مدل'}
                                </button>
                            </div>
                            {isOpen && (
                                <div className="px-3 pb-3 grid gap-3 sm:grid-cols-2">
                                    <label className="flex flex-col gap-1 text-sm">
                                        <span className="text-ink-muted dark:text-slate-400">کلید API{info.needsKey ? '' : ' (اختیاری)'}</span>
                                        <input type="password" dir="ltr" autoComplete="off" value={d.key} onChange={e => setDraft(entry.id, { key: e.target.value })} onBlur={() => commit(entry)}
                                            placeholder={entry.id === 'gemini' ? 'خالی: کلید سرور' : ''} className={input} />
                                        {info.keyUrl && <a href={info.keyUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 dark:text-brand-300 hover:underline">گرفتن کلید</a>}
                                    </label>
                                    <label className="flex flex-col gap-1 text-sm">
                                        <span className="text-ink-muted dark:text-slate-400">مدل</span>
                                        <input type="text" dir="ltr" value={d.model} onChange={e => setDraft(entry.id, { model: e.target.value })} onBlur={() => commit(entry)}
                                            placeholder={info.defaultModel || 'model-name'} className={input} />
                                    </label>
                                    {(entry.id === 'custom' || entry.id === 'ollama') && (
                                        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                                            <span className="text-ink-muted dark:text-slate-400">نشانی سرویس (سازگار با OpenAI)</span>
                                            <input type="url" dir="ltr" value={d.baseUrl} onChange={e => setDraft(entry.id, { baseUrl: e.target.value })} onBlur={() => commit(entry)}
                                                placeholder={info.baseUrl || 'https://…/v1'} className={input} />
                                        </label>
                                    )}
                                    <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                                        <button type="button" onClick={() => test(entry)} disabled={t?.busy} className={button}>{t?.busy ? 'در حال آزمایش…' : 'آزمایش'}</button>
                                        {t?.message && <p className={`text-sm ${t.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}><bdi dir="auto">{t.message}</bdi></p>}
                                    </div>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ol>
            {usable === 0 && (
                <p role="note" className="text-sm rounded-xl bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100 px-3 py-2">
                    هیچ سرویس روشنی آماده نیست؛ Gemini با کلید سرور به کار می‌رود.
                </p>
            )}
        </div>
    );
};

const LEVELS: { value: NonNullable<Settings['userLevel']>; label: string }[] = [
    { value: 'A1', label: 'A1، مبتدی' },
    { value: 'A2', label: 'A2، پایه' },
    { value: 'B1', label: 'B1، متوسط' },
    { value: 'B2', label: 'B2، بالاتر از متوسط' },
    { value: 'C1', label: 'C1، پیشرفته' },
    { value: 'C2', label: 'C2، تسلط' },
    { value: 'IELTS', label: 'IELTS، دانشگاهی' },
    { value: 'TOEFL', label: 'TOEFL' },
];

const SettingsView: React.FC<SettingsViewProps> = ({
    settings, onUpdateSettings, onExportCSV, onImportCSV, onResetApp, onDeleteAllCards, onNavigateToChangelog, onNavigateToAchievements,
    onNavigateToProfile, onNavigateToUsage, currentUser, onLogout,
}) => {
    const importFileRef = useRef<HTMLInputElement>(null);

    const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => onImportCSV(e.target?.result as string);
        reader.readAsText(file);
        event.target.value = '';
    };

    return (
        <div dir="rtl" className="font-fa max-w-3xl mx-auto w-full flex flex-col gap-5">
            <h1 className="text-2xl font-extrabold text-ink dark:text-white">تنظیمات</h1>

            <Card title="حساب">
                <Row title="وارد شده با" hint="کارت‌ها و پیشرفت با همین حساب روی همهٔ دستگاه‌ها همگام می‌شوند.">
                    <div className="flex items-center gap-3">
                        <span dir="ltr" className="font-en font-bold text-brand-600 dark:text-brand-300">{currentUser?.username}</span>
                        <button type="button" onClick={onLogout} className={button}>خروج</button>
                    </div>
                </Row>
            </Card>

            <Card title="مطالعه">
                <Row title="سطح انگلیسی تو" hint="واژه‌های بالاتر از این سطح «سخت» حساب می‌شوند و پیشنهاد می‌شوند؛ پایین‌ترها نه.">
                    <select value={settings.userLevel || 'B2'} onChange={e => onUpdateSettings({ userLevel: e.target.value as Settings['userLevel'] })}
                        className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm">
                        {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                </Row>
                <Row title="هدف روزانهٔ مرور" hint="تعداد مرور در روز برای حلقهٔ هدف در صفحهٔ امروز؛ هر بخشی که می‌خوانی ۵ مرور حساب می‌شود. تغییر از همین امروز حساب می‌شود، مگر هدف امروز کامل شده باشد.">
                    <Segmented label="هدف روزانه" value={settings.dailyReviewGoal || 20} onChange={goal => onUpdateSettings({ dailyReviewGoal: goal })}
                        options={[10, 20, 30, 50].map(n => ({ value: n, label: fa(n) }))} />
                </Row>
                <Row title="پیش‌خوانی خودکار" hint="پیش از هر بخش کتاب، واژه‌های سخت آن یک بار نشان داده شود.">
                    <input type="checkbox" checked={!!settings.preReadAuto} onChange={e => onUpdateSettings({ preReadAuto: e.target.checked })} className="w-5 h-5 accent-brand-500" aria-label="پیش‌خوانی خودکار" />
                </Row>
                <Row title="نشان دادن ساختارهای دستوری" hint="واژه‌هایی که یک ساختار دستوری می‌سازند، هنگام خواندن با نقطه‌چین مشخص شوند.">
                    <input type="checkbox" checked={!settings.hideGrammar} onChange={e => onUpdateSettings({ hideGrammar: !e.target.checked })} className="w-5 h-5 accent-brand-500" aria-label="نشان دادن ساختارهای دستوری" />
                </Row>
                <Row title="دیکشنری کامل کردن کارت" hint="وقتی جزئیات یک کارت (تلفظ، تعریف، مثال) پر می‌شود.">
                    <Segmented label="دیکشنری" value={settings.defaultApiSource} onChange={source => onUpdateSettings({ defaultApiSource: source })}
                        options={[{ value: 'free', label: 'رایگان' }, { value: 'mw', label: 'Merriam-Webster' }]} />
                </Row>
            </Card>

            <Card title="سرویس‌های هوش مصنوعی">
                <AiProviders settings={settings} onUpdateSettings={onUpdateSettings} />
                <div className="px-5 pb-5 -mt-1">
                    <button type="button" onClick={onNavigateToUsage} className="inline-flex items-center gap-2 text-sm font-bold text-brand-600 dark:text-brand-300 hover:underline">
                        <Icon.Chart size={18} />گزارش مصرف سرویس‌ها و خطاها
                    </button>
                </div>
            </Card>

            <Card title="ظاهر">
                <Row title="رنگ‌بندی" hint="روشن، تیره، یا مثل سیستم.">
                    <Segmented label="رنگ‌بندی" value={settings.theme} onChange={theme => onUpdateSettings({ theme })}
                        options={[{ value: 'light', label: 'روشن' }, { value: 'dark', label: 'تیره' }, { value: 'system', label: 'سیستم' }]} />
                </Row>
            </Card>

            <Card title="افزودن گروهی">
                <Row title="هم‌زمانی" hint="چند واژه با هم پردازش شود. بیشتر سریع‌تر است ولی زودتر به سقف سرویس‌ها می‌خورد.">
                    <div className="flex items-center gap-3">
                        <input type="range" min="1" max="3" step="1" value={settings.bulkAddConcurrency || 3} onChange={e => onUpdateSettings({ bulkAddConcurrency: parseInt(e.target.value, 10) })} className="w-32 accent-brand-500" aria-label="هم‌زمانی" />
                        <span className="w-6 text-center font-bold">{fa(settings.bulkAddConcurrency || 3)}</span>
                    </div>
                </Row>
                <Row title="صبر برای هوش مصنوعی" hint="برای هر واژه، چند ثانیه منتظر جواب بماند.">
                    <div className="flex items-center gap-3">
                        <input type="range" min="5" max="60" step="5" value={settings.bulkAddAiTimeout || 15} onChange={e => onUpdateSettings({ bulkAddAiTimeout: parseInt(e.target.value, 10) })} className="w-32 accent-brand-500" aria-label="صبر برای هوش مصنوعی" />
                        <span className="w-14 text-center font-bold">{fa(settings.bulkAddAiTimeout || 15)} ثانیه</span>
                    </div>
                </Row>
                <Row title="صبر برای دیکشنری" hint="پیش از رفتن سراغ دیکشنری پشتیبان.">
                    <div className="flex items-center gap-3">
                        <input type="range" min="3" max="20" step="1" value={settings.bulkAddDictTimeout || 5} onChange={e => onUpdateSettings({ bulkAddDictTimeout: parseInt(e.target.value, 10) })} className="w-32 accent-brand-500" aria-label="صبر برای دیکشنری" />
                        <span className="w-14 text-center font-bold">{fa(settings.bulkAddDictTimeout || 5)} ثانیه</span>
                    </div>
                </Row>
            </Card>

            <Card title="داده‌ها">
                <Row title="پشتیبان CSV" hint="همهٔ کارت‌ها با همهٔ جزئیات در یک فایل؛ همین فایل دوباره وارد می‌شود.">
                    <div className="flex gap-2">
                        <input type="file" ref={importFileRef} onChange={handleFileImport} accept=".csv" className="hidden" />
                        <button type="button" onClick={() => importFileRef.current?.click()} className={button}>ورود از CSV</button>
                        <button type="button" onClick={onExportCSV} className={button}>خروجی CSV</button>
                    </div>
                </Row>
            </Card>

            <Card title="بیشتر">
                <Row title="پروفایل" hint="نام، معرفی و پیشرفت.">
                    <button type="button" onClick={onNavigateToProfile} className={button}>پروفایل</button>
                </Row>
                <Row title="نشان‌ها" hint="نشان‌ها و رکوردهایی که گرفته‌ای.">
                    <button type="button" onClick={onNavigateToAchievements} className={button}>نشان‌ها</button>
                </Row>
                <Row title="نسخهٔ برنامه" hint="تغییرات هر نسخه.">
                    <div className="flex items-center gap-2">
                        <span dir="ltr" className="font-en text-sm rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1">{APP_VERSION}</span>
                        <button type="button" onClick={onNavigateToChangelog} className="text-sm text-brand-600 dark:text-brand-300 hover:underline">تغییرات</button>
                    </div>
                </Row>
            </Card>

            <Card title="منطقهٔ خطر" tone="danger">
                <Row title="پاک کردن همهٔ کارت‌ها" hint="همهٔ کارت‌ها و دسته‌های این حساب از سرور و همهٔ دستگاه‌ها پاک می‌شود و برنمی‌گردد. کتاب‌ها، سطح و امتیاز می‌مانند.">
                    <button type="button" onClick={onDeleteAllCards} className="min-h-[40px] px-4 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-700 text-white">پاک کردن همه</button>
                </Row>
                <Row title="پاک کردن داده‌های این دستگاه" hint="همهٔ کارت‌ها و تنظیمات همین مرورگر پاک می‌شود و برنمی‌گردد. نسخهٔ روی سرور می‌ماند.">
                    <button type="button" onClick={onResetApp} className="min-h-[40px] px-4 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-700 text-white">پاک کردن</button>
                </Row>
            </Card>
        </div>
    );
};

export default SettingsView;
