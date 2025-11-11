import React, { useState, useEffect } from 'react';
import { db } from '../services/localDBService';
import { Flashcard, StudyLog } from '../types';
import { calculateStreak } from '../services/gamificationService';

interface Stats {
  streak: number;
  activity: { date: string; count: number }[];
  difficultCards: Flashcard[];
}

const calculateActivity = (logs: StudyLog[]): { date: string; count: number }[] => {
  const last7Days: { date: string; count: number }[] = [];
  const activityMap = new Map<string, number>();

  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    last7Days.push({ date: dateStr, count: 0 });
    activityMap.set(dateStr, 0);
  }

  for (const log of logs) {
    if (activityMap.has(log.date)) {
      activityMap.set(log.date, (activityMap.get(log.date) || 0) + 1);
    }
  }

  return last7Days.map(day => ({...day, count: activityMap.get(day.date) || 0})).reverse();
};

const getDifficultCards = async (logs: StudyLog[], allCards: Flashcard[]): Promise<Flashcard[]> => {
    const againCounts = new Map<string, number>();
    logs.filter(log => log.rating === 'AGAIN').forEach(log => {
        againCounts.set(log.cardId, (againCounts.get(log.cardId) || 0) + 1);
    });

    const sortedCardIds = [...againCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(entry => entry[0]);

    const cardMap = new Map(allCards.map(c => [c.id, c]));
    return sortedCardIds.map(id => cardMap.get(id)).filter((c): c is Flashcard => c !== undefined);
};


export const StatsView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      const allLogs = await db.studyHistory.toArray();
      const allCards = await db.flashcards.toArray();
      
      const streak = calculateStreak(allLogs);
      const activity = calculateActivity(allLogs);
      const difficultCards = await getDifficultCards(allLogs, allCards);
      
      setStats({ streak, activity, difficultCards });
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
  
  const maxActivity = Math.max(...stats.activity.map(a => a.count), 1);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm">
            <h3 className="text-lg font-medium text-slate-500 dark:text-slate-400">Study Streak</h3>
            <p className="text-5xl font-bold text-indigo-500 mt-2">{stats.streak} <span className="text-3xl font-medium text-slate-600 dark:text-slate-300">day{stats.streak !== 1 && 's'}</span></p>
        </div>
        <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm col-span-1 md:col-span-2">
            <h3 className="text-lg font-medium text-slate-500 dark:text-slate-400 mb-4">Last 7 Days Activity</h3>
            <div className="flex justify-around items-end h-32 gap-2">
                {stats.activity.map(({date, count}) => (
                    <div key={date} className="flex-1 flex flex-col items-center justify-end">
                        <div className="text-sm font-bold">{count}</div>
                        <div className="w-full bg-indigo-500 rounded-t-md hover:bg-indigo-600 transition-colors" style={{ height: `${(count / maxActivity) * 100}%` }} title={`${count} cards on ${date}`}></div>
                        <div className="text-xs text-slate-400 mt-1">{new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</div>
                    </div>
                ))}
            </div>
        </div>
      </div>
      
      <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm">
        <h3 className="text-lg font-medium text-slate-500 dark:text-slate-400 mb-4">Difficult Cards</h3>
        {stats.difficultCards.length > 0 ? (
            <ul className="space-y-3">
                {stats.difficultCards.map(card => (
                    <li key={card.id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-md">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">{card.front}</span>
                        <span className="text-sm text-slate-500 dark:text-slate-400">{card.back}</span>
                    </li>
                ))}
            </ul>
        ) : (
            <p className="text-center text-slate-500 dark:text-slate-400 py-4">No difficult cards identified yet. Keep studying!</p>
        )}
      </div>

       <div className="text-center mt-8">
            <button onClick={onBack} className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-md hover:bg-indigo-700 transition-colors">
              Back to List
            </button>
       </div>
    </div>
  );
};