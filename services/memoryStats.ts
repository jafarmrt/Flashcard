// File: /services/memoryStats.ts
// Numbers that say how learning goes, measured rather than guessed:
//   - retention: of the reviews of cards already learned, how many were
//     remembered (the FSRS schedule aims at 90%; far below means too many
//     new cards or too hard ones, far above means time is spent on what is
//     known);
//   - the next seven days' reviews, so a heavy week is seen coming;
//   - the words you know: grown cards and the «بلدم» list.

import type { Flashcard, KnownWord, StudyLog } from '../types';
import { addDays, dayString } from './calendar.js';
import { endOfLocalDay } from './srsService.js';
import { masteryStage } from './masteryService.js';
import { GROWN_STAGE } from './coverage.js';

export interface Retention { reviews: number; remembered: number; percent: number | null }

// The first answer of each card on each day in the last `days` days, not
// counting a card's very first answer (a new card is not remembered yet).
export const retention = (logs: StudyLog[], today: string, days = 30): Retention => {
  const from = addDays(today, -(days - 1));
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date) || (a.id || 0) - (b.id || 0));
  const seen = new Set<string>();
  const firstOfDay = new Set<string>();
  let reviews = 0;
  let remembered = 0;
  for (const log of sorted) {
    const isFirstEver = !seen.has(log.cardId);
    seen.add(log.cardId);
    const dayKey = `${log.cardId}|${log.date}`;
    if (firstOfDay.has(dayKey)) continue;
    firstOfDay.add(dayKey);
    if (isFirstEver || log.date < from || log.date > today) continue;
    reviews++;
    if (log.rating !== 'AGAIN') remembered++;
  }
  return { reviews, remembered, percent: reviews ? Math.round((remembered / reviews) * 100) : null };
};

// Cards that come due on each of the next `days` days; today holds every
// card already due.
export const dueForecast = (cards: Flashcard[], now: Date = new Date(), days = 7): { day: string; count: number }[] => {
  const today = dayString(now);
  const out = Array.from({ length: days }, (_, i) => ({ day: addDays(today, i), count: 0 }));
  const lastEnd = endOfLocalDay(new Date(now.getTime() + (days - 1) * 86_400_000)).getTime();
  for (const c of cards) {
    if (c.isDeleted) continue;
    const due = new Date(c.dueDate).getTime();
    if (!(due <= lastEnd)) continue;
    const day = due <= endOfLocalDay(now).getTime() ? today : dayString(new Date(due));
    const slot = out.find(d => d.day === day);
    if (slot) slot.count++;
  }
  return out;
};

export interface Vocabulary { known: number; fromCards: number; fromList: number; learning: number }

export const vocabulary = (cards: Flashcard[], knownRows: KnownWord[]): Vocabulary => {
  const grown = new Set<string>();
  let learning = 0;
  for (const c of cards) {
    if (c.isDeleted || c.kind === 'grammar') continue;
    const stage = masteryStage(c);
    if (stage >= GROWN_STAGE) grown.add(c.front.trim().toLowerCase());
    else if (stage > 0) learning++;
  }
  const list = new Set(knownRows.filter(k => !k.isDeleted).map(k => k.term.trim().toLowerCase()).filter(t => t && !grown.has(t)));
  return { known: grown.size + list.size, fromCards: grown.size, fromList: list.size, learning };
};
