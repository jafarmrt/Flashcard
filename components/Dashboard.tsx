import React from 'react';
import { UserProfile } from '../types';
import { StreakCounter, LevelProgressBar, DailyGoalsSummary } from './GamificationWidgets';

interface DashboardProps {
    userProfile: UserProfile;
    streak: number;
}

export const Dashboard: React.FC<DashboardProps> = ({ userProfile, streak }) => {
    return (
        <div className="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-lg shadow-sm flex flex-col md:flex-row items-stretch gap-6">
            <div className="flex-1">
                <LevelProgressBar userProfile={userProfile} />
            </div>
            <div className="flex items-center justify-around md:justify-end gap-6">
                <StreakCounter streak={streak} />
                {userProfile.dailyGoals && userProfile.dailyGoals.goals.length > 0 && (
                    <>
                        <div className="w-px bg-slate-200 dark:bg-slate-700 h-10 self-center hidden sm:block"></div>
                        <DailyGoalsSummary goals={userProfile.dailyGoals.goals} />
                    </>
                )}
            </div>
        </div>
    );
};
