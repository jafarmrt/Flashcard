// File: /services/studyLesson.ts
// Structured timed study lessons (30, 45, or 60 minutes) built deterministically
// from the learner's own flashcards. Every lesson combines active review, a
// mixed four-choice test, and contextual sentence consolidation, and is saved
// under that calendar day (`studyLessons`) so it can be resumed or replayed.

import type {
  Flashcard,
  LessonDuration,
  LessonStageSpec,
  LessonWordSnapshot,
  PerformanceRating,
  PracticeAnswer,
  SavedStudyLesson,
} from '../types';
import type { CardPlace } from './library';
import { dayString } from './calendar';
import { clozeFor, type Cloze } from './cloze';
import { mistakeSummary } from './practiceLog';
import { isDue, isNewCard } from './srsService';

export interface LessonBlueprint {
  durationMinutes: LessonDuration;
  titleFa: string;
  taglineFa: string;
  wordCount: number;
  maxNewShare: number;
  quizCount: number;
  clozeCount: number;
  splitReview: boolean;
  stageSummaryFa: string;
}

export const LESSON_BLUEPRINTS: Record<LessonDuration, LessonBlueprint> = {
  30: {
    durationMinutes: 30,
    titleFa: 'آموزش ۳۰ دقیقه‌ای',
    taglineFa: 'نیم ساعت متمرکز: مرور واژه‌ها، آزمون چهارگزینه‌ای و تثبیت در جمله',
    wordCount: 15,
    maxNewShare: 6,
    quizCount: 10,
    clozeCount: 6,
    splitReview: false,
    stageSummaryFa: '۱۵ واژه · مرور فعال + آزمون ۱۰ سؤالی + ۶ جملهٔ تثبیت',
  },
  45: {
    durationMinutes: 45,
    titleFa: 'آموزش ۴۵ دقیقه‌ای',
    taglineFa: 'چهل‌وپنج دقیقه با عمق بیشتر روی واژه‌های موعددار و اشتباه‌های اخیر',
    wordCount: 22,
    maxNewShare: 8,
    quizCount: 14,
    clozeCount: 8,
    splitReview: false,
    stageSummaryFa: '۲۲ واژه · مرور فعال + آزمون ۱۴ سؤالی + ۸ جملهٔ تثبیت',
  },
  60: {
    durationMinutes: 60,
    titleFa: 'آموزش ۶۰ دقیقه‌ای',
    taglineFa: 'یک ساعت کامل در دو نوبت مرور بی‌خستگی، آزمون جامع و جمع‌بندی در جمله',
    wordCount: 30,
    maxNewShare: 10,
    quizCount: 18,
    clozeCount: 10,
    splitReview: true,
    stageSummaryFa: '۳۰ واژه · دو بخش مرور ۱۵تایی + آزمون ۱۸ سؤالی + ۱۰ جملهٔ تثبیت',
  },
};

export const LESSON_DURATIONS: readonly LessonDuration[] = [30, 45, 60] as const;

const stabilityOf = (c: Flashcard): number =>
  typeof c.stability === 'number' ? c.stability : Math.max(0, c.interval || 0);

// Selects up to `targetCount` cards for a timed lesson in priority order:
//   1. Words with unresolved mistakes in quiz/listening (`mistakeSummary`);
//   2. Due review cards (most fragile / highest lapses first);
//   3. Due new cards up to `maxNewShare` (oldest first);
//   4. Weakest learned cards not yet due, then remaining new cards if needed.
export const pickLessonCards = (
  cards: Flashcard[],
  practice: PracticeAnswer[],
  targetCount: number,
  maxNewShare: number,
  now: Date = new Date(),
  newLeft: number = Infinity, // new cards the daily cap still allows today
): Flashcard[] => {
  const live = cards.filter(c => !c.isDeleted && c.kind !== 'grammar' && c.front.trim() && c.back.trim());
  if (live.length === 0 || targetCount <= 0) return [];

  const picked: Flashcard[] = [];
  const taken = new Set<string>();
  const add = (card: Flashcard | undefined) => {
    if (!card || taken.has(card.id) || picked.length >= targetCount) return;
    taken.add(card.id);
    picked.push(card);
  };

  const byId = new Map(live.map(c => [c.id, c]));
  const mistakes = mistakeSummary(practice, live, dayString(now));
  for (const m of mistakes.words) {
    add(byId.get(m.card.id));
  }

  const dueReviews = live
    .filter(c => !taken.has(c.id) && !isNewCard(c) && isDue(c, now))
    .sort((a, b) => {
      const lapseDiff = (b.lapses || 0) - (a.lapses || 0);
      if (lapseDiff !== 0) return lapseDiff;
      return stabilityOf(a) - stabilityOf(b);
    });
  for (const c of dueReviews) add(c);

  // A lesson starts new cards like a review does: within the day's cap.
  const newCandidates = live
    .filter(c => !taken.has(c.id) && isNewCard(c))
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    .slice(0, Math.max(0, newLeft));
  for (const c of newCandidates.slice(0, maxNewShare)) add(c);

  const learnedRest = live
    .filter(c => !taken.has(c.id) && !isNewCard(c))
    .sort((a, b) => stabilityOf(a) - stabilityOf(b));
  for (const c of learnedRest) add(c);

  for (const c of newCandidates.slice(maxNewShare)) add(c);

  return picked;
};

