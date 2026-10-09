// Streak days, streak freezes and the weekly strip. Dates are YYYY-MM-DD on
// the device's own calendar, the same format StudyLog.date uses: a review at
// 01:00 in Tehran counts for that day, not for the previous UTC day.

export const MAX_HELD_FREEZES = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

export const dayString = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// Calendar arithmetic on YYYY-MM-DD strings (time zones play no part).
export const addDays = (day: string, delta: number): string =>
  new Date(Date.parse(`${day}T12:00:00Z`) + delta * DAY_MS).toISOString().split('T')[0];

export const availableFreezes = (earned = 0, frozenDates: string[] = []): number =>
  Math.max(0, earned - frozenDates.length);

// Consecutive active days ending today or yesterday. Days covered by a freeze
// keep the streak alive but do not add to it.
export const computeStreak = (studied: Set<string>, frozen: Set<string>, today: string): number => {
  const active = (d: string) => studied.has(d) || frozen.has(d);
  let day = active(today) ? today : addDays(today, -1);
  if (!active(day)) return 0;
  let streak = 0;
  while (active(day)) {
    if (studied.has(day)) streak++;
    day = addDays(day, -1);
  }
  return streak;
};

// Missed days (before today) that freezes can cover so the streak survives.
// Returns [] when nothing is missed, when there is no streak to save, or when
// there are not enough freezes for the whole gap.
export const daysToFreeze = (studied: Set<string>, frozen: Set<string>, available: number, today: string): string[] => {
  const active = (d: string) => studied.has(d) || frozen.has(d);
  const yesterday = addDays(today, -1);
  if (active(yesterday) || available <= 0) return [];
  const gap: string[] = [];
  let day = yesterday;
  while (!active(day) && gap.length <= available) {
    gap.push(day);
    day = addDays(day, -1);
  }
  if (gap.length > available || !studied.has(day) && !frozen.has(day)) return [];
  if (computeStreak(studied, frozen, addDays(day, 1)) === 0) return [];
  return gap.reverse();
};

export type DayStatus = 'studied' | 'frozen' | 'missed' | 'today' | 'future';

// The current week, Saturday to Friday (the Iranian week).
export const weekStrip = (studied: Set<string>, frozen: Set<string>, today: string): { day: string; status: DayStatus }[] => {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const saturday = addDays(today, -((weekday + 1) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(saturday, i);
    let status: DayStatus;
    if (studied.has(day)) status = 'studied';
    else if (frozen.has(day)) status = 'frozen';
    else if (day === today) status = 'today';
    else status = day > today ? 'future' : 'missed';
    return { day, status };
  });
};

// Reviews in the 7 days ending today and in the 7 days before that.
export const weeklyReviewCounts = (logDates: string[], today: string): { thisWeek: number; lastWeek: number } => {
  const start = addDays(today, -6);
  const prevStart = addDays(today, -13);
  let thisWeek = 0;
  let lastWeek = 0;
  for (const d of logDates) {
    if (d >= start && d <= today) thisWeek++;
    else if (d >= prevStart && d < start) lastWeek++;
  }
  return { thisWeek, lastWeek };
};
