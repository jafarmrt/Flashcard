// File: /components/lesson/LessonView.tsx
// Structured timed daily study lessons (30, 45, or 60 minutes) combining
// active FSRS review, a mixed 4-choice quiz, and contextual sentence cloze
// consolidation. Every lesson is saved under its calendar day (`studyLessons`)
// so the learner can resume, inspect, re-review, or re-test any day's lesson.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Flashcard,
  LessonDuration,
  PerformanceRating,
  PracticeAnswer,
  SavedStudyLesson,
} from '../../types';
import type { AiRequestOptions } from '../../services/geminiService';
import type { CardPlace } from '../../services/library';
import { bookQuiz } from '../../services/bookQuiz';
import { dayString } from '../../services/calendar';
import { blankOf, checkCloze } from '../../services/cloze';
import { fetchAudioData } from '../../services/dictionaryService';
import {
  buildLessonClozeItems,
  completeLessonStage,
  createStudyLesson,
  formatLessonDayFa,
  LESSON_BLUEPRINTS,
  LESSON_DURATIONS,
  lessonsByDay,
  reviewStageResult,
  todayOpenLesson,
  unratedCardIds,
  withLessonRating,
  withoutLessonRating,
  type LessonClozeItem,
} from '../../services/studyLesson';
import { isSpeechSupported, speakText } from '../../services/ttsService';
import { QuizPractice, type QuizFirstAnswer } from '../practice/QuizPractice';
import { StudyView } from '../StudyView';
import { fa, Icon } from '../common/ui';

interface LessonViewProps {
  cards: Flashcard[];
  places: Map<string, CardPlace[]>;
  practice: PracticeAnswer[];
  lessons: SavedStudyLesson[];
  aiOptions?: AiRequestOptions;
  initialDuration?: LessonDuration | null;
  onConsumeInitialDuration?: () => void;
  onSaveLesson: (lesson: SavedStudyLesson) => Promise<void> | void;
  onDeleteLesson: (lessonId: string) => Promise<void> | void;
  onRateCard: (cardId: string, rating: PerformanceRating) => Promise<Flashcard | null>;
  onPracticeAnswer: (cardId: string, right: boolean, chose?: string) => void;
  onQuizMiss: (cardId: string) => void; // a miss in a replayed quiz counts as forgetting, as in any quiz
  newCardsLeft?: number; // new cards the daily cap still allows today
  onReviewLessonCards: (cardIds: string[]) => void;
  onBackToToday: () => void;
}

type ScreenMode = 'home' | 'runner' | 'summary' | 'replay-quiz';

const formatClockFa = (seconds: number): string => {
  const mins = Math.floor(Math.max(0, seconds) / 60);
  const secs = Math.floor(Math.max(0, seconds) % 60);
  return `${fa(mins)}:${secs < 10 ? `۰${fa(secs)}` : fa(secs)}`;
};

const playWordAudio = async (word: string, audioSrc?: string) => {
  const clean = word.trim();
  if (!clean) return;
  if (audioSrc) {
    try {
      const src = /^(data|blob):/.test(audioSrc) ? audioSrc : await fetchAudioData(audioSrc);
      const audio = new Audio(src);
      await audio.play();
      return;
    } catch {
      // Fall back to speech synthesis below.
    }
  }
  speakText(clean, { rate: 0.92 });
};

// Stage 1 / 2: the lesson's review is the app's own review (StudyView) with
// its rules: a card missed comes back after ten others, a new card is asked
// twice, typed meanings are checked, a rating can be undone. It had its own
// simpler copy, without any of them. Each card's first rating in the lesson
// is kept (SavedStudyLesson.ratings), so a resumed stage asks only the rest.
const LessonReviewStage: React.FC<{
  cardIds: string[];
  cardsById: Map<string, Flashcard>;
  lesson: SavedStudyLesson;
  places: Map<string, CardPlace[]>;
  allCards: Flashcard[];
  aiOptions?: AiRequestOptions;
  onRated: (cardId: string, rating: PerformanceRating) => void;
  onUndone: (cardId: string) => void;
  onExit: () => void; // the review ended or was left: the parent decides which
}> = ({ cardIds, cardsById, lesson, places, allCards, aiOptions, onRated, onUndone, onExit }) => {
  // Fixed when the stage opens: StudyView starts its session over whenever
  // its cards change, and every rating's sync hands back new card objects.
  const [cards] = useState(() =>
    unratedCardIds(cardIds, lesson.ratings).map(id => cardsById.get(id)).filter((c): c is Flashcard => !!c),
  );

  // Every card was rated before the pause: the stage is done.
  const finishedOnArrival = useRef(cards.length === 0);
  useEffect(() => {
    if (finishedOnArrival.current) {
      finishedOnArrival.current = false;
      onExit();
    }
  }, [onExit]);
  if (cards.length === 0) return null;

  return (
    <StudyView
      cards={cards}
      initialMode="auto"
      places={places}
      allCards={allCards}
      aiOptions={aiOptions}
      onRated={(id, rating, first) => { if (first) onRated(id, rating); }}
      onUndone={(id, first) => { if (first) onUndone(id); }}
      onExit={() => onExit()}
      finishLabel="ادامهٔ جلسه"
    />
  );
};

