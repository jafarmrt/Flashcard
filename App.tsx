import React, { useState, useEffect, useCallback } from 'react';
import { db } from './services/localDBService';
import { Flashcard, Deck } from './types';
import Header from './components/Header';
import FlashcardList from './components/FlashcardList';
import FlashcardForm from './components/FlashcardForm';
import { StudyView } from './components/StudyView';
import { StatsView } from './components/StatsView';
import { ConversationView } from './components/ConversationView';
import DeckList from './components/DeckList';

// A simple SyncView placeholder
const SyncView = ({ onBack }: { onBack: () => void }) => (
    <div className="text-center p-10 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">Sync with Cloud</h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400">Cloud sync functionality is not yet implemented in this demo.</p>
        <button onClick={onBack} className="mt-6 px-6 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-md hover:bg-indigo-700 transition-colors">
            Back
        </button>
    </div>
);


type View = 'LIST' | 'STUDY' | 'STATS' | 'FORM' | 'PRACTICE' | 'SYNC' | 'DECKS';
type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

const sampleVerbs = ['be', 'have', 'do', 'say', 'go', 'get', 'make', 'know', 'think', 'take', 'see', 'come', 'want', 'look', 'use', 'find', 'give', 'tell', 'work', 'call', 'try', 'ask', 'need', 'feel', 'become', 'leave', 'put', 'mean', 'keep', 'let', 'begin', 'seem', 'help', 'talk', 'turn', 'start', 'show', 'hear', 'play', 'run', 'move', 'like', 'live', 'believe', 'hold', 'bring', 'happen', 'write', 'provide', 'sit'];


