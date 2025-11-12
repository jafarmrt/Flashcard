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

const ActivityHeatmap: React.FC<{ activity: Map<string, number> }> = ({ activity }) => {
    const today = new Date();
    const days = 90;
    const weeks = Math.ceil(days / 7);
    const dayCells = [];
    const maxActivity = Math.max(...activity.values(), 1);

    const getIntensityClass = (count: number) => {
        if (count === 0) return 'bg-slate-100 dark:bg-slate-700/50';
        const intensity = count / maxActivity;
        if (intensity > 0.7) return 'bg-indigo-600';
        if (intensity > 0.4) return 'bg-indigo-500';
        if (intensity > 0.1) return 'bg-indigo-400';
        return 'bg-indigo-300';
    };

    const startDate = new Date();
    startDate.setDate(today.getDate() - days + 1);
    const startDayOfWeek = startDate.getDay();

    // Add empty cells for padding at the start
    for (let i = 0; i < startDayOfWeek; i++) {
        dayCells.push(<div key={`pad-${i}`} className="w-4 h-4 rounded-sm"></div>);
    }
    
    for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(today.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const count = activity.get(dateStr) || 0;
        dayCells.push(
            <div 
                key={dateStr}
                className={`w-4 h-4 rounded-sm ${getIntensityClass(count)}`}
                title={`${count} reviews on ${date.toLocaleDateString()}`}
            />
        );
    }

    return (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm">
            <h3 className="text-lg font-medium text-slate-500 dark:text-slate-400 mb-4">Study Habits (Last 90 Days)</h3>
            <div className="grid grid-cols-7 sm:grid-cols-15 md:grid-cols-20 lg:grid-cols-30 gap-1 justify-start">
                {dayCells.reverse()}
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
      const activity = calculateActivity(allLogs, 90);
      const { difficultCards, reviewSoonCards, masteredCards } = getCardAnalytics(allLogs, allCards);
      
      setStats({ streak, activity, difficultCards, reviewSoonCards, masteredCards });
      setLoading(false);
    };
    fetchStats();
  }, []);

  if (loading) {
    return <div className="text-center p-10">Loading stats...</div>;
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

        <ActivityHeatmap activity={stats.activity} />
      
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
              Back to Settings
            </button>
       </div>
    </div>
  );
};
