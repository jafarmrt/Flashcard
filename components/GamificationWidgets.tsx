import React from 'react';
import { UserProfile } from '../types';
import { calculateLevel } from '../services/gamificationService';

export const StreakCounter: React.FC<{ streak: number }> = ({ streak }) => (
    <div className="flex items-center gap-2 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-4 py-2 rounded-full">
        <span className="text-xl">🔥</span>
        <span className="text-lg font-bold">{streak}</span>
        <span className="font-medium text-sm">Day Streak</span>
    </div>
);

export const LevelProgressBar: React.FC<{ userProfile: UserProfile }> = ({ userProfile }) => {
    const { level, progress, xpForNextLevel, xp } = calculateLevel(userProfile.xp);
    
    return (
        <div className="flex-1">
            <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Level {level}</span>
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{xp} / {xpForNextLevel} XP</span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5">
                <div className="bg-indigo-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
            </div>
        </div>
    );
};