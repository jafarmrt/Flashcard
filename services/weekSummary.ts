// File: /services/weekSummary.ts
// The last seven days in a few numbers, next to the seven before: minutes
// read, sections, words read, reviews, new cards, words added to «بلدم»,
// and how many reviews were remembered. One line of advice comes from the
// numbers themselves, never a reward or a streak.

import type { Flashcard, KnownWord, Source, StudyLog } from '../types';
import { dayString } from './calendar.js';
import { lastDays, minutes, readingByDay } from './readingTime.js';
import { retention } from './memoryStats.js';

export interface WeekSummary {
  minutes: number;
  previousMinutes: number;
  sections: number;
  words: number;
  reviews: number;
  newCards: number;
  knownAdded: number;
  remembered: number | null; // percent of reviews of learned cards
  advice: string;
}

export const weekSummary = (
  input: { sources: Source[]; cards: Flashcard[]; logs: StudyLog[]; knownWords: KnownWord[] },
  now: Date = new Date(),
): WeekSummary => {
  const fourteen = lastDays(14, now);
  const thisWeek = new Set(fourteen.slice(7));
  const lastWeek = new Set(fourteen.slice(0, 7));
  const days = readingByDay(input.sources.filter(s => !s.isDeleted));
  let ms = 0, previousMs = 0, sections = 0, words = 0;
  for (const [day, r] of days) {
    if (thisWeek.has(day)) { ms += r.ms; sections += r.sections; words += r.words; }
    else if (lastWeek.has(day)) previousMs += r.ms;
  }
  const localDay = (iso: string) => dayString(new Date(iso));
  const newCards = input.cards.filter(c => !c.isDeleted && c.createdAt && thisWeek.has(localDay(c.createdAt))).length;
  const knownAdded = input.knownWords.filter(k => !k.isDeleted && k.createdAt && thisWeek.has(localDay(k.createdAt))).length;
  const reviews = input.logs.filter(l => thisWeek.has(l.date)).length;
  const remembered = retention(input.logs, dayString(now), 7).percent;
  const mins = minutes(ms);
  const previousMinutes = minutes(previousMs);

  // The one thing the week's numbers point at.
  let advice = '';
  if (mins === 0 && reviews === 0) advice = 'این هفته هنوز چیزی نخواندی؛ یک بخش کوتاه از کتابت شروع خوبی است.';
  else if (remembered !== null && remembered < 80 && newCards > 30) advice = 'کارت تازه زیاد ساختی و کمتر از ۸۰٪ مرورها به یاد ماند؛ سقف «کارت تازه در روز» را کم کن یا فقط واژه‌های مهم را کارت کن.';
  else if (remembered !== null && remembered < 80) advice = 'کمتر از ۸۰٪ مرورها به یاد ماند؛ مرورها را سر وقت انجام بده و با «فارسی به انگلیسی» یا «جای خالی» تمرین کن.';
  else if (mins === 0) advice = 'این هفته فقط مرور کردی؛ خواندن، واژه‌ها را در جملهٔ تازه نشانت می‌دهد.';
  else if (previousMinutes > 0 && mins >= previousMinutes * 1.2) advice = 'از هفتهٔ پیش بیشتر خواندی.';
  else if (previousMinutes > 0 && mins < previousMinutes * 0.6) advice = 'این هفته کمتر از هفتهٔ پیش خواندی؛ روزی ده دقیقه هم کافی است.';
  return { minutes: mins, previousMinutes, sections, words, reviews, newCards, knownAdded, remembered, advice };
};
