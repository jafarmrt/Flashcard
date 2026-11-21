// File: /services/dailyQueue.ts
// Today's review: the cards due, with a cap on how many new cards start each
// day. Without a cap, forty words saved from one chapter meant forty extra
// reviews today and a heap of them three days later, which is how a review
// habit breaks. Cards already being learned come first; new cards fill in
// after them, the oldest first, up to the day's allowance.

import type { Flashcard, StudyLog } from '../types';
import { isDue, isNewCard } from './srsService';

export const DEFAULT_NEW_PER_DAY = 15;

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
  cards: Flashcard[]; // in the order to ask them
  reviews: number; // cards being learned that are due
  fresh: number; // new cards taken today
  heldBack: number; // new cards left for the next days
}

// newPerDay 0 (or less) means no cap.
export const dailyQueue = (
  cards: Flashcard[],
  logs: StudyLog[],
  today: string,
  newPerDay: number = DEFAULT_NEW_PER_DAY,
  now: Date = new Date(),
  random: () => number = Math.random,
): DailyQueue => {
  const due = cards.filter(c => !c.isDeleted && isDue(c, now));
  const reviews = due.filter(c => !isNewCard(c));
  const allNew = due.filter(isNewCard).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const allowance = newPerDay > 0 ? Math.max(0, newPerDay - newCardsStartedToday(logs, today)) : allNew.length;
  const fresh = allNew.slice(0, allowance);
  // Reviews in a random order, so a card is not remembered by its place.
  for (let i = reviews.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [reviews[i], reviews[j]] = [reviews[j], reviews[i]];
  }
  return { cards: [...reviews, ...fresh], reviews: reviews.length, fresh: fresh.length, heldBack: allNew.length - fresh.length };
};

// Where a card comes back in the session: "Again", or a new card's first
// right answer that is asked once more, returns after ten other cards, or
// at the end when fewer are left. (It came back after four, which with a
// short queue was almost at once, so the answer was still in mind.)
export const COME_BACK_AFTER = 10;
export const comeBackAt = (index: number, queueLength: number): number => Math.min(index + 1 + COME_BACK_AFTER, queueLength);
