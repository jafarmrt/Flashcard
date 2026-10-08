import React from 'react';

// Persian digits for numbers shown in the Persian interface.
const faNumber = new Intl.NumberFormat('fa-IR');
export const fa = (n: number): string => faNumber.format(n);

type IconProps = { size?: number; className?: string };
const stroke = (size: number, className: string | undefined, children: React.ReactNode, strokeWidth = 2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{children}</svg>
);

export const Icon = {
  Home: ({ size = 22, className }: IconProps) => stroke(size, className, <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />),
  Cards: ({ size = 22, className }: IconProps) => stroke(size, className, <><rect x="3" y="7" width="13" height="14" rx="2" /><path d="M8 3h11a2 2 0 0 1 2 2v12" /></>),
  Chat: ({ size = 22, className }: IconProps) => stroke(size, className, <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  Book: ({ size = 22, className }: IconProps) => stroke(size, className, <><path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z" /><path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" /></>),
  Layers: ({ size = 22, className }: IconProps) => stroke(size, className, <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>),
  Chart: ({ size = 22, className }: IconProps) => stroke(size, className, <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
  Gear: ({ size = 22, className }: IconProps) => stroke(size, className, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
  User: ({ size = 22, className }: IconProps) => stroke(size, className, <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>),
  Plus: ({ size = 22, className }: IconProps) => stroke(size, className, <path d="M12 5v14M5 12h14" />, 2.4),
  Close: ({ size = 22, className }: IconProps) => stroke(size, className, <path d="M6 6l12 12M18 6L6 18" />, 2.4),
  Check: ({ size = 22, className }: IconProps) => stroke(size, className, <path d="M5 12l5 5 9-10" />, 3),
  Lock: ({ size = 22, className }: IconProps) => stroke(size, className, <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
  Gift: ({ size = 22, className }: IconProps) => stroke(size, className, <><rect x="3" y="9" width="18" height="11" rx="2" /><path d="M3 13h18M12 9v11M7 9c0-3 2-5 5-5s5 2 5 5" /></>),
  Shield: ({ size = 22, className }: IconProps) => stroke(size, className, <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />),
  Speaker: ({ size = 22, className }: IconProps) => stroke(size, className, <><path d="M11 5L6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></>),
  Medal: ({ size = 22, className }: IconProps) => stroke(size, className, <><circle cx="12" cy="9" r="6" /><path d="M8.5 14L7 22l5-3 5 3-1.5-8" /></>),
  Star: ({ size = 22, className }: IconProps) => stroke(size, className, <path d="M12 2l3 7 7 .8-5.3 4.8 1.6 7.4L12 18.3 5.7 22l1.6-7.4L2 9.8 9 9z" />),
  Back: ({ size = 22, className }: IconProps) => stroke(size, className, <path d="M9 6l6 6-6 6" />),
  List: ({ size = 22, className }: IconProps) => stroke(size, className, <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />),
  Upload: ({ size = 22, className }: IconProps) => stroke(size, className, <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />),
  Log: ({ size = 22, className }: IconProps) => stroke(size, className, <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></>),
  Flame: ({ size = 18, className }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true"><path fill="currentColor" d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5z" /></svg>
  ),
  Bolt: ({ size = 16, className }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true"><path fill="currentColor" d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>
  ),
};

// A keyboard key hint, shown only where a keyboard is likely (md and up).
export const Kbd: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <kbd dir="ltr" className={`hidden md:inline-block font-en text-[11px] leading-none px-1.5 py-1 rounded-md border border-current opacity-60 ${className}`}>{children}</kbd>
);

export const StreakChip: React.FC<{ streak: number; className?: string }> = ({ streak, className = '' }) => (
  <span className={`inline-flex items-center gap-1 rounded-full bg-flame-50 text-flame-800 dark:bg-orange-900/40 dark:text-orange-200 px-3 py-1.5 font-bold text-sm ${className}`}
    title="زنجیرهٔ روزهای مطالعه">
    <Icon.Flame className="text-flame-500" />{fa(streak)}
  </span>
);

// Daily goal ring.
export const GoalRing: React.FC<{ value: number; target: number; size?: number }> = ({ value, target, size = 96 }) => {
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${fa(value)} از ${fa(target)} مرور`} className="shrink-0">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="10" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="#FFC857" strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${pct * c} ${c}`} transform="rotate(-90 50 50)" style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      <text x="50" y="49" textAnchor="middle" fontWeight="800" fontSize="24" fill="#fff" fontFamily="Vazirmatn">{fa(value)}</text>
      <text x="50" y="68" textAnchor="middle" fontSize="13" fill="rgba(255,255,255,0.85)" fontFamily="Vazirmatn">از {fa(target)}</text>
    </svg>
  );
};

export const STAGE_COLORS = ['bg-slate-300 dark:bg-slate-600', 'bg-emerald-200', 'bg-emerald-400', 'bg-emerald-600', 'bg-emerald-900 dark:bg-emerald-300'];

// Five dots for a word's mastery stage.
export const StageDots: React.FC<{ stage: number }> = ({ stage }) => (
  <span className="inline-flex gap-1" aria-hidden="true">
    {[1, 2, 3, 4, 5].map(i => (
      <span key={i} className={`w-4 h-1.5 rounded-full ${i <= stage + 1 ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700'}`} />
    ))}
  </span>
);
