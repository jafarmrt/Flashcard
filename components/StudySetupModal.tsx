import React, { useState, useMemo } from 'react';
import { Flashcard, StudySessionOptions } from '../types';

interface StudySetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (options: StudySessionOptions) => void;
  cards: Flashcard[];
}

export const StudySetupModal: React.FC<StudySetupModalProps> = ({ isOpen, onClose, onStart, cards }) => {
  const [filter, setFilter] = useState<StudySessionOptions['filter']>('all-due');
  const [limit, setLimit] = useState(20);

  const filteredCards = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISOString = today.toISOString();

    switch (filter) {
      case 'new':
        // Fix: Only show truly new cards (never studied).
        // Cards rated 'Again' have repetition 0 but interval 1. We exclude those.
        return cards.filter(c => c.repetition === 0 && c.interval === 0);
      case 'review':
        // Show cards that are due AND have been studied before (interval > 0 or repetition > 0)
        return cards.filter(c => (c.repetition > 0 || c.interval > 0) && c.dueDate <= todayISOString);
      case 'all-cards':
        return cards; // No filter, return all cards
      case 'all-due':
      default:
        return cards.filter(c => c.dueDate <= todayISOString);
    }
  }, [cards, filter]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStart({ filter, limit: limit > 0 ? limit : Infinity });
  };

  if (!isOpen) {
    return null;
  }

  const cardCount = filteredCards.length;
  const sessionSize = limit > 0 ? Math.min(cardCount, limit) : cardCount;
  
  const filterOptions: { id: StudySessionOptions['filter']; label: string }[] = [
    { id: 'all-due', label: 'All Due Cards' },
    { id: 'new', label: 'New Cards Only' },
    { id: 'review', label: 'Review Cards Only' },
    { id: 'all-cards', label: 'Study All Cards (Cram)' },
  ];

  return (
    <div 
        className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center backdrop-blur-sm" 
        onClick={onClose} 
        role="dialog" 
        aria-modal="true" 
        aria-labelledby="study-setup-title"
    >
      <div 
        className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md m-4 animate-toast-in" 
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 id="study-setup-title" className="text-2xl font-bold text-slate-800 dark:text-slate-100">Setup Study Session</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Customize your learning for today.</p>
        </div>
        
        <form onSubmit={handleSubmit}>
            <div className="p-6 space-y-6">
                {/* Filter Options */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Show Me</label>
                    <div className="space-y-2">
                        {filterOptions.map(({ id, label }) => (
                            <label key={id} className="flex items-center p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50 has-[:checked]:bg-indigo-50 dark:has-[:checked]:bg-indigo-900/30 has-[:checked]:ring-2 has-[:checked]:ring-indigo-500 transition-all">
                                <input 
                                    type="radio"
                                    name="filter"
                                    value={id}
                                    checked={filter === id}
                                    onChange={() => setFilter(id)}
                                    className="h-4 w-4 text-indigo-600 border-slate-300 dark:border-slate-600 focus:ring-indigo-500 bg-transparent"
                                />
                                <span className="ml-3 block text-sm font-medium text-slate-800 dark:text-slate-200">
                                    {label}
                                </span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Card Limit */}
                <div>
                    <label htmlFor="card-limit" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Max Cards in Session
                    </label>
                    <input
                        type="number"
                        id="card-limit"
                        value={limit}
                        onChange={(e) => setLimit(Math.max(0, parseInt(e.target.value, 10)))}
                        min="1"
                        className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Set to 0 for no limit.</p>
                </div>
            </div>

            <div className="p-6 bg-slate-50 dark:bg-slate-900/50 rounded-b-lg flex justify-between items-center">
                <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                    {sessionSize} / {cardCount} cards
                </p>
                <div className="flex gap-3">
                     <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
                        Cancel
                    </button>
                    <button type="submit" disabled={sessionSize === 0} className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm transition-colors disabled:bg-indigo-400 disabled:cursor-not-allowed">
                        Start Studying
                    </button>
                </div>
            </div>
        </form>
      </div>
    </div>
  );
};