import { DailyGoal, UserProfile } from '../types';
import { DEFAULT_DAILY_REVIEW_GOAL } from './xpRules';

// One fixed goal the user sets (reviews per day) instead of random goals, so
// the daily ring always means the same thing.
export const reviewGoalId = (target: number) => `review-${target}`;

export const generateNewDailyGoals = (_streak: number, reviewTarget: number = DEFAULT_DAILY_REVIEW_GOAL): DailyGoal[] => [{
    id: reviewGoalId(reviewTarget),
    type: 'STUDY',
    description: `${reviewTarget} reviews`,
    target: reviewTarget,
    xp: 30,
    progress: 0,
    isComplete: false,
}];

export const updateGoalProgress = (
    type: 'STUDY' | 'QUIZ' | 'STREAK', 
    value: number, 
    userProfile: UserProfile
): { updatedProfile: UserProfile, xpGained: number, newlyCompletedGoals: DailyGoal[] } => {
    
    if (!userProfile.dailyGoals) return { updatedProfile: userProfile, xpGained: 0, newlyCompletedGoals: [] };

    let xpGained = 0;
    const newlyCompletedGoals: DailyGoal[] = [];
    const updatedGoals = userProfile.dailyGoals.goals.map(goal => {
        if (goal.type === type && !goal.isComplete) {
            // For streak, progress is the current streak value. For others, it's cumulative.
            const newProgress = type === 'STREAK' ? value : goal.progress + value;
            goal.progress = newProgress;
            
            if (newProgress >= goal.target) {
                goal.isComplete = true;
                xpGained += goal.xp;
                newlyCompletedGoals.push(goal);
            }
        }
        return goal;
    });

    const allGoalsNowComplete = updatedGoals.every(g => g.isComplete);
    let allCompleteAwarded = userProfile.dailyGoals.allCompleteAwarded;

    if (allGoalsNowComplete && !allCompleteAwarded && updatedGoals.length > 0) {
        xpGained += 50; // Bonus XP
        allCompleteAwarded = true;
    }

    const updatedProfile: UserProfile = {
        ...userProfile,
        dailyGoals: {
            ...userProfile.dailyGoals,
            goals: updatedGoals,
            allCompleteAwarded: allCompleteAwarded,
        }
    };

    return { updatedProfile, xpGained, newlyCompletedGoals };
};