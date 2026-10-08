import { Flashcard } from '../types';
import { isNewCard } from './srsService';

// Five growth stages for a word, from the card's FSRS stability (days until
// recall drops to 90%). Cards still on the old SM-2 schedule use their interval.
export type MasteryStage = 0 | 1 | 2 | 3 | 4;

export const STAGE_NAMES: Record<MasteryStage, string> = {
  0: 'دانه',
  1: 'جوانه',
  2: 'نهال',
  3: 'درخت',
  4: 'ریشه‌دار',
};

// Upper bounds (exclusive) in days for stages 1-3; stage 4 is anything longer.
const STAGE_LIMITS = [3, 10, 30];

export const masteryStage = (card: Flashcard): MasteryStage => {
  if (isNewCard(card)) return 0;
  const days = card.stability ?? card.interval;
  if (days < STAGE_LIMITS[0]) return 1;
  if (days < STAGE_LIMITS[1]) return 2;
  if (days < STAGE_LIMITS[2]) return 3;
  return 4;
};

export const stageCounts = (cards: Flashcard[]): Record<MasteryStage, number> => {
  const counts: Record<MasteryStage, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const card of cards) {
    if (!card.isDeleted) counts[masteryStage(card)]++;
  }
  return counts;
};

// Cards whose stage went up between two versions, for the session summary.
export const stageChanges = (before: Flashcard[], after: Flashcard[]) => {
  const old = new Map(before.map(c => [c.id, masteryStage(c)]));
  return after
    .map(card => ({ card, from: old.get(card.id) ?? 0, to: masteryStage(card) }))
    .filter(change => change.to > change.from);
};
