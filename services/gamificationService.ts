import { StudyLog } from '../types';

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