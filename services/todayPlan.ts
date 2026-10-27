// File: /services/todayPlan.ts
// One short plan for the day on the Today screen: read the next section of
// the book, review the cards that are due, practise the pronunciation items
// that are due. Reading comes first: the app is there to make reading a book
// easier, and the cards and the speaking grow out of what was read.

export type PlanStepId = 'read' | 'review' | 'speak';

export interface PlanStep {
  id: PlanStepId;
  minutes: number; // a rough estimate, to make starting easy
  count: number; // sections, cards or sentences
  done: boolean;
}

export interface PlanInput {
  hasBook: boolean; // a book or article not finished yet
  readToday: boolean; // a section was finished today
  dueCards: number;
  reviewedToday: number;
  dueSpeech: number;
  speechToday: number;
}

// About 300 words a section at a learner's pace, with a few look-ups.
export const SECTION_MINUTES = 6;
// A card takes about 8 seconds; a sentence spoken, heard and checked about a minute.
const CARD_SECONDS = 8;
const SPEECH_MINUTES = 1;
// More than this many sentences is tiring: a session asks this many.
export const SPEECH_SESSION = 6;

export const todayPlan = (input: PlanInput): PlanStep[] => {
  const steps: PlanStep[] = [];
  if (input.hasBook || input.readToday) {
    steps.push({ id: 'read', minutes: input.readToday ? 0 : SECTION_MINUTES, count: 1, done: input.readToday });
  }
  if (input.dueCards > 0 || input.reviewedToday > 0) {
    steps.push({
      id: 'review',
      minutes: Math.max(1, Math.ceil((input.dueCards * CARD_SECONDS) / 60)),
      count: input.dueCards,
      done: input.dueCards === 0,
    });
  }
  if (input.dueSpeech > 0 || input.speechToday > 0) {
    const count = Math.min(input.dueSpeech, SPEECH_SESSION);
    steps.push({ id: 'speak', minutes: count * SPEECH_MINUTES, count, done: input.dueSpeech === 0 });
  }
  return steps;
};

// Minutes left for the steps not done yet.
export const minutesLeft = (steps: PlanStep[]): number =>
  steps.filter(s => !s.done).reduce((sum, s) => sum + s.minutes, 0);
