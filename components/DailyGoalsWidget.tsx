import React from 'react';
import { DailyGoal } from '../types';

interface DailyGoalsWidgetProps {
  goals: DailyGoal[];
}

const CheckIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-green-500">
        <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
);

export const DailyGoalsWidget: React.FC<DailyGoalsWidgetProps> = ({ goals }) => {
    if (!goals || goals.length === 0) {
        return null; // Don't render if there are no goals for the day
    }
    
    const allComplete = goals.every(g => g.isComplete);

    return (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm h-full">
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4">Today's Goals</h3>
            <div className="space-y-4">
                {goals.map(goal => {
                    const progress = Math.min(100, (goal.progress / goal.target) * 100);
                    return (
                        <div key={goal.id}>
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{goal.description}</span>
                                {goal.isComplete ? <CheckIcon /> : <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{goal.progress}/{goal.target}</span>}
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                <div 
                                    className={`h-2 rounded-full transition-all duration-500 ${goal.isComplete ? 'bg-green-500' : 'bg-indigo-500'}`}
                                    style={{ width: `${progress}%` }}
                                ></div>
                            </div>
                        </div>
                    );
                })}
            </div>
            {allComplete && (
                <div className="mt-4 text-center font-semibold text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50 p-3 rounded-md">
                    🎉 All goals for today complete! You earned a bonus 50 XP!
                </div>
            )}
        </div>
    );
};