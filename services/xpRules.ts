import type { PerformanceRating } from '../types';

// XP rewards learning, not collecting: reviews earn XP, adding cards does not.
const REVIEW_XP: Record<PerformanceRating, number> = { AGAIN: 1, HARD: 4, GOOD: 6, EASY: 8 };

// Every 5 correct answers in a row adds one extra point per answer, up to +3.
export const comboBonus = (combo: number): number => Math.min(3, Math.floor(combo / 5));

export const reviewXp = (rating: PerformanceRating, comboBefore: number): number => {
  if (rating === 'AGAIN') return REVIEW_XP.AGAIN;
  return REVIEW_XP[rating] + comboBonus(comboBefore + 1);
};

export const nextCombo = (rating: PerformanceRating, combo: number): number => (rating === 'AGAIN' ? 0 : combo + 1);

export const CHUNK_COMPLETE_XP = 25;
export const CHAPTER_COMPLETE_XP = 50; // on top of the last section's
export const BOOK_COMPLETE_XP = 200; // on top of the last chapter's
// A finished section counts toward the daily goal like this many reviews.
export const SECTION_GOAL_REVIEWS = 5;
// Every third finished section of a text is a chest that holds a streak freeze.
export const isChestSection = (index: number): boolean => (index + 1) % 3 === 0;

export const DEFAULT_DAILY_REVIEW_GOAL = 20;
