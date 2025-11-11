import { StudyLog, UserAchievement, Flashcard, Deck, UserProfile } from '../types';
import { ALL_ACHIEVEMENTS } from './achievements';
import { db } from './localDBService';

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
 * Calculates the current study streak from study logs.
 * @param logs An array of study log entries.
 * @returns The number of consecutive days of study.
 */
export const calculateStreak = (logs: StudyLog[]): number => {
  if (logs.length === 0) return 0;

  const uniqueDates = [...new Set(logs.map(log => log.date))].sort().reverse();
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const todayStr = today.toISOString().split('T')[0];
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  let streak = 0;
  let currentDate: Date;

  // Check if today or yesterday is the last study day
  if (uniqueDates[0] === todayStr || uniqueDates[0] === yesterdayStr) {
    currentDate = new Date(`${uniqueDates[0]}T12:00:00Z`); // Use midday to avoid timezone issues
    streak = 1;
  } else {
    return 0; // Streak is broken
  }
  
  for (let i = 1; i < uniqueDates.length; i++) {
    const prevDate = new Date(currentDate);
    prevDate.setDate(prevDate.getDate() - 1);
    if (uniqueDates[i] === prevDate.toISOString().split('T')[0]) {
      streak++;
      currentDate = prevDate;
    } else {
      break;
    }
  }
  return streak;
};


interface AchievementContext {
  allCards: Flashcard[];
  allDecks: Deck[];
  studyLogs: StudyLog[];
  userProfile: UserProfile;
  earnedAchievements: UserAchievement[];
  quizScore?: { score: number; total: number };
}
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
  const streak = calculateStreak(studyLogs);
  if (streak >= 7) award('streak-7');
  if (streak >= 30) award('streak-30');
  
  // 3. Leveling
  if (userProfile.level >= 5) award('level-5');
  if (userProfile.level >= 10) award('level-10');
  
  // 4. Quizzes
  if (quizScore && quizScore.score === quizScore.total && quizScore.total > 0) {
    award('quiz-hero');
  }

  // 5. Deck Mastery (expensive check, do last)
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
  if (newlyEarned.length > 0) {
    await db.userAchievements.bulkAdd(newlyEarned);
  }

  return newlyEarned;
};
