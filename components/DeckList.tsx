import React, { useState } from 'react';
import { Deck, Flashcard, UserProfile } from '../types';
import { Dashboard } from './Dashboard';
// Fix: Import DailyGoalsWidget to resolve 'Cannot find name' error.
import { DailyGoalsWidget } from './DailyGoalsWidget';

interface DeckListProps {
    decks: Deck[];
    cards: Flashcard[];
    onStudyDeck: (deckId: string) => void;
    onRenameDeck: (deckId: string, newName: string) => Promise<void>;
    onDeleteDeck: (deckId: string) => Promise<void>;
    onViewAllCards: () => void;
    onBulkAdd: () => void;
    userProfile: UserProfile | null;
    streak: number;
}

const StudyIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>;
const RenameIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>;
const DeleteIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;

const DeckCard: React.FC<{
    deck: Deck;
    cardCount: number;
    dueCount: number;
    onStudy: () => void;
    onRename: (newName: string) => Promise<void>;
    onDelete: () => Promise<void>;
}> = ({ deck, cardCount, dueCount, onStudy, onRename, onDelete }) => {
    const [isRenaming, setIsRenaming] = useState(false);
    const [newName, setNewName] = useState(deck.name);

    const handleRename = async () => {
        if (newName.trim() && newName.trim() !== deck.name) {
            await onRename(newName.trim());
        }
        setIsRenaming(false);
    };
    
    const handleDelete = () => {
        if (confirm(`Are you sure you want to delete the deck "${deck.name}"? This will also delete all ${cardCount} cards inside it. This action cannot be undone.`)) {
            onDelete();
        }
    };

    const dueProgress = cardCount > 0 ? (dueCount / cardCount) * 100 : 0;

    return (
        <div className="bg-gradient-to-br from-white to-slate-50 dark:from-slate-800 dark:to-slate-900 rounded-lg shadow-md p-6 flex flex-col justify-between transition-all hover:shadow-lg hover:-translate-y-1 border dark:border-slate-700/50">
            <div>
                {isRenaming ? (
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onBlur={handleRename}
                            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                            autoFocus
                            className="flex-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        />
                         <button onClick={handleRename} className="px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md">Save</button>
                    </div>
                ) : (
                    <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 truncate">{deck.name}</h3>
                )}
                <div className="mt-2 text-sm text-slate-500 dark:text-slate-400 space-y-1">
                    <p>{cardCount} card{cardCount !== 1 && 's'}</p>
                </div>
            </div>

            <div className="my-4">
                <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">DUE FOR REVIEW</span>
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{dueCount} / {cardCount}</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                    <div className="bg-indigo-500 h-2 rounded-full" title={`${dueCount} cards due`} style={{ width: `${dueProgress}%` }}></div>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
                <button
                    onClick={onStudy}
                    disabled={cardCount === 0}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400 disabled:cursor-not-allowed"
                >
                    <StudyIcon /> Study
                </button>
                <div className="flex gap-2">
                    <button onClick={() => setIsRenaming(true)} className="flex-1 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-200 dark:hover:bg-slate-600">
                        <RenameIcon /> <span className="sm:hidden">Rename</span>
                    </button>
                    <button onClick={handleDelete} className="flex-1 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-600/50 rounded-md hover:bg-red-200 dark:hover:bg-red-900/50">
                        <DeleteIcon /> <span className="sm:hidden">Delete</span>
                    </button>
                </div>
            </div>
        </div>
    );
};


const DeckList: React.FC<DeckListProps> = ({ decks, cards, onStudyDeck, onRenameDeck, onDeleteDeck, onViewAllCards, onBulkAdd, userProfile, streak }) => {
    
    if (decks.length === 0) {
        return (
            <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
                <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">No decks found.</h2>
                <p className="mt-2 text-slate-500 dark:text-slate-400">Create a new card to automatically create your first deck, or use the "Sync" page to load decks from the cloud.</p>
            </div>
        );
    }
    
    const today = new Date();
    today.setHours(0,0,0,0);

    const deckData = decks.map(deck => {
        const cardsInDeck = cards.filter(card => card.deckId === deck.id);
        const dueCardsInDeck = cardsInDeck.filter(card => new Date(card.dueDate) <= today);
        return {
            ...deck,
            cardCount: cardsInDeck.length,
            dueCount: dueCardsInDeck.length,
        };
    }).sort((a,b) => a.name.localeCompare(b.name));
    
    const totalCards = cards.length;

    return (
        <div>
            {userProfile && (
                <div className="mb-8">
                    <Dashboard userProfile={userProfile} streak={streak} />
                </div>
            )}
            
            {userProfile?.dailyGoals && userProfile.dailyGoals.goals.length > 0 && !userProfile.dailyGoals.goals.every(g => g.isComplete) && (
                <div className="mb-8">
                    <DailyGoalsWidget goals={userProfile.dailyGoals.goals} />
                </div>
            )}

            <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-6 gap-4">
                 <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100">Your Decks</h2>
                 <div className="flex items-center gap-2">
                    <button onClick={onViewAllCards} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
                        View All {totalCards} Cards
                    </button>
                    <button onClick={onBulkAdd} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
                        Bulk Add
                    </button>
                 </div>
            </div>
           
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {deckData.map(deck => (
                    <DeckCard
                        key={deck.id}
                        deck={deck}
                        cardCount={deck.cardCount}
                        dueCount={deck.dueCount}
                        onStudy={() => onStudyDeck(deck.id)}
                        onRename={(newName) => onRenameDeck(deck.id, newName)}
                        onDelete={() => onDeleteDeck(deck.id)}
                    />
                ))}
            </div>
        </div>
    );
};

export default DeckList;