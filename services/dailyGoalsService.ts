import { DailyGoal, UserProfile } from '../types';

interface GoalTemplate {
  id: string;
  type: 'STUDY' | 'QUIZ' | 'STREAK';
  description: (target: number) => string;
  target: number[] | number; // Array of possible targets or a single target
  xp: number;
  minStreak?: number; // Minimum streak required for this goal to be available
}

const GOAL_TEMPLATES: GoalTemplate[] = [
  { id: 'study', type: 'STUDY', description: (t) => `Review ${t} cards`, target: [5, 10], xp: 15 },
  { id: 'study-lg', type: 'STUDY', description: (t) => `Review ${t} cards`, target: [15, 20], xp: 30 },
  { id: 'complete-quiz', type: 'QUIZ', description: () => `Complete 1 practice quiz`, target: 1, xp: 25 },
  { id: 'maintain-streak-3', type: 'STREAK', description: (t) => `Maintain a ${t}-day streak`, target: 3, xp: 50, minStreak: 2 },
  { id: 'maintain-streak-7', type: 'STREAK', description: (t) => `Maintain a ${t}-day streak`, target: 7, xp: 100, minStreak: 6 },
];

const pickRandom = <T>(arr: T[], count: number): T[] => {
  return [...arr].sort(() => 0.5 - Math.random()).slice(0, count);
};

export const generateNewDailyGoals = (streak: number): DailyGoal[] => {
    const availableTemplates = GOAL_TEMPLATES.filter(t => !t.minStreak || streak >= t.minStreak);
    const chosenTemplates = pickRandom(availableTemplates, 3);
    
    return chosenTemplates.map(template => {
        const target = Array.isArray(template.target) ? template.target[Math.floor(Math.random() * template.target.length)] : template.target;
        return {
            id: `${template.id}-${target}`,
            type: template.type,
            description: template.description(target),
            target,
            xp: template.xp,
            progress: 0,
            isComplete: false,
        };
    });
};

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