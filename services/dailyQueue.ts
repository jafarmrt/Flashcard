// File: /services/dailyQueue.ts
// Today's review: the cards due, with both a daily cap on new cards and a
// mandatory per-session batch cap so no review ever dumps an unbounded pile
// of words on the learner. Cards already being learned come first (most fragile
// / overdue first), then new cards up to the day's allowance and batch limit.

import type { Flashcard, StudyLog } from '../types';
import { isDue, isNewCard } from './srsService';

export const DEFAULT_NEW_PER_DAY = 15;
export const REVIEW_BATCH_OPTIONS = [10, 15, 20, 30] as const;
export const DEFAULT_REVIEW_BATCH = 20;
export const MIN_REVIEW_BATCH = 5;
export const MAX_REVIEW_BATCH = 50;

export const clampReviewBatch = (n?: number): number => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return DEFAULT_REVIEW_BATCH;
  return Math.max(MIN_REVIEW_BATCH, Math.min(MAX_REVIEW_BATCH, Math.round(n)));
};

// Cards whose first review ever was today: the new cards already started.
export const newCardsStartedToday = (logs: StudyLog[], today: string): number => {
  const first = new Map<string, string>();
  for (const log of logs) {
    const seen = first.get(log.cardId);
    if (!seen || log.date < seen) first.set(log.cardId, log.date);
  }
  let n = 0;
  for (const date of first.values()) if (date === today) n++;
  return n;
};

export interface DailyQueue {
  cards: Flashcard[]; // bounded session queue in the order to ask them
  reviews: number; // review cards included in this session batch
  fresh: number; // new cards included in this session batch
  heldBack: number; // new cards left for the next days by newPerDay
  totalDue: number; // all due reviews + allowed new cards today before batch cap
  remainingDue: number; // due cards waiting for a later batch after this one
}

const stabilityRank = (c: Flashcard): number =>
  typeof c.stability === 'number' ? c.stability : Math.max(0, c.interval || 0);

const shuffleInPlace = <T,>(arr: T[], random: () => number): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// newPerDay 0 (or less) means no daily new-card cap; batchLimit bounds how many
// words enter a single review sitting (default 20).
export const dailyQueue = (
  cards: Flashcard[],
  logs: StudyLog[],
  today: string,
  newPerDay: number = DEFAULT_NEW_PER_DAY,
  now: Date = new Date(),
  random: () => number = Math.random,
  batchLimit: number = DEFAULT_REVIEW_BATCH,
): DailyQueue => {
  const cap = clampReviewBatch(batchLimit);
  const due = cards.filter(c => !c.isDeleted && isDue(c, now));
  const allReviews = due
    .filter(c => !isNewCard(c))
    .sort((a, b) => {
      const sDiff = stabilityRank(a) - stabilityRank(b);
      if (sDiff !== 0) return sDiff;
      return (a.dueDate || '').localeCompare(b.dueDate || '');
    });
  const allNew = due
    .filter(isNewCard)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

  const allowance =
    newPerDay > 0 ? Math.max(0, newPerDay - newCardsStartedToday(logs, today)) : allNew.length;
  const allowedNew = allNew.slice(0, allowance);
  const totalDue = allReviews.length + allowedNew.length;

  const reviews = shuffleInPlace(allReviews.slice(0, cap), random);
  const remainingSlots = Math.max(0, cap - reviews.length);
  const fresh = allowedNew.slice(0, remainingSlots);
  const sessionCards = [...reviews, ...fresh];

  return {
    cards: sessionCards,
    reviews: reviews.length,
    fresh: fresh.length,
    heldBack: allNew.length - allowedNew.length,
    totalDue,
    remainingDue: Math.max(0, totalDue - sessionCards.length),
  };
};

// Bounds any custom, deck, theme, or book review session to a concrete word
// count, prioritizing due and fragile cards first so every review obeys a rule.
export const capStudyBatch = (
  cards: Flashcard[],
  limit?: number,
  now: Date = new Date(),
  random: () => number = Math.random,
): Flashcard[] => {
  const cap = clampReviewBatch(limit);
  const live = cards.filter(c => !c.isDeleted);
  if (live.length <= cap) return shuffleInPlace([...live], random);

  const prioritized = [...live].sort((a, b) => {
    const aDue = isDue(a, now) ? 0 : 1;
    const bDue = isDue(b, now) ? 0 : 1;
    if (aDue !== bDue) return aDue - bDue;
    const aNew = isNewCard(a) ? 1 : 0;
    const bNew = isNewCard(b) ? 1 : 0;
    if (aNew !== bNew) return aNew - bNew;
    return stabilityRank(a) - stabilityRank(b);
  });
  return shuffleInPlace(prioritized.slice(0, cap), random);
};

// Where a card comes back in the session: "Again", or a new card's first
// right answer that is asked once more, returns after ten other cards, or
// at the end when fewer are left. (It came back after four, which with a
// short queue was almost at once, so the answer was still in mind.)
export const COME_BACK_AFTER = 10;
export const comeBackAt = (index: number, queueLength: number): number =>
  Math.min(index + 1 + COME_BACK_AFTER, queueLength);