// Final Stage: Contextual Sentence Cloze Consolidation
const LessonClozeStage: React.FC<{
  items: LessonClozeItem[];
  cardsById: Map<string, Flashcard>;
  onFinishStage: (result: { rightCount: number; totalCount: number; hardIds: string[] }) => void;
}> = ({ items: offered, cardsById, onFinishStage }) => {
  // The sentences and their choices are fixed for the stage: they are built
  // with a shuffle, and every rating's sync rebuilt them, reshuffling the
  // choices under the question being answered.
  const [items] = useState(offered);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState<{ status: 'correct' | 'close' | 'wrong'; chosen: string } | null>(null);
  const [rightCount, setRightCount] = useState(0);
  const hardSetRef = useRef<Set<string>>(new Set());

  const item = items[index];

  const evaluate = (answerText: string) => {
    if (!item || checked) return;
    const clean = answerText.trim();
    if (!clean) return;

    let status: 'correct' | 'close' | 'wrong';
    if (item.cloze) {
      status = checkCloze(clean, item.cloze, item.front);
    } else {
      status = clean.toLowerCase() === item.correctOption.toLowerCase() ? 'correct' : 'wrong';
    }

    if (status === 'correct' || status === 'close') {
      setRightCount(n => n + 1);
    } else {
      hardSetRef.current.add(item.cardId);
    }
    setChecked({ status, chosen: clean });
  };

  const handleNext = () => {
    if (!checked) return;
    if (index + 1 < items.length) {
      setIndex(i => i + 1);
      setTyped('');
      setChecked(null);
    } else {
      onFinishStage({
        rightCount,
        totalCount: items.length,
        hardIds: Array.from(hardSetRef.current),
      });
    }
  };

  // No sentence to fill in (none of the words has one): the stage must
  // still end, or the lesson stayed on an empty screen.
  if (!item) {
    return (
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-6 text-center flex flex-col gap-4">
        <p className="text-sm text-ink-muted dark:text-slate-300">
          برای این واژه‌ها جمله‌ای برای جای خالی پیدا نشد.
        </p>
        <button
          type="button"
          onClick={() => onFinishStage({ rightCount: 0, totalCount: 0, hardIds: [] })}
          className="self-center min-h-[48px] px-6 rounded-2xl bg-brand-500 text-white font-bold"
        >
          ثبت و پایان جلسه
        </button>
      </section>
    );
  }

  const liveCard = cardsById.get(item.cardId);

  return (
    <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-8 border border-stone-200/80 dark:border-slate-700 flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-stone-200 dark:bg-slate-700 overflow-hidden">
          <div
            className="h-full bg-brand-500 rounded-full transition-opacity duration-200"
            style={{ width: `${((index + (checked ? 1 : 0)) / items.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-ink-muted dark:text-slate-400 whitespace-nowrap tabular-nums">
          تثبیت {fa(index + 1)} از {fa(items.length)}
        </span>
      </div>

      <div className="text-center flex flex-col gap-2">
        <p className="text-xs text-ink-muted dark:text-slate-400">
          واژهٔ هم‌معنی با عبارت زیر را در جای خالی قرار بده:
        </p>
        <h3 className="text-2xl font-extrabold text-ink dark:text-white">{item.back}</h3>
        {item.cloze ? (
          <p
            dir="ltr"
            className="font-read text-lg sm:text-xl leading-relaxed text-slate-800 dark:text-slate-100 mt-2 max-w-2xl mx-auto"
          >
            {item.cloze.before}
            <span className="inline-block font-bold text-brand-700 dark:text-brand-300 underline decoration-2 underline-offset-4 px-1">
              {checked ? item.cloze.answer : blankOf(item.cloze.answer)}
            </span>
            {item.cloze.after}
          </p>
        ) : (
          <p dir="ltr" className="font-en text-base text-ink-muted dark:text-slate-400 mt-1">
            {checked ? item.front : blankOf(item.front)}
          </p>
        )}
      </div>

      {!checked ? (
        <div className="flex flex-col gap-4">
          {item.options.length > 1 && (
            <div className="grid grid-cols-2 gap-2.5">
              {item.options.map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => evaluate(opt)}
                  dir="ltr"
                  className="min-h-[48px] px-4 rounded-2xl border border-stone-200 dark:border-slate-600 bg-stone-50 hover:bg-brand-50 dark:bg-slate-700/50 dark:hover:bg-slate-700 font-en font-semibold text-base text-ink dark:text-white transition-colors"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={e => {
              e.preventDefault();
              evaluate(typed);
            }}
            className="flex items-center gap-2"
          >
            <label htmlFor="lesson-cloze-input" className="sr-only">
              نوشتن واژهٔ انگلیسی
            </label>
            <input
              id="lesson-cloze-input"
              type="text"
              dir="ltr"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder="یا خودت اینجا بنویس…"
              className="flex-1 min-h-[48px] px-4 rounded-2xl border border-stone-200 dark:border-slate-600 bg-white dark:bg-slate-900 font-en text-ink dark:text-white focus:border-brand-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!typed.trim()}
              className="min-h-[48px] px-5 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm disabled:opacity-40 whitespace-nowrap"
            >
              بررسی
            </button>
          </form>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 pt-2 border-t border-stone-200/80 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <p
              role="status"
              className={`font-bold text-base ${
                checked.status === 'correct'
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : checked.status === 'close'
                    ? 'text-amber-800 dark:text-amber-200'
                    : 'text-red-700 dark:text-red-300'
              }`}
            >
              {checked.status === 'correct'
                ? '✓ دقیق و درست بود'
                : checked.status === 'close'
                  ? `نزدیک بود · املای دقیق: ${item.correctOption}`
                  : `پاسخ درست: ${item.correctOption}`}
            </p>
            <button
              type="button"
              onClick={() => void playWordAudio(item.front, liveCard?.audioSrc)}
              aria-label="پخش تلفظ"
              className="min-h-[40px] min-w-[40px] rounded-full text-slate-500 hover:text-brand-600 dark:text-slate-300 flex items-center justify-center"
            >
              <Icon.Speaker size={18} />
            </button>
          </div>
          <button
            type="button"
            onClick={handleNext}
            className="min-h-[52px] px-8 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold whitespace-nowrap"
          >
            {index + 1 < items.length ? 'جملهٔ بعدی' : 'ثبت و پایان جلسه'}
          </button>
        </div>
      )}
    </section>
  );
};

export const LessonView: React.FC<LessonViewProps> = ({
  cards,
  places,
  practice,
  lessons,
  aiOptions,
  initialDuration,
  onConsumeInitialDuration,
  onSaveLesson,
  onDeleteLesson,
  onRateCard,
  onPracticeAnswer,
  onQuizMiss,
  newCardsLeft,
  onReviewLessonCards,
  onBackToToday,
}) => {
  const today = dayString(new Date());
  const [selectedDuration, setSelectedDuration] = useState<LessonDuration>(initialDuration || 30);
  const [mode, setMode] = useState<ScreenMode>('home');
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [replayQuizLesson, setReplayQuizLesson] = useState<{
    title: string;
    cardIds: string[];
  } | null>(null);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const stageStartedAtRef = useRef<number>(Date.now());
  const quizStatsRef = useRef<{ right: number; total: number; missed: Set<string> }>({
    right: 0,
    total: 0,
    missed: new Set(),
  });

  const cardsById = useMemo(
    () => new Map(cards.filter(c => !c.isDeleted).map(c => [c.id, c])),
    [cards],
  );
  const groupedLessons = useMemo(() => lessonsByDay(lessons), [lessons]);
  const openToday = useMemo(() => todayOpenLesson(lessons, today), [lessons, today]);
  const activeLesson = useMemo(
    () => lessons.find(l => l.id === activeLessonId && !l.isDeleted) || null,
    [lessons, activeLessonId],
  );

  // Consume deep-link duration from TodayView once on arrival.
  useEffect(() => {
    if (!initialDuration) return;
    setSelectedDuration(initialDuration);
    onConsumeInitialDuration?.();
  }, [initialDuration, onConsumeInitialDuration]);

  // The lesson as it is now, for handlers that run after an await: the
  // object a render closed over may lack a rating saved since.
  const activeLessonRef = useRef(activeLesson);
  activeLessonRef.current = activeLesson;
  const stageIndex = activeLesson?.currentStageIndex;

  // Live elapsed timer while inside the active lesson runner. It restarts
  // only when the lesson or its stage changes: every rating syncs and the
  // sync hands back a new lesson object, and restarting on that set the
  // clock back each time, so the time kept was only that since the last sync.
  useEffect(() => {
    if (mode !== 'runner' || !activeLessonId || stageIndex === undefined) return;
    const base = activeLessonRef.current?.elapsedSeconds || 0;
    stageStartedAtRef.current = Date.now();
    setLiveSeconds(base);
    const id = window.setInterval(() => {
      const delta = Math.floor((Date.now() - stageStartedAtRef.current) / 1000);
      setLiveSeconds(base + Math.max(0, delta));
    }, 1000);
    return () => window.clearInterval(id);
  }, [mode, activeLessonId, stageIndex]);

  // The review stage (StudyView) has rated the card already; the lesson
  // only keeps the rating. Read and written through the ref, so answers in
  // quick succession each add to the latest lesson.
  const recordRating = useCallback((cardId: string, rating: PerformanceRating) => {
    const lesson = activeLessonRef.current;
    const next = lesson && withLessonRating(lesson, cardId, rating);
    if (!next) return;
    activeLessonRef.current = next;
    void onSaveLesson(next);
  }, [onSaveLesson]);

  const forgetRating = useCallback((cardId: string) => {
    const lesson = activeLessonRef.current;
    if (!lesson) return;
    const next = withoutLessonRating(lesson, cardId);
    activeLessonRef.current = next;
    void onSaveLesson(next);
  }, [onSaveLesson]);

  // Rates a card once per lesson (see SavedStudyLesson.ratings).
  const rateInLesson = useCallback(async (cardId: string, rating: PerformanceRating) => {
    const lesson = activeLessonRef.current;
    if (!lesson) return null;
    const next = withLessonRating(lesson, cardId, rating);
    if (!next) return null;
    activeLessonRef.current = next;
    const rated = await onRateCard(cardId, rating);
    await onSaveLesson(next);
    return rated;
  }, [onRateCard, onSaveLesson]);

  const startNewLesson = async (duration: LessonDuration) => {
    const created = createStudyLesson({
      durationMinutes: duration,
      cards,
      practice,
      places,
      today,
      newLeft: newCardsLeft,
    });
    if (!created) return;
    await onSaveLesson(created);
    setActiveLessonId(created.id);
    quizStatsRef.current = { right: 0, total: 0, missed: new Set() };
    setMode('runner');
  };

  const resumeLesson = (lesson: SavedStudyLesson) => {
    setActiveLessonId(lesson.id);
    quizStatsRef.current = { right: 0, total: 0, missed: new Set() };
    setMode(lesson.status === 'completed' ? 'summary' : 'runner');
  };

  const pauseAndExitRunner = async () => {
    const activeLesson = activeLessonRef.current;
    if (activeLesson && activeLesson.status === 'in_progress') {
      const added = Math.max(0, Math.floor((Date.now() - stageStartedAtRef.current) / 1000));
      if (added > 0) {
        await onSaveLesson({
          ...activeLesson,
          elapsedSeconds: activeLesson.elapsedSeconds + added,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    setMode('home');
  };

  const handleStageComplete = async (result: {
    rightCount: number;
    totalCount: number;
    hardIds: string[];
  }) => {
    const activeLesson = activeLessonRef.current;
    if (!activeLesson) return;
    const addedSeconds = Math.max(1, Math.floor((Date.now() - stageStartedAtRef.current) / 1000));
    const updated = completeLessonStage(activeLesson, activeLesson.currentStageIndex, {
      ...result,
      addedSeconds,
    });
    await onSaveLesson(updated);
    stageStartedAtRef.current = Date.now();
    quizStatsRef.current = { right: 0, total: 0, missed: new Set() };
    if (updated.status === 'completed') {
      setMode('summary');
    }
  };

  // The review stage ended or was left. Every card of the stage rated: the
  // stage is complete. Left early: the lesson is paused, and the cards not
  // rated yet are asked when it resumes. (A card deleted meanwhile is not
  // waited for.)
  const endReviewStage = () => {
    const lesson = activeLessonRef.current;
    const stage = lesson?.stages[lesson.currentStageIndex];
    if (!lesson || stage?.kind !== 'review') return;
    const left = unratedCardIds(stage.cardIds, lesson.ratings).filter(id => cardsById.has(id));
    if (left.length === 0) void handleStageComplete(reviewStageResult(stage.cardIds, lesson.ratings));
    else void pauseAndExitRunner();
  };

  const currentStage = activeLesson?.stages[activeLesson.currentStageIndex];

  const stageQuizQuestions = useMemo(() => {
    if (mode !== 'runner' || !activeLesson || currentStage?.kind !== 'quiz') return [];
    return bookQuiz(cards, places, {
      count: currentStage.targetCount,
      only: new Set(currentStage.cardIds),
      mix: true,
      canSpeak: isSpeechSupported(),
    });
  }, [mode, activeLesson, currentStage, cards, places]);

  const stageClozeItems = useMemo(() => {
    if (mode !== 'runner' || !activeLesson || currentStage?.kind !== 'cloze') return [];
    return buildLessonClozeItems(activeLesson, cards, places);
  }, [mode, activeLesson, currentStage, cards, places]);

  const replayQuestions = useMemo(() => {
    if (mode !== 'replay-quiz' || !replayQuizLesson) return [];
    return bookQuiz(cards, places, {
      count: Math.min(18, replayQuizLesson.cardIds.length),
      only: new Set(replayQuizLesson.cardIds),
      mix: true,
      canSpeak: isSpeechSupported(),
    });
  }, [mode, replayQuizLesson, cards, places]);

  // Replay Quiz View
  if (mode === 'replay-quiz' && replayQuizLesson) {
    return (
      <div dir="rtl" className="font-fa flex flex-col gap-5 max-w-3xl mx-auto w-full">
        <header className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setReplayQuizLesson(null);
              setMode('home');
            }}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-2xl bg-white dark:bg-slate-800 border border-stone-200/80 dark:border-slate-700 text-sm font-bold text-ink dark:text-white whitespace-nowrap"
          >
            <Icon.Back size={18} />
            <span>بازگشت به جلسه‌ها</span>
          </button>
          <h1 className="text-lg font-extrabold text-ink dark:text-white truncate">
            {replayQuizLesson.title}
          </h1>
        </header>

        {replayQuestions.length > 0 ? (
          <QuizPractice
            key={replayQuizLesson.cardIds.join(',')}
            questions={replayQuestions}
            aiOptions={aiOptions}
            onAnswer={(ans: QuizFirstAnswer) => {
              onPracticeAnswer(ans.cardId, ans.right, ans.chose);
              if (!ans.right) onQuizMiss(ans.cardId);
            }}
            onRetry={ids =>
              setReplayQuizLesson({
                title: 'تکرار واژه‌های دشوار همین آزمون',
                cardIds: ids,
              })
            }
            onDone={() => {
              setReplayQuizLesson(null);
              setMode('home');
            }}
          />
        ) : (
          <section className="bg-white dark:bg-slate-800 rounded-3xl p-6 text-center flex flex-col gap-3">
            <p className="text-sm text-ink-muted dark:text-slate-300">
              برای ساخت آزمون چهارگزینه‌ای دست‌کم ۴ کارت واژه لازم است.
            </p>
            <button
              type="button"
              onClick={() => setMode('home')}
              className="self-center min-h-[44px] px-5 rounded-xl bg-brand-500 text-white font-bold text-sm"
            >
              بازگشت
            </button>
          </section>
        )}
      </div>
    );
  }

  // Active Lesson Runner View
  if (mode === 'runner' && activeLesson && currentStage) {
    return (
      <div dir="rtl" className="font-fa flex flex-col gap-5 max-w-3xl mx-auto w-full">
        <header className="bg-white dark:bg-slate-800 rounded-3xl p-4 sm:p-5 border border-stone-200/80 dark:border-slate-700 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void pauseAndExitRunner()}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl bg-stone-100 hover:bg-stone-200/80 dark:bg-slate-700 dark:hover:bg-slate-600 text-sm font-bold text-ink dark:text-white whitespace-nowrap"
            >
              <Icon.Back size={18} />
              <span>ذخیره و مکث</span>
            </button>
            <div className="text-center">
              <h1 className="text-base sm:text-lg font-extrabold text-ink dark:text-white">
                {activeLesson.titleFa}
              </h1>
              <p className="text-xs text-ink-muted dark:text-slate-400 tabular-nums">
                گام {fa(activeLesson.currentStageIndex + 1)} از {fa(activeLesson.stages.length)} · {currentStage.titleFa}
              </p>
            </div>
            <span className="text-sm font-bold text-brand-700 dark:text-brand-300 tabular-nums whitespace-nowrap">
              {formatClockFa(liveSeconds)} / {fa(activeLesson.durationMinutes)} دقیقه
            </span>
          </div>

          {/* On a phone the steps are left out: the line above names the
              current one, and the list pushed the card below the fold. */}
          <ol
            className={`hidden sm:grid grid-cols-1 gap-2 text-xs ${
              activeLesson.stages.length >= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'
            }`}
          >
            {activeLesson.stages.map((st, idx) => {
              const isCurrent = idx === activeLesson.currentStageIndex;
              return (
                <li
                  key={st.id}
                  className={`rounded-xl px-3 py-2 border transition-colors truncate ${
                    st.completed
                      ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 font-bold'
                      : isCurrent
                        ? 'bg-brand-50 dark:bg-brand-900/40 border-brand-400 text-brand-800 dark:text-brand-100 font-bold'
                        : 'bg-stone-50 dark:bg-slate-900/50 border-stone-200/70 dark:border-slate-700 text-ink-muted dark:text-slate-400'
                  }`}
                >
                  {st.completed ? '✓ ' : `${fa(idx + 1)}. `}
                  {st.titleFa}
                </li>
              );
            })}
          </ol>
        </header>

        {currentStage.kind === 'review' && (
          <LessonReviewStage
            key={currentStage.id}
            cardIds={currentStage.cardIds}
            cardsById={cardsById}
            lesson={activeLesson}
            places={places}
            allCards={cards}
            aiOptions={aiOptions}
            onRated={recordRating}
            onUndone={forgetRating}
            onExit={endReviewStage}
          />
        )}

        {currentStage.kind === 'quiz' && (
          stageQuizQuestions.length > 0 ? (
            <QuizPractice
              key={currentStage.id}
              questions={stageQuizQuestions}
              aiOptions={aiOptions}
              doneLabel="ادامه به گام تثبیت"
              onAnswer={(ans: QuizFirstAnswer) => {
                quizStatsRef.current.total += 1;
                if (ans.right) quizStatsRef.current.right += 1;
                else quizStatsRef.current.missed.add(ans.cardId);
                onPracticeAnswer(ans.cardId, ans.right, ans.chose);
                // Rated already in this lesson's review: a miss marks it hard
                // for the last stage, it is not rated AGAIN a second time.
                if (!ans.right) void rateInLesson(ans.cardId, 'AGAIN');
              }}
              onRetry={() => {
                // Handled in the final consolidation stage immediately next.
                void handleStageComplete({
                  rightCount: quizStatsRef.current.right,
                  totalCount: quizStatsRef.current.total || stageQuizQuestions.length,
                  hardIds: Array.from(quizStatsRef.current.missed),
                });
              }}
              onDone={() => {
                void handleStageComplete({
                  rightCount: quizStatsRef.current.right,
                  totalCount: quizStatsRef.current.total || stageQuizQuestions.length,
                  hardIds: Array.from(quizStatsRef.current.missed),
                });
              }}
            />
          ) : (
            <section className="bg-white dark:bg-slate-800 rounded-3xl p-6 text-center flex flex-col gap-4">
              <p className="text-sm text-ink-muted dark:text-slate-300">
                تعداد واژه‌ها برای آزمون چهارگزینه‌ای کافی نبود؛ به گام تثبیت در جمله برویم.
              </p>
              <button
                type="button"
                onClick={() =>
                  void handleStageComplete({ rightCount: 0, totalCount: 0, hardIds: [] })
                }
                className="self-center min-h-[48px] px-6 rounded-2xl bg-brand-500 text-white font-bold"
              >
                ادامه به گام بعدی
              </button>
            </section>
          )
        )}

        {currentStage.kind === 'cloze' && (
          <LessonClozeStage
            key={currentStage.id}
            items={stageClozeItems}
            cardsById={cardsById}
            onFinishStage={res => void handleStageComplete(res)}
          />
        )}
      </div>
    );
  }

  // Completed Lesson Summary View
  if (mode === 'summary' && activeLesson) {
    const hardWords = activeLesson.words.filter(w => activeLesson.hardCardIds.includes(w.cardId));
    const minutesSpent = Math.max(1, Math.round(activeLesson.elapsedSeconds / 60));
    return (
      <div dir="rtl" className="font-fa flex flex-col gap-5 max-w-3xl mx-auto w-full">
        <section className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 border border-stone-200/80 dark:border-slate-700 flex flex-col gap-5">
          <div className="text-center flex flex-col gap-1.5">
            <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
              ✓ ثبت‌شده در کارنامهٔ {formatLessonDayFa(activeLesson.day, today)}
            </p>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-ink dark:text-white">
              {activeLesson.titleFa} کامل شد
            </h1>
            <p className="text-sm text-ink-muted dark:text-slate-400 tabular-nums">
              {fa(activeLesson.cardIds.length)} واژه مرور شد · زمان ثبت‌شده: حدود {fa(minutesSpent)} دقیقه
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl bg-stone-50 dark:bg-slate-900/60 p-3.5">
              <p className="text-xl font-extrabold text-ink dark:text-white tabular-nums">
                {fa(activeLesson.reviewedCount || activeLesson.cardIds.length)}
              </p>
              <p className="text-xs text-ink-muted dark:text-slate-400 mt-0.5">مرور واژه</p>
            </div>
            <div className="rounded-2xl bg-stone-50 dark:bg-slate-900/60 p-3.5">
              <p className="text-xl font-extrabold text-ink dark:text-white tabular-nums">
                {activeLesson.quizTotal > 0
                  ? `${fa(activeLesson.quizRight)} از ${fa(activeLesson.quizTotal)}`
                  : '—'}
              </p>
              <p className="text-xs text-ink-muted dark:text-slate-400 mt-0.5">آزمون چهارگزینه‌ای</p>
            </div>
            <div className="rounded-2xl bg-stone-50 dark:bg-slate-900/60 p-3.5">
              <p className="text-xl font-extrabold text-ink dark:text-white tabular-nums">
                {activeLesson.clozeTotal > 0
                  ? `${fa(activeLesson.clozeRight)} از ${fa(activeLesson.clozeTotal)}`
                  : '—'}
              </p>
              <p className="text-xs text-ink-muted dark:text-slate-400 mt-0.5">تثبیت در جمله</p>
            </div>
          </div>

          {hardWords.length > 0 && (
            <div className="rounded-2xl bg-amber-50/80 dark:bg-amber-900/25 p-4 flex flex-col gap-2.5">
              <h2 className="text-sm font-bold text-ink dark:text-white">
                واژه‌هایی که در این جلسه نیاز به دقت بیشتر داشتند ({fa(hardWords.length)})
              </h2>
              <ul className="divide-y divide-amber-200/60 dark:divide-amber-800/50">
                {hardWords.map(w => (
                  <li key={w.cardId} className="py-2 flex items-baseline justify-between gap-3 text-sm">
                    <span dir="ltr" className="font-read font-bold text-ink dark:text-white">
                      {w.front}
                    </span>
                    <span className="text-ink-muted dark:text-slate-200">{w.back}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-2.5 pt-1">
            {hardWords.length >= 1 && cards.length >= 4 && (
              <button
                type="button"
                onClick={() => {
                  setReplayQuizLesson({
                    title: `آزمون واژه‌های دشوار · ${activeLesson.titleFa}`,
                    cardIds: hardWords.map(w => w.cardId),
                  });
                  setMode('replay-quiz');
                }}
                className="min-h-[48px] px-5 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm whitespace-nowrap"
              >
                آزمون دوباره از واژه‌های دشوار
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode('home')}
              className="min-h-[48px] px-5 rounded-2xl bg-stone-100 hover:bg-stone-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-ink dark:text-white font-bold text-sm whitespace-nowrap"
            >
              مشاهدهٔ جلسه‌های ثبت‌شده
            </button>
            <button
              type="button"
              onClick={onBackToToday}
              className="min-h-[48px] px-5 rounded-2xl border border-stone-200 dark:border-slate-600 text-ink dark:text-slate-200 font-bold text-sm whitespace-nowrap"
            >
              صفحهٔ امروز
            </button>
          </div>
        </section>
      </div>
    );
  }

  // Home / Planner + Recorded Daily Lessons Archive
  const blueprint = LESSON_BLUEPRINTS[selectedDuration];
  const availableCount = Math.min(cards.length, blueprint.wordCount);

  return (
    <div dir="rtl" className="font-fa flex flex-col gap-6 max-w-4xl mx-auto w-full">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-ink dark:text-white">
            جلسهٔ آموزشی زمان‌بندی‌شده
          </h1>
          <p className="text-sm text-ink-muted dark:text-slate-400 mt-1">
            ترکیب قانون‌مند مرور واژه‌ها، آزمون چهارگزینه‌ای و تثبیت در جمله؛ ثبت‌شده به نام هر روز و قابل مرور دوباره.
          </p>
        </div>
        <button
          type="button"
          onClick={onBackToToday}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-2xl bg-white dark:bg-slate-800 border border-stone-200/80 dark:border-slate-700 text-sm font-bold text-ink dark:text-slate-100 hover:border-brand-400 transition-colors whitespace-nowrap"
        >
          <Icon.Back size={18} />
          <span>امروز</span>
        </button>
      </header>

      {openToday && (
        <section className="rounded-3xl bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-800/70 p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex flex-col gap-1">
            <h2 className="text-base sm:text-lg font-extrabold text-ink dark:text-white">
              جلسهٔ نیمه‌کارهٔ امروز آمادهٔ ادامه است
            </h2>
            <p className="text-xs sm:text-sm text-ink-muted dark:text-slate-300 tabular-nums">
              {openToday.titleFa} · گام {fa(openToday.currentStageIndex + 1)} از {fa(openToday.stages.length)} · {fa(openToday.cardIds.length)} واژه
            </p>
          </div>
          <button
            type="button"
            onClick={() => resumeLesson(openToday)}
            className="min-h-[48px] px-6 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold text-sm whitespace-nowrap"
          >
            ادامهٔ جلسهٔ امروز
          </button>
        </section>
      )}

      <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-7 border border-stone-200/80 dark:border-slate-700 flex flex-col gap-5">
        <div>
          <h2 className="text-lg font-extrabold text-ink dark:text-white">
            ساخت جلسهٔ آموزشی تازه از واژه‌هایت
          </h2>
          <p className="text-sm text-ink-muted dark:text-slate-400 mt-1">
            مدت زمانت را انتخاب کن؛ برنامه اولویت را به اشتباه‌های اخیر، کارت‌های موعددار و واژه‌های تازه می‌دهد.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {LESSON_DURATIONS.map(dur => {
            const bp = LESSON_BLUEPRINTS[dur];
            const active = selectedDuration === dur;
            return (
              <button
                key={dur}
                type="button"
                onClick={() => setSelectedDuration(dur)}
                aria-pressed={active}
                className={`text-right rounded-2xl p-4 border-2 transition-colors flex flex-col gap-1.5 min-h-[104px] ${
                  active
                    ? 'border-brand-500 bg-brand-50/70 dark:bg-brand-900/30'
                    : 'border-stone-200/80 dark:border-slate-700 bg-stone-50/70 dark:bg-slate-900/40 hover:border-brand-300'
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-extrabold text-ink dark:text-white tabular-nums whitespace-nowrap">
                    {fa(dur)} دقیقه
                  </span>
                  <span className="text-xs font-bold text-brand-700 dark:text-brand-300 tabular-nums whitespace-nowrap">
                    {fa(Math.min(cards.length, bp.wordCount))} واژه
                  </span>
                </span>
                <span className="text-xs text-ink-muted dark:text-slate-300 leading-relaxed">
                  {bp.taglineFa}
                </span>
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl bg-stone-50 dark:bg-slate-900/60 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-bold text-ink dark:text-white">
              برنامهٔ {blueprint.titleFa} ({fa(availableCount)} واژه)
            </p>
            <p className="text-xs text-ink-muted dark:text-slate-400">
              {blueprint.stageSummaryFa} · ثبت خودکار در تاریخ {formatLessonDayFa(today, today)}
            </p>
          </div>
          <button
            type="button"
            disabled={cards.length === 0}
            onClick={() => void startNewLesson(selectedDuration)}
            className="min-h-[52px] px-7 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold text-base disabled:opacity-40 whitespace-nowrap transition-colors"
          >
            شروع و ثبت آموزش ({fa(selectedDuration)} دقیقه)
          </button>
        </div>
      </section>

      <section aria-label="جلسه‌های آموزشی ثبت‌شده" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-extrabold text-ink dark:text-white">
            آموزش‌های ثبت‌شدهٔ روزانه
          </h2>
          <span className="text-xs text-ink-muted dark:text-slate-400 tabular-nums">
            {fa(groupedLessons.reduce((n, g) => n + g.lessons.length, 0))} جلسه
          </span>
        </div>

        {groupedLessons.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-stone-200/80 dark:border-slate-700 text-sm text-ink-muted dark:text-slate-400 leading-relaxed">
            هنوز جلسهٔ آموزشی ثبت نشده است. با شروع هر جلسهٔ ۳۰، ۴۵ یا ۶۰ دقیقه‌ای، واژه‌ها و نتیجهٔ آزمون همان روز اینجا ثبت می‌شود تا هر زمان خواستی دوباره مرورش کنی.
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {groupedLessons.map(group => (
              <div key={group.day} className="flex flex-col gap-2.5">
                <h3 className="text-sm font-bold text-ink-muted dark:text-slate-300 px-1">
                  {formatLessonDayFa(group.day, today)}
                </h3>
                <div className="flex flex-col gap-3">
                  {group.lessons.map(lesson => {
                    const expanded = expandedLessonId === lesson.id;
                    const doneStages = lesson.stages.filter(s => s.completed).length;
                    return (
                      <article
                        key={lesson.id}
                        className="bg-white dark:bg-slate-800 rounded-3xl p-5 border border-stone-200/80 dark:border-slate-700 flex flex-col gap-3.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex flex-col gap-1 min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <h4 className="text-base font-extrabold text-ink dark:text-white">
                                {lesson.titleFa}
                              </h4>
                              <span className="text-xs text-ink-muted dark:text-slate-400">·</span>
                              <span
                                className={`text-xs font-bold ${
                                  lesson.status === 'completed'
                                    ? 'text-emerald-700 dark:text-emerald-300'
                                    : 'text-amber-700 dark:text-amber-300'
                                }`}
                              >
                                {lesson.status === 'completed'
                                  ? '✓ تکمیل‌شده'
                                  : `نیمه‌کاره (گام ${fa(doneStages + 1)} از ${fa(lesson.stages.length)})`}
                              </span>
                            </div>
                            <p className="text-xs text-ink-muted dark:text-slate-400 tabular-nums">
                              {fa(lesson.cardIds.length)} واژه
                              {lesson.quizTotal > 0 && ` · آزمون ${fa(lesson.quizRight)} از ${fa(lesson.quizTotal)}`}
                              {lesson.clozeTotal > 0 && ` · تثبیت ${fa(lesson.clozeRight)} از ${fa(lesson.clozeTotal)}`}
                              {lesson.elapsedSeconds > 0 &&
                                ` · ${fa(Math.max(1, Math.round(lesson.elapsedSeconds / 60)))} دقیقه`}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {lesson.status === 'in_progress' && (
                              <button
                                type="button"
                                onClick={() => resumeLesson(lesson)}
                                className="min-h-[40px] px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold whitespace-nowrap"
                              >
                                ادامهٔ جلسه
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onReviewLessonCards(lesson.cardIds)}
                              className="min-h-[40px] px-3.5 rounded-xl bg-stone-100 hover:bg-stone-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-ink dark:text-white text-xs font-bold whitespace-nowrap"
                            >
                              مرور واژه‌های این جلسه
                            </button>
                            {cards.length >= 4 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReplayQuizLesson({
                                    title: `تکرار آزمون · ${lesson.titleFa}`,
                                    cardIds: lesson.cardIds,
                                  });
                                  setMode('replay-quiz');
                                }}
                                className="min-h-[40px] px-3.5 rounded-xl border border-stone-200 dark:border-slate-600 hover:border-brand-400 text-ink dark:text-slate-200 text-xs font-bold whitespace-nowrap"
                              >
                                تکرار آزمون
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setExpandedLessonId(expanded ? null : lesson.id)}
                              aria-expanded={expanded}
                              className="min-h-[40px] px-3 rounded-xl text-xs font-bold text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-slate-700 whitespace-nowrap"
                            >
                              {expanded ? 'بستن واژه‌ها' : 'فهرست واژه‌ها'}
                            </button>
                          </div>
                        </div>

                        {expanded && (
                          <div className="pt-3 border-t border-stone-200/80 dark:border-slate-700 flex flex-col gap-3">
                            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {lesson.words.map(w => {
                                const isHard = lesson.hardCardIds.includes(w.cardId);
                                return (
                                  <li
                                    key={w.cardId}
                                    className="rounded-xl bg-stone-50 dark:bg-slate-900/50 px-3.5 py-2.5 flex items-baseline justify-between gap-3 text-sm"
                                  >
                                    <span dir="ltr" className="font-read font-bold text-ink dark:text-white">
                                      {w.front}
                                    </span>
                                    <span className="text-xs text-ink-muted dark:text-slate-300 truncate">
                                      {w.back}
                                      {isHard ? ' · نیازمند تمرین' : ''}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                            <div className="flex justify-end">
                              {confirmDeleteId === lesson.id ? (
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="text-ink-muted dark:text-slate-400">این جلسه حذف شود؟</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void onDeleteLesson(lesson.id);
                                      setConfirmDeleteId(null);
                                    }}
                                    className="min-h-[36px] px-3 rounded-lg bg-red-600 text-white font-bold whitespace-nowrap"
                                  >
                                    بله، حذف کن
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="min-h-[36px] px-3 rounded-lg bg-stone-200 dark:bg-slate-700 text-ink dark:text-white font-bold whitespace-nowrap"
                                  >
                                    انصراف
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(lesson.id)}
                                  className="min-h-[36px] px-3 rounded-lg text-xs text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 whitespace-nowrap"
                                >
                                  حذف از آرشیو
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default LessonView;
