import { StudyLog, UserAchievement, Flashcard, Deck, UserProfile, Chapter, Source, Occurrence } from '../types';
import { ALL_ACHIEVEMENTS } from './achievements';
import { db } from './localDBService';
import { computeStreak, dayString } from './streakService';
import { isBookFinished, isChapterFinished } from './library';

const XP_PER_LEVEL_BASE = 150;

/**
 * Calculates the level, progress, and XP thresholds based on total XP.
 * @param xp The total experience points.
 * @returns An object with level, progress percentage, and XP values.
 */
export const calculateLevel = (xp: number) => {
  if (xp < 0) xp = 0;
  
  // A simple quadratic formula for leveling up: level = sqrt(xp / base)
  const level = Math.floor(Math.sqrt(xp / XP_PER_LEVEL_BASE)) + 1;
  
  const xpForCurrentLevel = Math.pow(level - 1, 2) * XP_PER_LEVEL_BASE;
  const xpForNextLevel = Math.pow(level, 2) * XP_PER_LEVEL_BASE;
  
  const xpInCurrentLevel = xp - xpForCurrentLevel;
  const xpNeededForLevel = xpForNextLevel - xpForCurrentLevel;
  
  const progress = xpNeededForLevel > 0 ? (xpInCurrentLevel / xpNeededForLevel) * 100 : 100;

  return {
    level,
    progress: Math.min(100, Math.round(progress)),
    currentLevelXp: xpForCurrentLevel,
    xpForNextLevel,
    xp,
  };
};


/**
 * Calculates the current study streak from study logs. Days covered by a
 * streak freeze keep the streak alive without adding to it.
 */
export const calculateStreak = (logs: StudyLog[], frozenDates: string[] = []): number =>
  computeStreak(new Set(logs.map(log => log.date)), new Set(frozenDates), dayString(new Date()));


interface AchievementContext {
  allCards: Flashcard[];
  allDecks: Deck[];
  studyLogs: StudyLog[];
  userProfile: UserProfile;
  earnedAchievements: UserAchievement[];
  quizScore?: { score: number; total: number };
  sources?: Source[];
  chapters?: Chapter[];
  occurrences?: Occurrence[];
}

// Reading milestones: chapters and books finished, words carded from texts.
export const readingCounts = (sources: Source[], chapters: Chapter[], occurrences: Occurrence[], cards: Flashcard[]) => {
  const liveSources = sources.filter(s => !s.isDeleted);
  const liveIds = new Set(liveSources.map(s => s.id));
  const chaptersDone = chapters.filter(c => !c.isDeleted && liveIds.has(c.sourceId) && isChapterFinished(c)).length;
  const booksDone = liveSources.filter(s => isBookFinished(s, chapters)).length;
  const liveCards = new Set(cards.filter(c => !c.isDeleted).map(c => c.id));
  const wordsFromTexts = new Set(occurrences.filter(o => !o.isDeleted && liveCards.has(o.cardId)).map(o => o.cardId)).size;
  return { chaptersDone, booksDone, wordsFromTexts };
};
/**
 * Checks for and awards new achievements based on the user's progress.
 * @param context An object containing all necessary data to evaluate achievements.
 * @returns A list of newly awarded achievements.
 */
export const checkAndAwardAchievements = async (context: AchievementContext): Promise<UserAchievement[]> => {
  const { allCards, allDecks, studyLogs, userProfile, earnedAchievements, quizScore } = context;
  const earnedAchievementIds = new Set(earnedAchievements.map(a => a.achievementId));
  const newlyEarned: UserAchievement[] = [];

  const award = (id: string) => {
    if (!earnedAchievementIds.has(id)) {
      const newAchievement: UserAchievement = {
        achievementId: id,
        dateEarned: new Date().toISOString(),
      };
      newlyEarned.push(newAchievement);
      earnedAchievementIds.add(id); // Prevent awarding twice in the same check
    }
  };

  // --- Check all achievements ---

  // 1. Card Creation
  if (allCards.length >= 1) award('first-card');
  if (allCards.length >= 10) award('card-creator-10');
  if (allCards.length >= 50) award('card-creator-50');

  // 2. Study Habits
  if (studyLogs.length > 0) award('first-study');
  const streak = calculateStreak(studyLogs, userProfile.frozenDates);
  if (streak >= 7) award('streak-7');
  if (streak >= 30) award('streak-30');
  
  // 3. Leveling
  if (userProfile.level >= 5) award('level-5');
  if (userProfile.level >= 10) award('level-10');
  
  // 4. Quizzes
  if (quizScore && quizScore.score === quizScore.total && quizScore.total > 0) {
    award('quiz-hero');
  }

  // 5. Reading
  if (context.sources && context.chapters && context.occurrences) {
    const { chaptersDone, booksDone, wordsFromTexts } = readingCounts(context.sources, context.chapters, context.occurrences, allCards);
    if (chaptersDone >= 1) award('first-chapter');
    if (chaptersDone >= 10) award('chapters-10');
    if (booksDone >= 1) award('first-book');
    if (booksDone >= 3) award('books-3');
    if (wordsFromTexts >= 100) award('words-100');
  }

  // 6. Deck Mastery (expensive check, do last)
  for (const deck of allDecks) {
    if (deck.isDeleted) continue;
    const cardsInDeck = allCards.filter(c => c.deckId === deck.id && !c.isDeleted);
    if (cardsInDeck.length > 0) {
      const allMastered = cardsInDeck.every(c => c.interval > 30);
      if (allMastered) {
        award('deck-master');
        break; // Only award once
      }
    }
  }

  // --- Save newly earned achievements to DB ---
  // bulkPut: two checks running at once may award the same achievement.
  if (newlyEarned.length > 0) {
    await db.userAchievements.bulkPut(newlyEarned);
  }

  return newlyEarned;
};
