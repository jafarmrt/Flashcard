import { Flashcard, PerformanceRating } from '../types';

export type { PerformanceRating };

// FSRS-5 (Free Spaced Repetition Scheduler) with its published default weights.
// https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];
const DECAY = -0.5;
const FACTOR = 19 / 81; // makes retrievability 0.9 when elapsed days equal stability
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_INTERVAL_DAYS = 36500;

// The share of cards you should still remember when they come due.
export const DESIRED_RETENTION = 0.9;

const GRADE: Record<PerformanceRating, 1 | 2 | 3 | 4> = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const retrievability = (elapsedDays: number, stability: number) =>
  Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);

const initialStability = (g: number) => W[g - 1];
const initialDifficulty = (g: number) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);

function nextDifficulty(d: number, g: number): number {
  const delta = -W[6] * (g - 3);
  const damped = d + (delta * (10 - d)) / 9;
  return clamp(W[7] * initialDifficulty(4) + (1 - W[7]) * damped, 1, 10);
}

function recallStability(d: number, s: number, r: number, g: number): number {
  const hardPenalty = g === 2 ? W[15] : 1;
  const easyBonus = g === 4 ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hardPenalty * easyBonus);
}

function forgetStability(d: number, s: number, r: number): number {
  const next = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
  return Math.min(next, s);
}

// A second review on the same day (e.g. after "Again" in one session).
const sameDayStability = (s: number, g: number) => s * Math.exp(W[17] * (g - 3 + W[18]));

export function intervalForStability(stability: number, retention = DESIRED_RETENTION): number {
  const days = (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(Math.round(days), 1, MAX_INTERVAL_DAYS);
}

export const isNewCard = (card: Flashcard) => card.stability === undefined && card.repetition === 0 && card.interval === 0;

// Due today: everything scheduled up to the end of the local day. Every screen
// uses this, so the number on the Today screen is the number the review shows
// (a card added this afternoon is due today, not tomorrow).
export const endOfLocalDay = (now: Date = new Date()): Date => {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
};
export const isDue = (card: Flashcard, now: Date = new Date()): boolean =>
  new Date(card.dueDate).getTime() <= endOfLocalDay(now).getTime();

// FSRS state for a card; cards scheduled by the old SM-2 code are converted
// from their interval and easiness factor.
export function memoryState(card: Flashcard): { stability: number; difficulty: number; lastReviewed: number } | null {
  if (card.stability !== undefined && card.difficulty !== undefined) {
    const lastReviewed = card.lastReviewed ? Date.parse(card.lastReviewed) : Date.parse(card.dueDate) - card.interval * DAY_MS;
    return { stability: card.stability, difficulty: card.difficulty, lastReviewed };
  }
  if (isNewCard(card)) return null;
  const interval = Math.max(card.interval, 1);
  // Easiness 1.3 (hardest in SM-2) maps to difficulty 10; 3.0 and above to 1.
  const difficulty = clamp(10 - ((card.easinessFactor - 1.3) / 1.7) * 9, 1, 10);
  return { stability: interval, difficulty, lastReviewed: Date.parse(card.dueDate) - interval * DAY_MS };
}

function startOfDay(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function calculateSrs(card: Flashcard, rating: PerformanceRating, now: Date = new Date()): Flashcard {
  const g = GRADE[rating];
  const nowMs = now.getTime();
  const state = memoryState(card);

  let stability: number;
  let difficulty: number;
  if (!state) {
    stability = initialStability(g);
    difficulty = initialDifficulty(g);
  } else {
    const elapsedDays = Math.max(0, (nowMs - state.lastReviewed) / DAY_MS);
    difficulty = nextDifficulty(state.difficulty, g);
    if (elapsedDays < 1) {
      stability = sameDayStability(state.stability, g);
    } else {
      const r = retrievability(elapsedDays, state.stability);
      stability = g === 1 ? forgetStability(state.difficulty, state.stability, r) : recallStability(state.difficulty, state.stability, r, g);
    }
  }
  stability = clamp(stability, 0.1, MAX_INTERVAL_DAYS);

  const interval = intervalForStability(stability);
  const dueDate = startOfDay(nowMs);
  dueDate.setDate(dueDate.getDate() + interval);

  return {
    ...card,
    stability,
    difficulty,
    lastReviewed: now.toISOString(),
    lapses: (card.lapses || 0) + (g === 1 && state ? 1 : 0),
    // Kept for the study filters: repetition 0 means "forgotten or new", interval > 0 means "seen".
    repetition: g === 1 ? 0 : card.repetition + 1,
    interval,
    dueDate: dueDate.toISOString(),
  };
}

// Days until the card would come due for each answer, for the button labels.
export function previewIntervals(card: Flashcard, now: Date = new Date()): Record<PerformanceRating, number> {
  const ratings: PerformanceRating[] = ['AGAIN', 'HARD', 'GOOD', 'EASY'];
  return Object.fromEntries(ratings.map(r => [r, calculateSrs(card, r, now).interval])) as Record<PerformanceRating, number>;
}

export function formatInterval(days: number): string {
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
}
