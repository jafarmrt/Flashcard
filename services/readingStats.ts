// File: /services/readingStats.ts
// Reviews and progress by book: the cards of one book or chapter to review,
// how each book's words grew week by week, and the words answered "again"
// most often.

import type { Chapter, Flashcard, Occurrence, Source, StudyLog } from '../types';
import { isBookFinished, isChapterFinished } from './library.js';
import { masteryStage } from './masteryService.js';
import { isDue } from './srsService.js';
import { dayString } from './calendar.js';

// A word has been learned once its card reaches the "tree" stage (it stays
// in memory for 10 days or more).
export const LEARNED_STAGE = 3;
export const isLearned = (card: Flashcard): boolean => masteryStage(card) >= LEARNED_STAGE;

// The live cards met in a source (or one of its chapters).
export const cardsOfSource = (occurrences: Occurrence[], cards: Flashcard[], sourceId: string, chapterId?: string): Flashcard[] => {
  const ids = new Set<string>();
  for (const o of occurrences) {
    if (o.isDeleted || o.sourceId !== sourceId || (chapterId && o.chapterId !== chapterId)) continue;
    ids.add(o.cardId);
  }
  return cards.filter(c => !c.isDeleted && ids.has(c.id));
};

export const BOOK_REVIEW_SIZE = 20;

// What to review from a book: the cards due today; when none is due, the
// weakest ones (lowest stage, then least stable, then most forgotten).
export const pickBookReview = (cards: Flashcard[], now: Date = new Date(), size = BOOK_REVIEW_SIZE): { cards: Flashcard[]; due: boolean } => {
  const due = cards.filter(c => isDue(c, now));
  if (due.length > 0) return { cards: due, due: true };
  const weakest = [...cards].sort((a, b) =>
    masteryStage(a) - masteryStage(b)
    || (a.stability ?? a.interval) - (b.stability ?? b.interval)
    || (b.lapses || 0) - (a.lapses || 0));
  return { cards: weakest.slice(0, size), due: false };
};

// --- Words learned over time, per book ---

export interface BookGrowth {
  sourceId: string;
  title: string;
  points: number[]; // cards from this book by the end of each week, oldest first
  total: number;
  learned: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const bookGrowth = (occurrences: Occurrence[], cards: Flashcard[], sources: Source[], weeks = 12, now: Date = new Date(), max = 5): BookGrowth[] => {
  const live = new Map(cards.filter(c => !c.isDeleted).map(c => [c.id, c]));
  // When each card was first met in each source.
  const firstMet = new Map<string, Map<string, number>>();
  for (const o of occurrences) {
    if (o.isDeleted || !live.has(o.cardId)) continue;
    const at = Date.parse(o.createdAt);
    if (!Number.isFinite(at)) continue;
    let bySource = firstMet.get(o.sourceId);
    if (!bySource) firstMet.set(o.sourceId, (bySource = new Map()));
    const before = bySource.get(o.cardId);
    if (before === undefined || at < before) bySource.set(o.cardId, at);
  }
  const end = now.getTime();
  const out: BookGrowth[] = [];
  for (const source of sources) {
    if (source.isDeleted) continue;
    const met = firstMet.get(source.id);
    if (!met || met.size === 0) continue;
    const times = [...met.values()];
    const points = Array.from({ length: weeks }, (_, i) => {
      const weekEnd = end - (weeks - 1 - i) * WEEK_MS;
      return times.filter(t => t <= weekEnd).length;
    });
    const learned = [...met.keys()].filter(id => isLearned(live.get(id)!)).length;
    out.push({ sourceId: source.id, title: source.title, points, total: met.size, learned });
  }
  return out.sort((a, b) => b.total - a.total).slice(0, max);
};

// --- The hardest words ---

export interface HardWord {
  card: Flashcard;
  again: number; // times answered "again"
  reviews: number;
}

export const hardestWords = (logs: StudyLog[], cards: Flashcard[], size = 10): HardWord[] => {
  const live = new Map(cards.filter(c => !c.isDeleted).map(c => [c.id, c]));
  const again = new Map<string, number>();
  const reviews = new Map<string, number>();
  for (const log of logs) {
    if (!live.has(log.cardId)) continue;
    reviews.set(log.cardId, (reviews.get(log.cardId) || 0) + 1);
    if (log.rating === 'AGAIN') again.set(log.cardId, (again.get(log.cardId) || 0) + 1);
  }
  return [...again.entries()]
    .map(([id, n]) => ({ card: live.get(id)!, again: n, reviews: reviews.get(id) || n }))
    .sort((a, b) => b.again - a.again || b.again / b.reviews - a.again / a.reviews || a.card.front.localeCompare(b.card.front))
    .slice(0, size);
};

// Reviews per day for the last `days` days, oldest first.
export const reviewsPerDay = (logs: StudyLog[], days = 30, now: Date = new Date()): { day: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const log of logs) counts.set(log.date, (counts.get(log.date) || 0) + 1);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    const day = dayString(d);
    return { day, count: counts.get(day) || 0 };
  });
};

// --- Reading progress (calm mode's measure of progress) ---

export interface ReadingSummary {
  minutes: number;
  words: number; // words of the sections finished
  booksFinished: number;
  chaptersFinished: number;
  wordsMet: number; // cards met again in the books read
}

export const readingSummary = (sources: Source[], chapters: Chapter[], occurrences: Occurrence[]): ReadingSummary => {
  const live = sources.filter(s => !s.isDeleted);
  const liveIds = new Set(live.map(s => s.id));
  const liveChapters = chapters.filter(c => !c.isDeleted && liveIds.has(c.sourceId));
  let ms = 0;
  let words = 0;
  for (const s of live) for (const r of Object.values(s.reading || {})) { ms += r.ms; words += r.words; }
  return {
    minutes: Math.round(ms / 60_000),
    words,
    booksFinished: live.filter(s => isBookFinished(s, liveChapters)).length,
    chaptersFinished: liveChapters.filter(isChapterFinished).length,
    wordsMet: new Set(occurrences.filter(o => !o.isDeleted && liveIds.has(o.sourceId)).map(o => o.cardId)).size,
  };
};

// A year of reading as weeks of days (Saturday first, the Persian week),
// oldest week first; each day with its minutes, or null after today.
export const yearGrid = (minutesByDay: Map<string, number>, now: Date = new Date(), weeks = 53): ({ day: string; minutes: number } | null)[][] => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sinceSaturday = (today.getDay() + 1) % 7;
  const start = new Date(today);
  start.setDate(today.getDate() - sinceSaturday - (weeks - 1) * 7);
  const out: ({ day: string; minutes: number } | null)[][] = [];
  for (let w = 0; w < weeks; w++) {
    const week: ({ day: string; minutes: number } | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      const day = dayString(date);
      week.push(date > today ? null : { day, minutes: minutesByDay.get(day) || 0 });
    }
    out.push(week);
  }
  return out;
};
