import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Flashcard, SavedThemeExercise, Settings } from '../../types';
import type { CardPlace } from '../../services/library';
import type { AiRequestOptions } from '../../services/geminiService';
import {
  generateMicroStory,
  hasUncoveredStoryWords,
  makeSavedStoryExercise,
  markThemeExercisePlayed,
  pickStoryCards,
  type MicroStoryData,
} from '../../services/wordThemes';
import { aiSpeechWithMeta } from '../../services/aiSpeech';
import { isSpeechSupported, speakText, stopSpeech } from '../../services/ttsService';
import { fa, Icon } from '../common/ui';

interface MicroStoryPracticeProps {
  themeName: string;
  cards: Flashcard[];
  places?: Map<string, CardPlace[]>;
  settings?: Settings;
  savedStories?: SavedThemeExercise[];
  initialExerciseId?: string | null;
  startFresh?: boolean;
  aiOptions?: AiRequestOptions;
  userLevel?: string;
  onSaveExercise?: (exercise: SavedThemeExercise) => Promise<void> | void;
  onAnswer?: (cardId: string, right: boolean, chose?: string) => void;
  onBack: () => void;
}

const sameWord = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export const MicroStoryPractice: React.FC<MicroStoryPracticeProps> = ({
  themeName,
  cards,
  places,
  settings,
  savedStories = [],
  initialExerciseId = null,
  startFresh = false,
  aiOptions,
  userLevel,
  onSaveExercise,
  onAnswer,
  onBack,
}) => {
  const [story, setStory] = useState<MicroStoryData | null>(null);
  const [currentExerciseId, setCurrentExerciseId] = useState<string | null>(initialExerciseId);
  const [loading, setLoading] = useState(true);
  const [excludeIds, setExcludeIds] = useState<Set<string>>(() => new Set());
  const [activeBlank, setActiveBlank] = useState(0);
  const [solved, setSolved] = useState<Map<number, string>>(() => new Map());
  const [wrongTry, setWrongTry] = useState<{ blankIndex: number; chosenWord: string } | null>(null);
  const [reported, setReported] = useState<Set<number>>(() => new Set());
  const [firstTryRight, setFirstTryRight] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [speakingStory, setSpeakingStory] = useState(false);
  const [storyAudioCached, setStoryAudioCached] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const savedStoriesRef = useRef(savedStories);
  savedStoriesRef.current = savedStories;

  const cardsByLower = useMemo(
    () => new Map(cards.map(c => [c.front.trim().toLowerCase(), c])),
    [cards],
  );

  const resetProgressForStory = useCallback((nextStory: MicroStoryData | null, exId: string | null) => {
    stopSpeech();
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setStory(nextStory);
    setCurrentExerciseId(exId);
    setSolved(new Map());
    setWrongTry(null);
    setReported(new Set());
    setFirstTryRight(0);
    setActiveBlank(0);
    setShowTranslation(false);
    setSpeakingStory(false);
    setStoryAudioCached(false);
  }, []);

  const buildFreshStory = useCallback(
    async (extraExclude: ReadonlySet<string>, aliveCheck: () => boolean) => {
      setLoading(true);
      resetProgressForStory(null, null);
      const history = savedStoriesRef.current;
      const chosen = pickStoryCards(cards, 5, new Date(), extraExclude, history);
      try {
        const built = await generateMicroStory(
          themeName,
          chosen,
          places,
          aiOptions,
          userLevel,
          history,
        );
        if (!aliveCheck()) return;
        if (built && built.blanks.length > 0) {
          const savedRow = makeSavedStoryExercise(themeName, built, new Date().toISOString());
          await onSaveExercise?.(savedRow);
          if (!aliveCheck()) return;
          resetProgressForStory(built, savedRow.id);
        } else {
          setStory(null);
        }
      } catch {
        if (!aliveCheck()) return;
        setStory(null);
      } finally {
        if (aliveCheck()) setLoading(false);
      }
    },
    [aiOptions, cards, onSaveExercise, places, resetProgressForStory, themeName, userLevel],
  );

  // Leaving the exercise stops the story's AI audio whichever way it was
  // opened: the saved-story branches below only stopped device speech, so
  // the story kept playing after going back, its URL never revoked.
  useEffect(() => () => {
    stopSpeech();
    audioRef.current?.pause();
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const history = savedStoriesRef.current;

    if (initialExerciseId) {
      const wanted = history.find(s => s.id === initialExerciseId && s.story);
      if (wanted?.story) {
        resetProgressForStory(wanted.story, wanted.id);
        setLoading(false);
        return () => {
          alive = false;
          stopSpeech();
        };
      }
    }

    // If not explicitly asking for a fresh generation and existing saved stories
    // already cover every word in this bundle, open the newest saved story at once
    // so reopening the bundle does not spend AI tokens or produce duplicate stories.
    if (!startFresh && history.length > 0 && !hasUncoveredStoryWords(cards, history)) {
      const latest = history.find(s => s.story);
      if (latest?.story) {
        resetProgressForStory(latest.story, latest.id);
        setLoading(false);
        return () => {
          alive = false;
          stopSpeech();
        };
      }
    }

    void buildFreshStory(excludeIds, () => alive);

    return () => {
      alive = false;
      stopSpeech();
      if (audioRef.current) audioRef.current.pause();
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
    // Run once per bundle session mount; subsequent new stories or replays are triggered explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeName]);

  const fullStoryText = useMemo(() => {
    if (!story) return '';
    return story.segments
      .map(seg => (seg.kind === 'text' ? seg.text : seg.surface))
      .join('');
  }, [story]);

  const handleRepeatSameStory = () => {
    if (!story) return;
    const existing = currentExerciseId
      ? savedStories.find(s => s.id === currentExerciseId)
      : undefined;
    if (existing && onSaveExercise) {
      void onSaveExercise(markThemeExercisePlayed(existing, new Date().toISOString()));
    }
    resetProgressForStory(story, currentExerciseId);
  };

  const handleSelectSavedStory = (id: string) => {
    const picked = savedStories.find(s => s.id === id && s.story);
    if (!picked?.story) return;
    if (onSaveExercise) {
      void onSaveExercise(markThemeExercisePlayed(picked, new Date().toISOString()));
    }
    resetProgressForStory(picked.story, picked.id);
  };

  const startAnotherStory = () => {
    const nextExclude = new Set(excludeIds);
    if (story) {
      story.blanks.forEach(b => nextExclude.add(b.cardId));
      if (nextExclude.size >= cards.length) {
        nextExclude.clear();
        story.blanks.forEach(b => nextExclude.add(b.cardId));
      }
      setExcludeIds(nextExclude);
    }
    void buildFreshStory(nextExclude, () => true);
  };

  const handleListenStory = async () => {
    if (!fullStoryText.trim()) return;
    if (speakingStory) {
      stopSpeech();
      audioRef.current?.pause();
      setSpeakingStory(false);
      return;
    }
    const preferAi = settings?.readAloudVoice === 'ai' || settings?.driveVoice === 'ai';
    if (preferAi && settings) {
      setSpeakingStory(true);
      try {
        const { blob, fromCache } = await aiSpeechWithMeta(fullStoryText, settings);
        setStoryAudioCached(fromCache);
        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = audioRef.current || (audioRef.current = new Audio());
        audio.onended = () => setSpeakingStory(false);
        audio.onerror = () => setSpeakingStory(false);
        audio.src = url;
        await audio.play();
        return;
      } catch {
        setSpeakingStory(false);
      }
    }
    if (isSpeechSupported()) {
      setSpeakingStory(true);
      speakText(fullStoryText, {
        rate: 0.92,
        onEnd: () => setSpeakingStory(false),
        onError: () => setSpeakingStory(false),
      });
    }
  };

  if (loading) {
    return (
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col items-center gap-3 text-center">
        <p className="text-base font-bold text-ink dark:text-white">در حال بافتن داستانک تازه برای بستهٔ «{themeName}»…</p>
        <p className="text-sm text-ink-muted dark:text-slate-400">
          واژه‌های کم‌تمرین‌تر در یک صحنهٔ غیرتکراری کنار هم چیده و ذخیره می‌شوند.
        </p>
      </section>
    );
  }

  if (!story || story.blanks.length === 0) {
    return (
      <section className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col items-center gap-4 text-center">
        <p className="text-base font-bold text-ink dark:text-white">واژهٔ کافی برای ساختن داستانک در این بسته نیست.</p>
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] px-5 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          بازگشت به بسته
        </button>
      </section>
    );
  }

  const totalBlanks = story.blanks.length;
  const allDone = solved.size >= totalBlanks;
  const currentBlank = story.blanks[activeBlank] || story.blanks.find(b => !solved.has(b.blankIndex));

  const usedWordsLower = new Set(
    Array.from(solved.keys())
      .map(idx => story.blanks[idx]?.targetWord.toLowerCase())
      .filter((w): w is string => !!w),
  );

  const handlePickWord = (word: string) => {
    if (allDone || !currentBlank) return;
    const idx = currentBlank.blankIndex;
    if (solved.has(idx)) return;

    const isRight = sameWord(word, currentBlank.targetWord);
    const firstAttempt = !reported.has(idx);

    if (firstAttempt) {
      setReported(prev => new Set(prev).add(idx));
      if (isRight) setFirstTryRight(n => n + 1);
      onAnswer?.(currentBlank.cardId, isRight, isRight ? undefined : word);
    }

    if (isRight) {
      const nextSolved = new Map(solved);
      nextSolved.set(idx, currentBlank.surface);
      setSolved(nextSolved);
      setWrongTry(null);
      const nextOpen = story.blanks.find(b => !nextSolved.has(b.blankIndex));
      if (nextOpen) setActiveBlank(nextOpen.blankIndex);
    } else {
      setWrongTry({ blankIndex: idx, chosenWord: word });
    }
  };

  const wrongChosenMeaning = wrongTry ? cardsByLower.get(wrongTry.chosenWord.toLowerCase())?.back : undefined;
  const canListen = Boolean(
    fullStoryText &&
      (isSpeechSupported() || settings?.readAloudVoice === 'ai' || settings?.driveVoice === 'ai'),
  );

  return (
    <section className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-8 flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={onBack}
            aria-label="بازگشت به بسته"
            className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-ink dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
          >
            <Icon.Back size={20} />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-extrabold text-ink dark:text-white truncate">{story.titleFa}</h2>
            <p className="text-xs text-ink-muted dark:text-slate-400">
              <span>بستهٔ {themeName}</span>
              <span aria-hidden="true"> · </span>
              <span className="tabular-nums">{fa(solved.size)} از {fa(totalBlanks)} جاخالی</span>
              <span aria-hidden="true"> · </span>
              <span>{story.byAi ? 'داستانک ذخیره‌شده' : 'از جمله‌های کارت‌هایت'}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {savedStories.length > 1 && (
            <select
              aria-label="انتخاب داستانک ذخیره‌شده"
              value={currentExerciseId || ''}
              onChange={e => handleSelectSavedStory(e.target.value)}
              className="min-h-[40px] max-w-[210px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-xs font-bold text-ink dark:text-white truncate"
            >
              {savedStories.map((s, idx) => (
                <option key={s.id} value={s.id}>
                  {fa(idx + 1)}. {s.titleFa}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={startAnotherStory}
            className="min-h-[40px] px-3.5 rounded-xl text-xs font-bold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-900/60 transition-colors whitespace-nowrap"
          >
            + داستانک تازه
          </button>
        </div>
      </header>

      <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div
          className="h-full bg-brand-500 rounded-full transition-all duration-200"
          style={{ width: `${(solved.size / totalBlanks) * 100}%` }}
        />
      </div>

      <div
        dir="ltr"
        className="rounded-2xl bg-slate-50 dark:bg-slate-900/60 p-4 sm:p-6 font-en text-base sm:text-lg leading-9 text-left text-ink dark:text-slate-100"
      >
        {story.segments.map((seg, i) => {
          if (seg.kind === 'text') {
            return <span key={i}>{seg.text}</span>;
          }
          const isSolved = solved.has(seg.blankIndex);
          const isCurrent = !allDone && currentBlank?.blankIndex === seg.blankIndex;
          if (isSolved) {
            return (
              <span
                key={i}
                className="inline-block mx-1 px-2.5 py-0.5 rounded-lg bg-emerald-100/80 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200 font-bold"
              >
                {solved.get(seg.blankIndex)}
              </span>
            );
          }
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                setActiveBlank(seg.blankIndex);
                setWrongTry(null);
              }}
              aria-label={`جای خالی ${fa(seg.blankIndex + 1)}`}
              className={`inline-flex items-center justify-center mx-1 min-h-[38px] min-w-[84px] px-3 py-0.5 rounded-xl border-2 text-sm font-bold align-baseline transition-colors ${
                isCurrent
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-200'
                  : 'border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-brand-400'
              }`}
            >
              {seg.blankIndex + 1}
            </button>
          );
        })}
      </div>

      {!allDone && currentBlank && (
        <div className="flex flex-col gap-3">
          {wrongTry && wrongTry.blankIndex === currentBlank.blankIndex && (
            <p role="status" className="rounded-2xl bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 px-4 py-3 text-sm leading-7">
              <bdi dir="ltr" className="font-en font-bold">{wrongTry.chosenWord}</bdi>
              {wrongChosenMeaning ? <> یعنی «{wrongChosenMeaning}»؛ </> : ' مناسب این جای خالی نیست؛ '}
              این‌جا واژه‌ای به معنی «<b>{currentBlank.hintFa}</b>» می‌خواهیم. دوباره انتخاب کن.
            </p>
          )}

          <p className="text-sm text-ink-muted dark:text-slate-400">
            واژهٔ مناسب برای جای خالی شمارهٔ <b className="tabular-nums text-ink dark:text-white">{fa(currentBlank.blankIndex + 1)}</b> را انتخاب کن:
          </p>

          <div dir="ltr" className="flex flex-wrap gap-2.5">
            {story.wordBank.map(word => {
              const used = usedWordsLower.has(word.toLowerCase());
              const justWrong = wrongTry?.blankIndex === currentBlank.blankIndex && sameWord(wrongTry.chosenWord, word);
              return (
                <button
                  key={word}
                  type="button"
                  disabled={used}
                  onClick={() => handlePickWord(word)}
                  className={`min-h-[44px] px-4 py-2 rounded-xl border-2 font-en text-base font-bold transition-colors whitespace-nowrap ${
                    used
                      ? 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 line-through cursor-not-allowed'
                      : justWrong
                        ? 'border-red-400 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                        : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/60 text-ink dark:text-white hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/30'
                  }`}
                >
                  {word}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {allDone && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 sm:p-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-base font-extrabold text-emerald-700 dark:text-emerald-300">
              داستانک کامل شد · <span className="tabular-nums">{fa(firstTryRight)} از {fa(totalBlanks)}</span> بار اول درست
              {storyAudioCached && (
                <span className="text-xs font-normal text-ink-muted dark:text-slate-400 ms-2">
                  · صدای ذخیره‌شده
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {canListen && (
                <button
                  type="button"
                  onClick={() => {
                    void handleListenStory();
                  }}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-bold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-900/60 transition-colors whitespace-nowrap"
                >
                  {speakingStory ? <Icon.Pause size={18} /> : <Icon.Speaker size={18} />}
                  <span>{speakingStory ? 'توقف صدا' : 'شنیدن داستانک'}</span>
                </button>
              )}
              {story.translationFa && (
                <button
                  type="button"
                  onClick={() => setShowTranslation(v => !v)}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
                >
                  <Icon.Translate size={18} />
                  <span>{showTranslation ? 'پنهان کردن ترجمه' : 'ترجمهٔ فارسی'}</span>
                </button>
              )}
            </div>
          </div>

          {showTranslation && story.translationFa && (
            <p className="text-sm leading-7 text-ink dark:text-slate-200 bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3.5">
              {story.translationFa}
            </p>
          )}

          <div className="flex flex-wrap gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onBack}
              className="min-h-[44px] px-4 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              بازگشت به بسته
            </button>
            <button
              type="button"
              onClick={handleRepeatSameStory}
              className="min-h-[44px] px-4 rounded-xl text-sm font-bold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-900/60 whitespace-nowrap"
            >
              تکرار همین داستانک
            </button>
            <button
              type="button"
              onClick={startAnotherStory}
              className="min-h-[44px] px-5 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 whitespace-nowrap"
            >
              ساخت داستانک تازه با واژه‌های دیگر
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
