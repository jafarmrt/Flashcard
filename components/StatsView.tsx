import React, { useState, useEffect } from 'react';
import { db } from '../services/localDBService';
import { Flashcard, StudyLog } from '../types';
import { calculateStreak } from '../services/gamificationService';

interface Stats {
  streak: number;
  activity: Map<string, number>;
  difficultCards: Flashcard[];
  reviewSoonCards: Flashcard[];
  masteredCards: Flashcard[];
}

const generateDateMap = (days: number): Map<string, number> => {
  const map = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    map.set(dateStr, 0);
  }
  return map;
};

const calculateActivity = (logs: StudyLog[], days: number): Map<string, number> => {
  const activityMap = generateDateMap(days);
  for (const log of logs) {
    if (activityMap.has(log.date)) {
      activityMap.set(log.date, (activityMap.get(log.date) || 0) + 1);
    }
  }
  return activityMap;
};

const getCardAnalytics = (logs: StudyLog[], allCards: Flashcard[]): { difficultCards: Flashcard[], reviewSoonCards: Flashcard[], masteredCards: Flashcard[] } => {
    const cardMap = new Map(allCards.map(c => [c.id, c]));
    
    // Difficult Cards
    const againCounts = new Map<string, number>();
    logs.filter(log => log.rating === 'AGAIN').forEach(log => {
      if (cardMap.has(log.cardId)) { // Only count if the card still exists
        againCounts.set(log.cardId, (againCounts.get(log.cardId) || 0) + 1);
      }
    });
    const difficultCardIds = [...againCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(entry => entry[0]);
    const difficultCards = difficultCardIds.map(id => cardMap.get(id)).filter((c): c is Flashcard => !!c);

    // Review Soon & Mastered Cards
    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);
    
    const reviewSoonCards: Flashcard[] = [];
    const masteredCards: Flashcard[] = [];

    allCards.forEach(card => {
        const dueDate = new Date(card.dueDate);
        if (dueDate > today && dueDate <= nextWeek) {
            reviewSoonCards.push(card);
        }
        if (card.interval > 30) {
            masteredCards.push(card);
        }
    });
    
    reviewSoonCards.sort((a,b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

    return { 
        difficultCards, 
        reviewSoonCards: reviewSoonCards.slice(0, 5),
        masteredCards: masteredCards.slice(0, 5)
    };
};

const WeeklyActivityChart: React.FC<{ activity: Map<string, number> }> = ({ activity }) => {
    const days = 7;
    const today = new Date();
    const barData = [];
    let maxCount = 1; // Avoid division by zero

    // Prepare data for the last 7 days in reverse (Today is last)
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(today.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const count = activity.get(dateStr) || 0;
        maxCount = Math.max(maxCount, count);
        
        // Format label: "M", "T", "W" etc.
        const dayLabel = date.toLocaleDateString('en-US', { weekday: 'narrow' });
        const fullDate = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const isToday = i === 0;
        
        barData.push({ dayLabel, count, fullDate, isToday });
    }

    return (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm">
             <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-slate-500 dark:text-slate-400">Weekly Activity</h3>
                <span className="text-xs font-medium bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-full">Last 7 Days</span>
            </div>
            
            <div className="flex items-end justify-between h-40 gap-2">
                {barData.map((data, index) => {
                    const heightPercentage = Math.max(10, (data.count / maxCount) * 100);
                    
                    return (
                        <div key={index} className="flex-1 flex flex-col items-center gap-2 group cursor-default">
                             <div className="relative w-full flex justify-center items-end h-full">
                                {/* Bar */}
                                <div 
                                    className={`w-full max-w-[24px] rounded-t-md transition-all duration-500 ${data.isToday ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-slate-300 dark:bg-slate-700 group-hover:bg-indigo-400 dark:group-hover:bg-indigo-600'}`}
                                    style={{ height: `${heightPercentage}%` }}
                                ></div>
                                
                                {/* Tooltip */}
                                <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                                     <div className="bg-slate-800 text-white text-xs rounded py-1 px-2 whitespace-nowrap shadow-lg">
                                        {data.count} cards on {data.fullDate}
                                     </div>
                                     <div className="w-2 h-2 bg-slate-800 rotate-45 mx-auto -mt-1"></div>
                                </div>
                             </div>
                             <span className={`text-xs font-medium ${data.isToday ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-500'}`}>
                                {data.dayLabel}
                             </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const StatsSkeleton: React.FC = () => {
    const SkeletonCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm">
            {children}
        </div>
    );
    const SkeletonPlaceholder: React.FC<{ className?: string }> = ({ className }) => (
        <div className={`bg-slate-200 dark:bg-slate-700 rounded ${className || ''}`}></div>
    );

    return (
        <div className="space-y-8 animate-pulse">
            <SkeletonCard>
                <div className="flex flex-col items-center">
                    <SkeletonPlaceholder className="h-6 w-48 mb-2" />
                    <SkeletonPlaceholder className="h-12 w-32" />
                </div>
            </SkeletonCard>
            <SkeletonCard>
                <div className="flex justify-between mb-6">
                     <SkeletonPlaceholder className="h-6 w-32" />
                </div>
                <div className="flex items-end justify-between h-40 gap-2">
                    {Array.from({ length: 7 }).map((_, i) => (
                        <SkeletonPlaceholder key={i} className="w-full max-w-[24px] h-24" />
                    ))}
                </div>
            </SkeletonCard>
            <SkeletonCard>
                <SkeletonPlaceholder className="h-6 w-1/4 mb-4" />
                <div className="flex flex-col md:flex-row gap-8">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex-1 min-w-0">
                            <SkeletonPlaceholder className="h-5 w-1/3 mb-3" />
                            <div className="space-y-2">
                                <SkeletonPlaceholder className="h-10 w-full" />
                                <SkeletonPlaceholder className="h-10 w-full" />
                                <SkeletonPlaceholder className="h-10 w-full" />
                            </div>
                        </div>
                    ))}
                </div>
            </SkeletonCard>
            <div className="flex justify-center">
                 <SkeletonPlaceholder className="h-11 w-40 rounded-lg" />
            </div>
        </div>
    );
};


export const StatsView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      const allLogs = await db.studyHistory.toArray();
      // Bug Fix: Only fetch non-deleted cards to prevent them from appearing in stats.
      // Fix: Use .filter() for non-indexed properties like 'isDeleted'. The .where() clause is for indexed properties and does not support booleans, causing a type error.
      const allCards = await db.flashcards.filter(card => !card.isDeleted).toArray();
      
      const streak = calculateStreak(allLogs);
      const activity = calculateActivity(allLogs, 90); // Keep 90 for calculations if needed later, but display 7
      const { difficultCards, reviewSoonCards, masteredCards } = getCardAnalytics(allLogs, allCards);
      
      setStats({ streak, activity, difficultCards, reviewSoonCards, masteredCards });
      setLoading(false);
    };
    fetchStats();
  }, []);

  if (loading) {
    return <StatsSkeleton />;
  }
  
  if (!stats) {
    return <div className="text-center p-10">Could not load stats.</div>;
  }
  
  const StatCard: React.FC<{ title: string; cards: Flashcard[] }> = ({ title, cards }) => (
    <div className="flex-1 min-w-0">
        <h4 className="text-md font-semibold text-slate-600 dark:text-slate-300 mb-3">{title}</h4>
        {cards.length > 0 ? (
            <ul className="space-y-2">
                {cards.map(card => (
                    <li key={card.id} className="flex justify-between items-center p-2 bg-slate-50 dark:bg-slate-700/50 rounded-md text-sm">
                        <span className="font-medium text-slate-800 dark:text-slate-100 truncate pr-2">{card.front}</span>
                        <span className="text-slate-500 dark:text-slate-400 truncate">{card.back}</span>
                    </li>
                ))}
            </ul>
        ) : (
            <p className="text-center text-slate-500 dark:text-slate-400 py-4 text-sm">Nothing to show yet.</p>
        )}
    </div>
  );

  return (
    <div className="space-y-8">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm text-center">
            <h3 className="text-lg font-medium text-slate-500 dark:text-slate-400">Current Study Streak</h3>
            <p className="text-5xl font-bold text-indigo-500 mt-2">{stats.streak} <span className="text-3xl font-medium text-slate-600 dark:text-slate-300">day{stats.streak !== 1 && 's'}</span></p>
        </div>

        <WeeklyActivityChart activity={stats.activity} />
      
        <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm">
            <h3 className="text-lg font-medium text-slate-500 dark:text-slate-400 mb-4">Knowledge Breakdown</h3>
            <div className="flex flex-col md:flex-row gap-8">
                <StatCard title="Difficult Cards" cards={stats.difficultCards} />
                <StatCard title="Review Soon" cards={stats.reviewSoonCards} />
                <StatCard title="Mastered Cards" cards={stats.masteredCards} />
            </div>
        </div>

       <div className="text-center mt-8">
            <button onClick={onBack} className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-md hover:bg-indigo-700 transition-colors">
              Back to Decks
            </button>
       </div>
    </div>
  );
};