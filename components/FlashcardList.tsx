import React, { useState, useMemo, useRef } from 'react';
import { Flashcard, Deck } from '../types';

interface FlashcardListProps {
  cards: Flashcard[];
  decks: Deck[];
  onEdit: (card: Flashcard) => void;
  onDelete: (id: string) => void;
  onExportCSV: (cards: Flashcard[]) => void;
  onBackToDecks: () => void;
}

const EditIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>;
const DeleteIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;

const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    const today = new Date();
    today.setHours(0,0,0,0);
    const dateToCompare = new Date(date);
    dateToCompare.setHours(0,0,0,0);

    if (dateToCompare <= today) {
        return <span className="font-semibold text-indigo-500 dark:text-indigo-400">Due Today</span>
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const FlashcardList: React.FC<FlashcardListProps> = ({ cards, decks, onEdit, onDelete, onExportCSV, onBackToDecks }) => {
  const [sortConfig, setSortConfig] = useState<{ key: keyof Flashcard | 'deckName'; direction: 'ascending' | 'descending' }>({ key: 'dueDate', direction: 'ascending' });
  const [selectedDeckId, setSelectedDeckId] = useState<string>('all');
 
  const decksById = useMemo(() => new Map(decks.map(deck => [deck.id, deck.name])), [decks]);

  const filteredCards = useMemo(() => {
    if (selectedDeckId === 'all') return cards;
    return cards.filter(card => card.deckId === selectedDeckId);
  }, [cards, selectedDeckId]);

  const sortedCards = useMemo(() => {
    let sortableCards = [...filteredCards];
    sortableCards.sort((a, b) => {
        const aValue = sortConfig.key === 'deckName' ? decksById.get(a.deckId) : a[sortConfig.key as keyof Flashcard];
        const bValue = sortConfig.key === 'deckName' ? decksById.get(b.deckId) : b[sortConfig.key as keyof Flashcard];

        if (aValue === undefined && bValue === undefined) return 0;
        if (aValue === undefined) return 1;
        if (bValue === undefined) return -1;
        
        let comparison = 0;
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          comparison = aValue.localeCompare(bValue, undefined, { sensitivity: 'base' });
        } else if (typeof aValue === 'number' && typeof bValue === 'number') {
           comparison = aValue - bValue;
        }
        
        return sortConfig.direction === 'ascending' ? comparison : -comparison;
      });
    return sortableCards;
  }, [filteredCards, sortConfig, decksById]);

  if (cards.length === 0) {
    return (
      <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">No flashcards yet!</h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400">Tap the '+' button to create your first one or use the "Sync" page to load cards from the cloud.</p>
      </div>
    );
  }

  return (
    <div>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
             <button onClick={onBackToDecks} className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                Back to Decks
            </button>
            <div className="flex items-center gap-4 w-full md:w-auto">
                <select id="deck-filter" value={selectedDeckId} onChange={e => setSelectedDeckId(e.target.value)} className="block w-full max-w-xs pl-3 pr-10 py-2 text-base border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">
                    <option value="all">All Cards</option>
                    {decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
                </select>
                <button onClick={() => onExportCSV(sortedCards)} className="hidden sm:block px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">Export</button>
            </div>
        </div>

        {/* Card List for Mobile, Table for Desktop */}
        <div className="space-y-3">
            {sortedCards.map((card) => (
                <div key={card.id} className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 flex justify-between items-center transition-all hover:shadow-md hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <div className="flex-1 overflow-hidden">
                        <p className="text-lg font-semibold text-slate-800 dark:text-slate-100 truncate">{card.front}</p>
                        <p className="text-slate-600 dark:text-slate-400 truncate">{card.back}</p>
                        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 mt-2">
                             <span className="bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">{decksById.get(card.deckId) || 'Unknown'}</span>
                             <span>{formatDate(card.dueDate)}</span>
                        </div>
                    </div>
                    <div className="flex gap-2 sm:gap-4 pl-2">
                        <button onClick={() => onEdit(card)} aria-label={`Edit ${card.front}`} className="p-2 text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors rounded-full hover:bg-slate-200 dark:hover:bg-slate-600"><EditIcon /></button>
                        <button onClick={() => onDelete(card.id)} aria-label={`Delete ${card.front}`} className="p-2 text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 transition-colors rounded-full hover:bg-slate-200 dark:hover:bg-slate-600"><DeleteIcon /></button>
                    </div>
                </div>
            ))}
        </div>
    </div>
  );
};

export default FlashcardList;