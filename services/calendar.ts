// Calendar days and the weekly strip. Dates are YYYY-MM-DD on the device's
// own calendar, the same format StudyLog.date uses: a review at 01:00 in
// Tehran counts for that day, not for the previous UTC day.

const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

export const dayString = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// Calendar arithmetic on YYYY-MM-DD strings (time zones play no part).
export const addDays = (day: string, delta: number): string =>
  new Date(Date.parse(`${day}T12:00:00Z`) + delta * DAY_MS).toISOString().split('T')[0];

export type DayStatus = 'active' | 'missed' | 'today' | 'future';

// The current week, Saturday to Friday (the Iranian week); `active`: days
// with reading or reviews.
export const weekStrip = (active: Set<string>, today: string): { day: string; status: DayStatus }[] => {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const saturday = addDays(today, -((weekday + 1) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(saturday, i);
    const status: DayStatus = active.has(day) ? 'active' : day === today ? 'today' : day > today ? 'future' : 'missed';
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
