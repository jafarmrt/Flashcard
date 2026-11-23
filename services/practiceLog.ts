// File: /services/practiceLog.ts
// What the quiz and listening practice leave behind (table `practice`): one
// row per first answer. From it, the words that keep going wrong and the
// words they are taken for, so they can be seen and practised again; an
// answer used to vanish with its session.

import type { Flashcard, PracticeAnswer } from '../types';
import { dayString } from './calendar.js';

export const newPracticeAnswer = (
  input: Pick<PracticeAnswer, 'cardId' | 'kind' | 'right'> & Partial<Pick<PracticeAnswer, 'chose' | 'score'>>,
  now: Date = new Date(),
  id: string = crypto.randomUUID(),
): PracticeAnswer => {
  const at = now.toISOString();
  return {
    id, cardId: input.cardId, kind: input.kind, right: input.right,
    ...(input.chose && !input.right ? { chose: input.chose } : {}),
    ...(typeof input.score === 'number' ? { score: Math.round(input.score) } : {}),
    day: dayString(now), createdAt: at, updatedAt: at,
  };
};

export interface MistakenWord {
  card: Flashcard;
  wrong: number; // wrong first answers in the window
  total: number;
  lastWrong: string; // day
  takenFor: string[]; // the words picked instead, the most frequent first
}

export interface Confusion { card: Flashcard; chose: string; choseBack?: string; count: number }

export interface MistakeSummary {
  words: MistakenWord[];
  confusions: Confusion[];
  answers: number; // first answers in the window
  right: number;
}

// A word leaves the list once it was answered right twice in a row after its
// last wrong answer: it is known again, and a list that only grows is not
// looked at.
const RIGHT_TO_CLEAR = 2;
const WINDOW_DAYS = 90;

export const mistakeSummary = (answers: PracticeAnswer[], cards: Flashcard[], today: string = dayString(new Date()), windowDays = WINDOW_DAYS): MistakeSummary => {
  const live = new Map(cards.filter(c => !c.isDeleted).map(c => [c.id, c]));
  const byFront = new Map(cards.filter(c => !c.isDeleted).map(c => [c.front.trim().toLowerCase(), c]));
  const from = dayString(new Date(Date.parse(`${today}T12:00:00`) - (windowDays - 1) * 86_400_000));
  const rows = answers
    .filter(a => !a.isDeleted && live.has(a.cardId) && a.day >= from && a.day <= today)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const perCard = new Map<string, { wrong: number; total: number; lastWrong: string; rightSince: number; chose: Map<string, number> }>();
  const pairs = new Map<string, Confusion>();
  for (const a of rows) {
    const s = perCard.get(a.cardId) || { wrong: 0, total: 0, lastWrong: '', rightSince: 0, chose: new Map<string, number>() };
    s.total++;
    if (a.right) s.rightSince++;
    else {
      s.wrong++;
      s.lastWrong = a.day;
      s.rightSince = 0;
      if (a.chose) {
        s.chose.set(a.chose, (s.chose.get(a.chose) || 0) + 1);
        const key = `${a.cardId}|${a.chose.toLowerCase()}`;
        const pair = pairs.get(key) || { card: live.get(a.cardId)!, chose: a.chose, choseBack: byFront.get(a.chose.trim().toLowerCase())?.back, count: 0 };
        pair.count++;
        pairs.set(key, pair);
      }
    }
    perCard.set(a.cardId, s);
  }

  const words: MistakenWord[] = [];
  for (const [id, s] of perCard) {
    if (s.wrong === 0 || s.rightSince >= RIGHT_TO_CLEAR) continue;
    words.push({
      card: live.get(id)!, wrong: s.wrong, total: s.total, lastWrong: s.lastWrong,
      takenFor: [...s.chose.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w),
    });
  }
  words.sort((a, b) => b.wrong - a.wrong || b.lastWrong.localeCompare(a.lastWrong) || a.card.front.localeCompare(b.card.front));
  const open = new Set(words.map(w => w.card.id));
  return {
    words,
    confusions: [...pairs.values()].filter(p => open.has(p.card.id)).sort((a, b) => b.count - a.count || a.card.front.localeCompare(b.card.front)),
    answers: rows.length,
    right: rows.filter(a => a.right).length,
  };
};