const snapshotWord = (
  card: Flashcard,
  places?: Map<string, CardPlace[]>,
): LessonWordSnapshot => {
  const bookSentence = places?.get(card.id)?.find(p => p.sentence?.trim())?.sentence;
  const fallbackSentence =
    card.sourceSentence?.trim() || card.exampleSentenceTarget?.find(s => s.trim());
  return {
    cardId: card.id,
    front: card.front.trim(),
    back: card.back.trim(),
    ...(card.partOfSpeech?.trim() ? { partOfSpeech: card.partOfSpeech.trim() } : {}),
    ...(bookSentence || fallbackSentence
      ? { sentence: (bookSentence || fallbackSentence)!.trim() }
      : {}),
  };
};

export interface CreateLessonInput {
  id?: string;
  durationMinutes: LessonDuration;
  cards: Flashcard[];
  practice: PracticeAnswer[];
  places?: Map<string, CardPlace[]>;
  today: string;
  now?: Date;
  newLeft?: number; // new cards the daily cap still allows today
}

export const createStudyLesson = ({
  id,
  durationMinutes,
  cards,
  practice,
  places,
  today,
  now = new Date(),
  newLeft,
}: CreateLessonInput): SavedStudyLesson | null => {
  const blueprint = LESSON_BLUEPRINTS[durationMinutes];
  const chosen = pickLessonCards(
    cards,
    practice,
    blueprint.wordCount,
    blueprint.maxNewShare,
    now,
    newLeft,
  );
  if (chosen.length === 0) return null;

  const livePoolCount = cards.filter(
    c => !c.isDeleted && c.kind !== 'grammar' && c.front.trim() && c.back.trim(),
  ).length;
  const canRunFourChoice = livePoolCount >= 4;

  const stages: LessonStageSpec[] = [];
  const cardIds = chosen.map(c => c.id);

  if (blueprint.splitReview && chosen.length >= 12) {
    const mid = Math.ceil(chosen.length / 2);
    const part1 = cardIds.slice(0, mid);
    const part2 = cardIds.slice(mid);
    stages.push({
      id: 'review-1',
      kind: 'review',
      titleFa: 'بخش اول مرور واژه‌ها',
      subtitleFa: 'یادآوری فعال معنی و جایگاه واژه‌ها در جمله',
      estimatedMinutes: Math.round(durationMinutes * 0.27),
      cardIds: part1,
      targetCount: part1.length,
      completed: false,
    });
    stages.push({
      id: 'review-2',
      kind: 'review',
      titleFa: 'بخش دوم مرور واژه‌ها',
      subtitleFa: 'ادامهٔ مرور با حفظ تمرکز و ثبت زمان‌بندی مرور بعدی',
      estimatedMinutes: Math.round(durationMinutes * 0.27),
      cardIds: part2,
      targetCount: part2.length,
      completed: false,
    });
  } else {
    stages.push({
      id: 'review-1',
      kind: 'review',
      titleFa: 'مرور فعال واژه‌ها',
      subtitleFa: 'بررسی کارت‌های منتخب و به‌روزرسانی زمان مرور هر واژه',
      estimatedMinutes: Math.round(durationMinutes * 0.46),
      cardIds,
      targetCount: cardIds.length,
      completed: false,
    });
  }

  if (canRunFourChoice) {
    const quizCount = Math.min(chosen.length, blueprint.quizCount);
    stages.push({
      id: 'quiz-1',
      kind: 'quiz',
      titleFa: 'آزمون چهارگزینه‌ای جلسه',
      subtitleFa: 'سنجش ترکیبی معنی و جای خالی از همین واژه‌ها',
      estimatedMinutes: Math.round(durationMinutes * 0.3),
      cardIds,
      targetCount: quizCount,
      completed: false,
    });
  }

  const clozeCount = Math.min(chosen.length, blueprint.clozeCount);
  stages.push({
    id: 'cloze-1',
    kind: 'cloze',
    titleFa: 'تثبیت در جمله و جمع‌بندی',
    subtitleFa: 'فراخوانی واژه‌ها در بافت جمله با اولویت واژه‌های دشوار همین جلسه',
    estimatedMinutes: Math.max(
      5,
      durationMinutes - stages.reduce((sum, s) => sum + s.estimatedMinutes, 0),
    ),
    cardIds,
    targetCount: clozeCount,
    completed: false,
  });

  const nowIso = now.toISOString();
  return {
    id: id || crypto.randomUUID(),
    day: today,
    durationMinutes,
    titleFa: blueprint.titleFa,
    status: 'in_progress',
    currentStageIndex: 0,
    cardIds,
    words: chosen.map(c => snapshotWord(c, places)),
    stages,
    reviewedCount: 0,
    quizRight: 0,
    quizTotal: 0,
    clozeRight: 0,
    clozeTotal: 0,
    hardCardIds: [],
    elapsedSeconds: 0,
    startedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
};

export interface StageCompletionInput {
  rightCount: number;
  totalCount: number;
  hardIds?: string[];
  addedSeconds?: number;
}

// The lesson with `cardId`'s rating recorded, or null when the card was
// already rated in it (the caller then leaves its schedule alone).
export const withLessonRating = (
  lesson: SavedStudyLesson,
  cardId: string,
  rating: PerformanceRating,
  nowIso: string = new Date().toISOString(),
): SavedStudyLesson | null =>
  lesson.ratings?.[cardId]
    ? null
    : { ...lesson, ratings: { ...lesson.ratings, [cardId]: rating }, updatedAt: nowIso };

// The lesson without `cardId`'s rating (its review was undone).
export const withoutLessonRating = (
  lesson: SavedStudyLesson,
  cardId: string,
  nowIso: string = new Date().toISOString(),
): SavedStudyLesson => {
  if (!lesson.ratings?.[cardId]) return lesson;
  const { [cardId]: _undone, ...rest } = lesson.ratings;
  return { ...lesson, ratings: rest, updatedAt: nowIso };
};

// The cards of a stage still to be rated in this lesson.
export const unratedCardIds = (cardIds: string[], ratings: SavedStudyLesson['ratings']): string[] =>
  cardIds.filter(id => !ratings?.[id]);

// A review stage's result from the lesson's ratings: Good and Easy count as
// right, Again and Hard make the card one to come back to in the last stage.
export const reviewStageResult = (cardIds: string[], ratings: SavedStudyLesson['ratings']) => {
  let rightCount = 0;
  const hardIds: string[] = [];
  for (const id of cardIds) {
    const r = ratings?.[id];
    if (r === 'GOOD' || r === 'EASY') rightCount++;
    if (r === 'AGAIN' || r === 'HARD') hardIds.push(id);
  }
  return { rightCount, totalCount: cardIds.length, hardIds };
};

export const completeLessonStage = (
  lesson: SavedStudyLesson,
  stageIndex: number,
  result: StageCompletionInput,
  nowIso: string = new Date().toISOString(),
): SavedStudyLesson => {
  if (stageIndex < 0 || stageIndex >= lesson.stages.length) return lesson;
  const targetStage = lesson.stages[stageIndex];
  const nextStages = lesson.stages.map((s, idx) =>
    idx === stageIndex
      ? {
          ...s,
          completed: true,
          rightCount: result.rightCount,
          totalCount: result.totalCount,
        }
      : s,
  );

  const mergedHard = Array.from(
    new Set([...lesson.hardCardIds, ...(result.hardIds || [])]),
  );

  let reviewedCount = lesson.reviewedCount;
  let quizRight = lesson.quizRight;
  let quizTotal = lesson.quizTotal;
  let clozeRight = lesson.clozeRight;
  let clozeTotal = lesson.clozeTotal;

  if (targetStage.kind === 'review') {
    reviewedCount = nextStages
      .filter(s => s.kind === 'review' && s.completed)
      .reduce((sum, s) => sum + (s.totalCount ?? s.targetCount), 0);
  } else if (targetStage.kind === 'quiz') {
    quizRight = result.rightCount;
    quizTotal = result.totalCount;
  } else if (targetStage.kind === 'cloze') {
    clozeRight = result.rightCount;
    clozeTotal = result.totalCount;
  }

  const nextIndex = nextStages.findIndex(s => !s.completed);
  const allDone = nextIndex === -1;

  return {
    ...lesson,
    stages: nextStages,
    currentStageIndex: allDone ? nextStages.length - 1 : nextIndex,
    status: allDone ? 'completed' : 'in_progress',
    reviewedCount,
    quizRight,
    quizTotal,
    clozeRight,
    clozeTotal,
    hardCardIds: mergedHard,
    elapsedSeconds: Math.max(0, lesson.elapsedSeconds + Math.max(0, result.addedSeconds || 0)),
    ...(allDone ? { completedAt: lesson.completedAt || nowIso } : {}),
    updatedAt: nowIso,
  };
};

export interface LessonClozeItem {
  cardId: string;
  front: string;
  back: string;
  cloze: Cloze | null;
  options: string[]; // 4 English choices (including the exact surface answer or front) for quick tap or check
  correctOption: string;
}

// Builds the final consolidation items for the lesson, putting words marked
// hard/missed during earlier stages first so nothing stays half-learned.
export const buildLessonClozeItems = (
  lesson: SavedStudyLesson,
  allCards: Flashcard[],
  places?: Map<string, CardPlace[]>,
  random: () => number = Math.random,
): LessonClozeItem[] => {
  const byId = new Map(allCards.filter(c => !c.isDeleted).map(c => [c.id, c]));
  const clozeStage = lesson.stages.find(s => s.kind === 'cloze');
  const limit = clozeStage?.targetCount || Math.min(8, lesson.cardIds.length);
  const hardSet = new Set(lesson.hardCardIds);

  const orderedIds = [
    ...lesson.cardIds.filter(id => hardSet.has(id)),
    ...lesson.cardIds.filter(id => !hardSet.has(id)),
  ].slice(0, limit);

  const pool = allCards.filter(c => !c.isDeleted && c.front.trim());

  return orderedIds.map(cardId => {
    const liveCard = byId.get(cardId);
    const snap = lesson.words.find(w => w.cardId === cardId);
    const front = liveCard?.front.trim() || snap?.front || '';
    const back = liveCard?.back.trim() || snap?.back || '';
    const placeSentences = places?.get(cardId)?.map(p => p.sentence) || [];
    const cloze = liveCard
      ? clozeFor(liveCard, placeSentences)
      : snap?.sentence
        ? clozeFor(
            {
              front,
              kind: 'word',
              sourceSentence: snap.sentence,
              exampleSentenceTarget: [],
            },
            [],
          )
        : null;

    const correctOption = cloze ? cloze.answer : front;
    const distractors = pool
      .filter(
        c =>
          c.id !== cardId &&
          c.front.trim().toLowerCase() !== front.toLowerCase() &&
          c.front.trim().toLowerCase() !== correctOption.toLowerCase(),
      )
      .sort(() => random() - 0.5)
      .slice(0, 3)
      .map(c => c.front.trim());

    const options = [correctOption, ...distractors];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    return {
      cardId,
      front,
      back,
      cloze,
      options,
      correctOption,
    };
  });
};

export interface DayLessonsGroup {
  day: string;
  lessons: SavedStudyLesson[];
}

export const liveStudyLessons = (lessons: SavedStudyLesson[]): SavedStudyLesson[] =>
  lessons
    .filter(l => !l.isDeleted)
    .sort((a, b) => (b.startedAt || b.createdAt).localeCompare(a.startedAt || a.createdAt));

export const lessonsByDay = (lessons: SavedStudyLesson[]): DayLessonsGroup[] => {
  const groups = new Map<string, SavedStudyLesson[]>();
  for (const lesson of liveStudyLessons(lessons)) {
    const list = groups.get(lesson.day) || [];
    list.push(lesson);
    groups.set(lesson.day, list);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, list]) => ({ day, lessons: list }));
};

export const todayOpenLesson = (
  lessons: SavedStudyLesson[],
  today: string,
): SavedStudyLesson | undefined =>
  liveStudyLessons(lessons).find(l => l.day === today && l.status === 'in_progress');

export const formatLessonDayFa = (day: string, today: string): string => {
  const parts = day.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return day;
  const date = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  const formatted = date.toLocaleDateString('fa-IR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return day === today ? `امروز · ${formatted}` : formatted;
};
