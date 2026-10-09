// File: /services/wordLevel.ts
// How advanced a word is (CEFR A1 to C2), from how often it is used: the
// same bands that decide which words are hard for a level when picking them
// without AI (services/freeCandidates).

import type { CefrLevel } from '../types';

export const CEFR: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// Occurrences per million words at which a word stops being of that level.
const BANDS: [number, CefrLevel][] = [[150, 'A1'], [80, 'A2'], [40, 'B1'], [15, 'B2'], [6, 'C1']];

export const levelOfFrequency = (frequency?: number | null): CefrLevel | undefined =>
  typeof frequency === 'number' && Number.isFinite(frequency) && frequency > 0
    ? BANDS.find(([min]) => frequency >= min)?.[1] ?? 'C2'
    : undefined;

// The learner's level as a CEFR step; exam targets count as B2 and C1.
export const learnerStep = (userLevel?: string): CefrLevel =>
  userLevel === 'IELTS' ? 'B2' : userLevel === 'TOEFL' ? 'C1' : (CEFR as string[]).includes(userLevel || '') ? (userLevel as CefrLevel) : 'B2';

// A word above the learner's level is a word worth a card.
export const isAboveLevel = (level: CefrLevel | undefined, userLevel?: string): boolean =>
  !!level && CEFR.indexOf(level) > CEFR.indexOf(learnerStep(userLevel));

// A word below the learner's level is one they very likely know already.
export const isBelowLevel = (level: CefrLevel | undefined, userLevel?: string): boolean =>
  !!level && CEFR.indexOf(level) < CEFR.indexOf(learnerStep(userLevel));
