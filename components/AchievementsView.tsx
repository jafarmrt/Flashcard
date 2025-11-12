import React from 'react';
import { Achievement, UserAchievement } from '../types';
import { ALL_ACHIEVEMENTS } from '../services/achievements';

interface AchievementsViewProps {
  earnedAchievements: UserAchievement[];
  onBack: () => void;
}

export const AchievementsView: React.FC<AchievementsViewProps> = ({ earnedAchievements, onBack }) => {
  const earnedIds = new Set(earnedAchievements.map(a => a.achievementId));
  // Fix: Explicitly type the Map to prevent its value from being inferred as `unknown`.
  const earnedMap = new Map<string, string>(earnedAchievements.map(a => [a.achievementId, a.dateEarned]));

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-6">Achievements</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {ALL_ACHIEVEMENTS.map(ach => {
          const isEarned = earnedIds.has(ach.id);
          const earnedDate = earnedMap.get(ach.id);
          
          return (
            <div
              key={ach.id}
              className={`p-6 rounded-lg shadow-md transition-all flex flex-col items-center text-center
                ${isEarned 
                  ? 'bg-white dark:bg-slate-800 border-2 border-amber-400' 
                  : 'bg-slate-100 dark:bg-slate-800/50 opacity-70'
                }`}
            >
              <div className={`text-5xl mb-4 ${isEarned ? '' : 'grayscale'}`}>{ach.icon}</div>
              <h3 className={`text-lg font-bold ${isEarned ? 'text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}>
                {ach.name}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 flex-grow">
                {ach.description}
              </p>
              {isEarned && earnedDate && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-4 font-medium">
                  Unlocked on {new Date(earnedDate).toLocaleDateString()}
                </p>
              )}
            </div>
          );
        })}
      </div>
       <div className="text-center mt-8">
            <button onClick={onBack} className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-md hover:bg-indigo-700 transition-colors">
              Back to Settings
            </button>
       </div>
    </div>
  );
};