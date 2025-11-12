import React from 'react';
import { UserProfile, DailyGoal } from '../types';
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

export const DailyGoalsSummary: React.FC<{ goals: DailyGoal[] }> = ({ goals }) => {
    const completedCount = goals.filter(g => g.isComplete).length;
    const totalCount = goals.length;
    const allComplete = completedCount === totalCount;

    return (
        <div className={`flex items-center gap-2 ${allComplete ? 'text-green-600 dark:text-green-400' : 'text-slate-600 dark:text-slate-300'}`}>
            {allComplete ? (
                <svg xmlns="http://www.w.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            ) : (
                <svg xmlns="http://www.w.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="m9 12 2 2 4-4"></path></svg>
            )}
            <div className="text-left">
                <p className="text-sm font-bold">{completedCount} / {totalCount}</p>
                <p className="text-xs font-medium">Goals Complete</p>
            </div>
        </div>
    );
};
