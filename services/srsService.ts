import { Flashcard } from '../types';

export type PerformanceRating = 'AGAIN' | 'GOOD' | 'EASY';

const MIN_EASINESS = 1.3;

// This is an implementation inspired by the SM-2 algorithm.
export function calculateSrs(card: Flashcard, rating: PerformanceRating): Flashcard {
  let { repetition, interval, easinessFactor } = { ...card };

  if (rating === 'AGAIN') {
    repetition = 0;
    interval = 1; // Reset interval to 1 day
    easinessFactor = Math.max(MIN_EASINESS, easinessFactor - 0.2);
  } else {
    repetition += 1;
    
    if (repetition === 1) {
      interval = 1;
    } else if (repetition === 2) {
      interval = 6;
    } else {
      interval = Math.ceil(interval * easinessFactor);
    }

    // Adjust easiness factor based on performance
    if (rating === 'EASY') {
        easinessFactor += 0.15;
    }
    // No change for 'GOOD' by default in this simplified model
  }

  const newDueDate = new Date();
  // Set to midnight to ensure day-based comparison works correctly
  newDueDate.setHours(0, 0, 0, 0);
  newDueDate.setDate(newDueDate.getDate() + interval);

  return {
    ...card,
    repetition,
    interval,
    easinessFactor,
    dueDate: newDueDate.toISOString(),
  };
}
