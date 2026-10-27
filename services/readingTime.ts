// File: /services/readingTime.ts
// Time spent reading, per book and per day: kept on the book (Source.reading)
// so it syncs with it. Only active time counts: the page in view and the
// reader doing something (turning a page, tapping a word) in the last
// minute and a half; a book left open on the table does not add minutes.

import type { ReadingDay, Source } from '../types';

export const IDLE_MS = 90_000;
// A learner's pace before there is enough of their own reading to measure.
export const DEFAULT_WPM = 120;
const MIN_MEASURED_MS = 3 * 60_000;
// A section is at most ~300 words: more than this is a forgotten tab.
const MAX_SECTION_MS = 45 * 60_000;

export const emptyDay = (): ReadingDay => ({ ms: 0, words: 0, sections: 0 });

// Reading time on the book's log, with the words and sections finished in it.
export const addReading = (source: Source, day: string, ms: number, words: number, sections = 1, now: Date = new Date()): Source => {
  const log = { ...(source.reading || {}) };
  const before = log[day] || emptyDay();
  log[day] = {
    ms: before.ms + Math.max(0, Math.min(ms, MAX_SECTION_MS)),
    words: before.words + Math.max(0, words),
    sections: before.sections + sections,
  };
  return { ...source, reading: log, updatedAt: now.toISOString() };
};

// Two devices' logs of the same book: each day keeps the larger record, so
// a sync never loses the minutes read on either.
export const mergeReading = (a?: Record<string, ReadingDay>, b?: Record<string, ReadingDay>): Record<string, ReadingDay> | undefined => {
  if (!a) return b;
  if (!b) return a;
  const out: Record<string, ReadingDay> = { ...a };
  for (const [day, r] of Object.entries(b)) {
    const have = out[day];
    out[day] = have ? { ms: Math.max(have.ms, r.ms), words: Math.max(have.words, r.words), sections: Math.max(have.sections, r.sections) } : r;
  }
  return out;
};

export const totalOf = (log?: Record<string, ReadingDay>): ReadingDay =>
  Object.values(log || {}).reduce((t, r) => ({ ms: t.ms + r.ms, words: t.words + r.words, sections: t.sections + r.sections }), emptyDay());

// Every book's days added up.
export const readingByDay = (sources: Pick<Source, 'reading' | 'isDeleted'>[]): Map<string, ReadingDay> => {
  const days = new Map<string, ReadingDay>();
  for (const s of sources) {
    for (const [day, r] of Object.entries(s.reading || {})) {
      const t = days.get(day) || emptyDay();
      days.set(day, { ms: t.ms + r.ms, words: t.words + r.words, sections: t.sections + r.sections });
    }
  }
  return days;
};

// The reader's pace in words a minute, once there is enough to measure.
export const wordsPerMinute = (total: ReadingDay): number | null =>
  total.ms >= MIN_MEASURED_MS && total.words > 0 ? Math.round(total.words / (total.ms / 60_000)) : null;

export const minutesFor = (words: number, wpm: number | null): number => Math.max(1, Math.round(words / (wpm || DEFAULT_WPM)));

export const minutes = (ms: number): number => Math.round(ms / 60_000);

// The last `count` days, oldest first, as YYYY-MM-DD on the local calendar.
export const lastDays = (count: number, now: Date = new Date()): string[] => {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
};

// Counts active reading time: `touch` on every action of the reader, `take`
// when a section ends. A tick every few seconds adds the time since the last
// tick while the page is in view and the reader was active lately.
export class ActiveClock {
  private ms = 0;
  private lastTick: number;
  private lastTouch: number;
  constructor(now: number) { this.lastTick = now; this.lastTouch = now; }
  touch(now: number) { this.tick(now, true); this.lastTouch = now; }
  tick(now: number, visible: boolean) {
    const step = Math.max(0, now - this.lastTick);
    if (visible && now - this.lastTouch <= IDLE_MS) this.ms += Math.min(step, IDLE_MS);
    this.lastTick = now;
  }
  take(now: number, visible = true): number {
    this.tick(now, visible);
    const ms = this.ms;
    this.ms = 0;
    return ms;
  }
}
