import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Flashcard, Deck } from '../types';

interface FlashcardListProps {
  cards: Flashcard[];
  decks: Deck[];
  onEdit: (card: Flashcard) => void;
  onDelete: (id: string) => void;
  onImport: (file: File) => void;
  onExport: (format: 'json' | 'csv', cards?: Flashcard[]) => void;
}

const EditIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>;
const DeleteIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
const SortIcon = ({ direction }: { direction: 'ascending' | 'descending' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`inline-block ml-1 transition-transform duration-200 ${direction === 'descending' ? 'rotate-180' : ''}`} >
    <path d="m6 15 6-6 6 6" />
  </svg>
);

const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    const today = new Date();
    today.setHours(0,0,0,0);
    const dateToCompare = new Date(date);
    dateToCompare.setHours(0,0,0,0);

    if (dateToCompare <= today) {
        return <span className="font-semibold text-indigo-500 dark:text-indigo-400">Due Today</span>
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const FlashcardList: React.FC<FlashcardListProps> = ({ cards, decks, onEdit, onDelete, onImport, onExport }) => {
  const [sortConfig, setSortConfig] = useState<{ key: keyof Flashcard | 'deckName'; direction: 'ascending' | 'descending' }>({ key: 'dueDate', direction: 'ascending' });
  const [selectedDeckId, setSelectedDeckId] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

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

  const requestSort = (key: keyof Flashcard | 'deckName') => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onImport(file);
    }
  };
  
  if (cards.length === 0) {
    return (
      <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">No flashcards yet!</h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400">Click "Add Card" to create your first one, or import an existing set.</p>
        <div className="mt-6">
            <input type="file" ref={fileInputRef} onChange={handleFileImport} accept=".json" className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors">
                Import Cards
            </button>
        </div>
      </div>
    );
  }

  return (
    <div>
        <div className="flex justify-between items-center mb-4">
            <div>
                <label htmlFor="deck-filter" className="sr-only">Filter by deck</label>
                <select id="deck-filter" value={selectedDeckId} onChange={e => setSelectedDeckId(e.target.value)} className="block w-full max-w-xs pl-3 pr-10 py-2 text-base border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">
                    <option value="all">All Decks</option>
                    {decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
                </select>
            </div>
            <div className="flex gap-2">
                 <input type="file" ref={fileInputRef} onChange={handleFileImport} accept=".json" className="hidden" />
                <button onClick={() => fileInputRef.current?.click()} className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">Import</button>
                <div className="relative" ref={exportMenuRef}>
                    <button onClick={() => setIsExportMenuOpen(prev => !prev)} className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">Export</button>
                     {isExportMenuOpen && (
                        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-700 rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-10">
                        <div className="py-1">
                            <button onClick={() => { onExport('json'); setIsExportMenuOpen(false); }} className="block w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600">
                            Full Backup (.json)
                            </button>
                            <button onClick={() => { onExport('csv', sortedCards); setIsExportMenuOpen(false); }} className="block w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600">
                            Export View (.csv)
                            </button>
                        </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
        <div className="overflow-x-auto">
        <div className="inline-block min-w-full align-middle">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
            <table className="min-w-full divide-y divide-slate-300 dark:divide-slate-700">
                <thead className="bg-slate-100 dark:bg-slate-800">
                <tr>
                    <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-slate-900 dark:text-slate-100 sm:pl-6">
                    <button onClick={() => requestSort('front')} className="flex items-center gap-1 group">
                        Target (English)
                        {sortConfig.key === 'front' && <SortIcon direction={sortConfig.direction} />}
                    </button>
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <button onClick={() => requestSort('back')} className="flex items-center gap-1 group">
                        Native (Persian)
                        {sortConfig.key === 'back' && <SortIcon direction={sortConfig.direction} />}
                    </button>
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900 dark:text-slate-100 hidden sm:table-cell">
                     <button onClick={() => requestSort('deckName')} className="flex items-center gap-1 group">
                        Deck
                        {sortConfig.key === 'deckName' && <SortIcon direction={sortConfig.direction} />}
                    </button>
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-slate-900 dark:text-slate-100 hidden md:table-cell">
                    <button onClick={() => requestSort('dueDate')} className="flex items-center gap-1 group">
                        Next Review
                        {sortConfig.key === 'dueDate' && <SortIcon direction={sortConfig.direction} />}
                    </button>
                    </th>
                    <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                    <span className="sr-only">Actions</span>
                    </th>
                </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-800/50">
                {sortedCards.map((card) => (
                    <tr key={card.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-slate-900 dark:text-slate-100 sm:pl-6">{card.front}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-500 dark:text-slate-400">{card.back}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-500 dark:text-slate-400 hidden sm:table-cell">{decksById.get(card.deckId) || 'Unknown'}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-slate-500 dark:text-slate-400 hidden md:table-cell">{formatDate(card.dueDate)}</td>
                    <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <div className="flex gap-4 justify-end">
                        <button onClick={() => onEdit(card)} aria-label={`Edit ${card.front}`} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"><EditIcon /></button>
                        <button onClick={() => onDelete(card.id)} aria-label={`Delete ${card.front}`} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 transition-colors"><DeleteIcon /></button>
                        </div>
                    </td>
                    </tr>
                ))}
                </tbody>
            </table>
            </div>
        </div>
        </div>
    </div>
  );
};

export default FlashcardList;