const App: React.FC = () => {
    const [cards, setCards] = useState<Flashcard[]>([]);
    const [decks, setDecks] = useState<Deck[]>([]);
    const [currentView, setCurrentView] = useState<View>('DECKS');
    const [selectedCard, setSelectedCard] = useState<Flashcard | null>(null);
    const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');

    const loadData = useCallback(async () => {
        setIsLoading(true);
        // Fix: Dexie's where() clause cannot be used on non-indexed properties, and booleans are not indexable.
        // Switched to filter() to correctly query for items not marked as deleted.
        const allDecks = await db.decks.filter(deck => !deck.isDeleted).toArray();
        const allCards = await db.flashcards.filter(card => !card.isDeleted).toArray();
        setDecks(allDecks);
        setCards(allCards);
        setIsLoading(false);
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleNavigate = (view: View) => {
        if (view === 'FORM') {
            setSelectedCard(null);
        }
        setCurrentView(view);
    };

    const handleAddCard = () => {
        setSelectedCard(null);
        setCurrentView('FORM');
    };

    const handleSaveCard = async (formData: Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId'>, deckName: string) => {
        let deck = decks.find(d => d.name.toLowerCase() === deckName.toLowerCase());
        if (!deck) {
            const newDeckId = crypto.randomUUID();
            deck = { id: newDeckId, name: deckName };
            await db.decks.add(deck);
        }

        if (selectedCard) {
            const updatedCard = { ...selectedCard, ...formData, deckId: deck.id };
            await db.flashcards.put(updatedCard);
        } else {
            const newCard: Flashcard = {
                id: crypto.randomUUID(),
                deckId: deck.id,
                ...formData,
                repetition: 0,
                easinessFactor: 2.5,
                interval: 0,
                dueDate: new Date().toISOString(),
            };
            await db.flashcards.add(newCard);
        }
        await loadData();
        setCurrentView('LIST');
        setSelectedCard(null);
    };

    const handleEditCard = (card: Flashcard) => {
        setSelectedCard(card);
        setCurrentView('FORM');
    };

    const handleDeleteCard = async (id: string) => {
        if (confirm('Are you sure you want to delete this card?')) {
            await db.flashcards.update(id, { isDeleted: true });
            await loadData();
        }
    };
    
    const handleStudyExit = async (updatedCards: Flashcard[]) => {
        if (updatedCards.length > 0) {
            await db.flashcards.bulkPut(updatedCards);
        }
        await loadData(); // Reload data to reflect SRS updates
        setCurrentView('DECKS');
        setSelectedDeckId(null);
    };

    const handleRenameDeck = async (deckId: string, newName: string) => {
        await db.decks.update(deckId, { name: newName });
        await loadData();
    };

    const handleDeleteDeck = async (deckId: string) => {
        const cardsInDeck = await db.flashcards.where('deckId').equals(deckId).toArray();
        const cardIdsToDelete = cardsInDeck.map(c => c.id);
        
        await db.transaction('rw', db.decks, db.flashcards, async () => {
            await db.decks.update(deckId, { isDeleted: true });
            if (cardIdsToDelete.length > 0) {
                const updates = cardIdsToDelete.map(id => ({ key: id, changes: { isDeleted: true } }));
                await db.flashcards.bulkUpdate(updates);
            }
        });

        await loadData();
    };
    
    const handleStudyDeck = (deckId: string) => {
        setSelectedDeckId(deckId);
        setCurrentView('STUDY');
    };

    const handleExportCSV = (cardsToExport: Flashcard[]) => {
        if (cardsToExport.length === 0) {
            alert("There are no cards to export.");
            return;
        }
        const headers = Object.keys(cardsToExport[0]).join(',');
        const rows = cardsToExport.map(card => Object.values(card).map(val => `"${String(val).replace(/"/g, '""')}"`).join(','));
        const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "flashcards.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleAddSampleDeck = async () => {
        const deckName = "50 Common English Verbs";
        let deck = decks.find(d => d.name === deckName);
        if (deck) {
            alert('Sample deck already exists.');
            return;
        }
        
        deck = { id: crypto.randomUUID(), name: deckName };
        await db.decks.add(deck);
        
        const sampleCards: Flashcard[] = sampleVerbs.map(verb => ({
            id: crypto.randomUUID(),
            deckId: deck!.id,
            front: verb,
            back: '', // Will be generated
            repetition: 0,
            easinessFactor: 2.5,
            interval: 0,
            dueDate: new Date().toISOString(),
        }));
        
        await db.flashcards.bulkAdd(sampleCards);
        await loadData();
        alert('Sample deck with 50 common verbs has been added! You can now use the AI to generate details for each card.');
        setCurrentView('LIST');
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueCards = cards.filter(c => new Date(c.dueDate) <= today);
    const isStudyDisabled = dueCards.length === 0 && cards.length === 0;

    const cardsForStudy = selectedDeckId ? cards.filter(c => c.deckId === selectedDeckId) : cards;
    
    const selectedDeck = decks.find(d => d.id === selectedDeckId);
    
    const renderContent = () => {
        if (isLoading) {
            return <div className="text-center p-10">Loading your flashcards...</div>;
        }

        switch (currentView) {
            case 'DECKS':
                return <DeckList 
                    decks={decks} 
                    cards={cards}
                    onStudyDeck={handleStudyDeck}
                    onRenameDeck={handleRenameDeck}
                    onDeleteDeck={handleDeleteDeck}
                    onViewAllCards={() => { setSelectedDeckId(null); setCurrentView('LIST'); }}
                    onAddCard={handleAddCard}
                    onAddSampleDeck={handleAddSampleDeck}
                />;
            case 'LIST':
                return <FlashcardList 
                    cards={cards} 
                    decks={decks}
                    onEdit={handleEditCard} 
                    onDelete={handleDeleteCard}
                    onExportCSV={handleExportCSV}
                    onBackToDecks={() => setCurrentView('DECKS')}
                />;
            case 'FORM':
                return <FlashcardForm 
                    card={selectedCard}
                    decks={decks}
                    onSave={handleSaveCard} 
                    onCancel={() => setCurrentView(selectedCard ? 'LIST' : 'DECKS')}
                    initialDeckName={selectedDeck?.name}
                />;
            case 'STUDY':
                return <StudyView cards={cardsForStudy} onExit={handleStudyExit} />;
            case 'STATS':
                return <StatsView onBack={() => setCurrentView('DECKS')} />;
            case 'PRACTICE':
                return <ConversationView cards={cards} />;
            case 'SYNC':
                return <SyncView onBack={() => setCurrentView('DECKS')} />;
            default:
                return <div>Select a view</div>;
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-50 font-sans">
            <Header
                onNavigate={handleNavigate}
                onAddCard={handleAddCard}
                isStudyDisabled={isStudyDisabled}
                currentView={currentView}
                syncStatus={syncStatus}
            />
            <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                {renderContent()}
            </main>
        </div>
    );
};

export default App;