import React, { useState, useEffect, useRef } from 'react';
import { Flashcard, Deck } from './types';
import { db } from './services/localDBService';
import Header from './components/Header';
import FlashcardList from './components/FlashcardList';
import FlashcardForm from './components/FlashcardForm';
import { StudyView } from './components/StudyView';
import { StatsView } from './components/StatsView';
import { ConversationView } from './components/ConversationView';
import Toast from './components/Toast';
import DeckList from './components/DeckList';
import { ChangelogView } from './components/ChangelogView';

type View = 'LIST' | 'FORM' | 'STUDY' | 'STATS' | 'PRACTICE' | 'SYNC' | 'DECKS' | 'CHANGELOG';
type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
type FlashcardFormData = Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId' | 'isDeleted'>;

// --- API Helper ---
const callProxy = async (action: 'sync-save' | 'sync-load' | 'sync-merge', payload: object) => {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Sync request failed');
    }
    return response.json();
};


// --- SyncView Component ---
const SyncView: React.FC<{ 
    syncKey: string;
    setSyncKey: (key: string) => void;
    syncStatus: SyncStatus;
    lastSyncDate: string | null;
    onLoadFromCloud: () => Promise<void>;
    showToast: (message: string) => void;
}> = ({ syncKey, setSyncKey, syncStatus, lastSyncDate, onLoadFromCloud, showToast }) => {
  const [isLoading, setIsLoading] = useState(false);

  const generateNewKey = () => {
    const adjectives = ['happy', 'blue', 'green', 'brave', 'calm', 'bright', 'clever', 'eager', 'gentle', 'gold', 'silver', 'red'];
    const nouns = ['ocean', 'river', 'fox', 'lion', 'tiger', 'mountain', 'forest', 'cat', 'dog', 'whale', 'sky'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 100);
    const newKey = `${adj}-${noun}-${num}`;
    setSyncKey(newKey);
    showToast('New Sync Key generated and saved!');
  };

  const handleLoad = async () => {
    if (!syncKey) {
      showToast('Please enter your Sync Key first.');
      return;
    }
    if (!confirm('This will overwrite all local data with the data from the cloud. This is intended for setting up a new device. Are you sure?')) {
      return;
    }
    setIsLoading(true);
    await onLoadFromCloud();
    setIsLoading(false);
  };
  
  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newKey = e.target.value.toLowerCase().replace(/\s+/g, '-');
      setSyncKey(newKey);
  }

  const getStatusText = () => {
    switch(syncStatus) {
        case 'syncing': return { text: 'Syncing changes...', icon: '🔄', color: 'text-slate-500 dark:text-slate-400 animate-pulse' };
        case 'synced': return { text: `Synced`, icon: '✅', color: 'text-green-600 dark:text-green-400' };
        case 'error': return { text: 'Sync failed. Check connection.', icon: '⚠️', color: 'text-red-600 dark:text-red-400' };
        default: return { text: 'Changes are saved locally.', icon: '🏠', color: 'text-slate-500 dark:text-slate-400' };
    }
  }
  
  const {text, icon, color} = getStatusText();

  return (
    <div className="max-w-3xl mx-auto bg-white dark:bg-slate-800 p-8 rounded-lg shadow-md space-y-6">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Automatic Cloud Sync</h2>
        <p className="text-slate-600 dark:text-slate-400">
            Your data is now saved automatically to the cloud whenever you make changes. Use the Sync Key below to access your data on other devices.
            <strong className="block mt-2">Important: Save your key! It's the only way to access your data.</strong>
        </p>
        
        <div>
            <label htmlFor="sync-key" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Your Sync Key</label>
            <div className="mt-1 flex gap-2">
                <input 
                    type="text" 
                    id="sync-key"
                    value={syncKey}
                    onChange={handleKeyChange}
                    className="flex-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="enter-your-key-here"
                />
                <button onClick={() => navigator.clipboard.writeText(syncKey)} className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-200 dark:hover:bg-slate-600">Copy</button>
            </div>
             {!syncKey && (
                <button onClick={generateNewKey} className="mt-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                    Don't have a key? Generate one.
                </button>
            )}
        </div>
        
        <div className="border-t border-slate-200 dark:border-slate-700 pt-6 space-y-4">
            <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100">New Device Setup</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
                If you're on a new device, enter your key above and click here to load your data. This will replace any data currently on this device.
            </p>
            <button onClick={handleLoad} disabled={isLoading || !syncKey} className="w-full flex justify-center items-center gap-2 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-wait">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Load & Overwrite Local Data
            </button>
        </div>

        <div className="text-center text-sm text-slate-500 dark:text-slate-400 pt-4">
            <p className={`font-medium ${color}`}>{icon} {text}</p>
            {syncStatus === 'synced' && lastSyncDate && <p className="text-xs mt-1">Last save: {lastSyncDate}</p>}
        </div>
    </div>
  );
};


const convertToCSV = (cards: Flashcard[], decks: Deck[]): string => {
  const decksById = new Map(decks.map(deck => [deck.id, deck.name]));
  
  const headers = [
    'front', 'back', 'deckName', 'pronunciation', 'partOfSpeech', 
    'definition', 'exampleSentenceTarget', 'notes'
  ];

  const escapeCSV = (value: string | undefined): string => {
    if (value === undefined || value === null) return '';
    let str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      str = `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = cards.map(card => {
    const rowData = {
      front: card.front,
      back: card.back,
      deckName: decksById.get(card.deckId) || 'Unknown',
      pronunciation: card.pronunciation,
      partOfSpeech: card.partOfSpeech,
      definition: card.definition,
      exampleSentenceTarget: card.exampleSentenceTarget,
      notes: card.notes,
    };
    return headers.map(header => escapeCSV(rowData[header as keyof typeof rowData])).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
};

const FloatingActionButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    onClick={onClick}
    className="md:hidden fixed bottom-20 right-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg animate-fab-in"
    aria-label="Add new card"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  </button>
);

const BottomNav: React.FC<{ 
  currentView: View; 
  onNavigate: (view: View) => void;
  isStudyDisabled: boolean;
}> = ({ currentView, onNavigate, isStudyDisabled }) => {
  const navItems = [
    { view: 'DECKS' as View, label: 'Decks', icon: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> },
    { view: 'STUDY' as View, label: 'Study', icon: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>, disabled: isStudyDisabled },
    { view: 'PRACTICE' as View, label: 'Practice', icon: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>, disabled: isStudyDisabled },
    { view: 'SYNC' as View, label: 'Sync', icon: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9V3M3 12a9 9 0 0 1 9-9"/></svg> },
  ];
  
  const isActive = (view: View) => {
      if (view === 'DECKS' && (currentView === 'LIST' || currentView === 'DECKS')) return true;
      return currentView === view;
  }

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex justify-around z-20">
      {navItems.map(item => (
        <button 
          key={item.label}
          onClick={() => onNavigate(item.view)}
          disabled={item.disabled}
          className={`flex flex-col items-center justify-center p-2 w-full text-xs transition-colors ${isActive(item.view) ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'} disabled:opacity-40`}
        >
          {item.icon}
          <span className="mt-1">{item.label}</span>
        </button>
      ))}
    </nav>
  );
};


const App: React.FC = () => {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [view, setView] = useState<View>('DECKS');
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [syncKey, setSyncKey] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(null);
  const [studyDeckId, setStudyDeckId] = useState<string | null>(null);
  
  const isInitialMount = useRef(true);

  const fetchData = async () => {
    const allCards = await db.flashcards.toArray();
    const allDecks = await db.decks.toArray();
    setFlashcards(allCards);
    setDecks(allDecks);
    return { cards: allCards, decks: allDecks };
  };

  const handleLoadFromCloud = async () => {
    const key = localStorage.getItem('syncKey');
    if (!key) return;

    setSyncStatus('syncing');
    try {
      const response = await callProxy('sync-load', { syncKey: key });
      if (response.data) {
        const { decks, cards } = response.data;
        await db.transaction('rw', db.decks, db.flashcards, async () => {
          await db.decks.clear();
          await db.flashcards.clear();
          await db.decks.bulkPut(decks);
          await db.flashcards.bulkPut(cards);
        });
        await fetchData(); // Refresh state from DB
        showToast('Data loaded successfully from cloud!');
        setSyncStatus('synced');
      } else {
        showToast('No data found in the cloud for this key.');
        setSyncStatus('idle');
      }
    } catch (error) {
      console.error("Failed to load from cloud", error);
      showToast('Failed to load data from cloud. Using local data.');
      setSyncStatus('error');
    }
  };
  
  // Effect for initial load
  useEffect(() => {
    const savedKey = localStorage.getItem('syncKey') || '';
    setSyncKey(savedKey);
    const lastSync = localStorage.getItem('lastSyncDate');
     if (lastSync) {
      setLastSyncDate(new Date(lastSync).toLocaleString());
    }
    
    const initialLoad = async () => {
        await fetchData();
    };
    initialLoad().then(() => {
        isInitialMount.current = false;
    });
  }, []);

  // Effect for debounced auto-syncing with MERGE strategy
  useEffect(() => {
    if (isInitialMount.current || !syncKey) {
        setSyncStatus('idle');
        return;
    };

    setSyncStatus('syncing');

    const handler = setTimeout(async () => {
      try {
        const localData = { decks, cards: flashcards };
        const response = await callProxy('sync-merge', { syncKey, data: localData });
        
        const { data: mergedData } = response;

        if (mergedData && mergedData.cards && mergedData.decks) {
            const localDataString = JSON.stringify({ decks, cards: flashcards });
            const remoteDataString = JSON.stringify({ decks: mergedData.decks, cards: mergedData.cards });

            // Only update local state if the authoritative data from the server is different.
            // This is the key to breaking the sync loop that caused the continuous spinner and study view jumps.
            if (localDataString !== remoteDataString) {
                await db.transaction('rw', db.decks, db.flashcards, async () => {
                    // Overwrite local data with the authoritative merged version from the cloud
                    await db.decks.clear();
                    await db.flashcards.clear();
                    await db.decks.bulkPut(mergedData.decks);
                    await db.flashcards.bulkPut(mergedData.cards);
                });
                // Update React state. This will cause one final, safe re-run of the effect.
                // On the next run, the string comparison will match, and the loop will terminate.
                setFlashcards(mergedData.cards);
                setDecks(mergedData.decks);
            }
        }

        const now = new Date();
        localStorage.setItem('lastSyncDate', now.toISOString());
        setLastSyncDate(now.toLocaleString());
        setSyncStatus('synced');
      } catch (error) {
        console.error('Auto-sync failed:', error);
        setSyncStatus('error');
      }
    }, 2000); // 2-second debounce delay

    return () => {
      clearTimeout(handler);
    };
  }, [flashcards, decks, syncKey]);


  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };
  
  const updateSyncKey = (newKey: string) => {
      setSyncKey(newKey);
      localStorage.setItem('syncKey', newKey);
  }

  const handleAddCard = () => {
    setEditingCard(null);
    setView('FORM');
  };

  const handleEditCard = (card: Flashcard) => {
    setEditingCard(card);
    setView('FORM');
  };

  const handleDeleteCard = async (id: string) => {
    // Soft delete: mark as deleted instead of removing
    await db.flashcards.update(id, { isDeleted: true });
    await fetchData(); // Re-fetch to trigger sync
    showToast('Card deleted successfully!');
  };

  const handleSaveCard = async (cardData: FlashcardFormData, deckName: string) => {
    const trimmedDeckName = deckName.trim();
    if (!trimmedDeckName) {
      showToast('Deck name cannot be empty.');
      return;
    }
    
    const allDecks = await db.decks.toArray();
    let deck = allDecks.find(d => d.name.toLowerCase() === trimmedDeckName.toLowerCase() && !d.isDeleted);

    if (!deck) {
      const newDeck: Deck = { id: Date.now().toString(), name: trimmedDeckName };
      await db.decks.add(newDeck);
      deck = newDeck;
    }
    
    if (editingCard) {
      const updatedCard: Flashcard = { ...editingCard, ...cardData, deckId: deck.id };
      await db.flashcards.put(updatedCard);
      showToast('Card updated successfully!');
    } else {
      const newCard: Flashcard = {
        ...cardData,
        id: Date.now().toString(),
        deckId: deck.id,
        repetition: 0,
        easinessFactor: 2.5,
        interval: 0,
        dueDate: new Date().toISOString(),
      };
      await db.flashcards.add(newCard);
      showToast('Card added successfully!');
    }
    await fetchData(); // Re-fetch to trigger sync
    setEditingCard(null);
    setView('DECKS');
  };
  
  const handleSessionEnd = async (updatedCardsFromSession: Flashcard[]) => {
    if (updatedCardsFromSession.length > 0) {
      await db.flashcards.bulkPut(updatedCardsFromSession);
    }
    await fetchData(); // Re-fetch to trigger sync
    setView('DECKS');
    showToast('Study session complete. Progress saved!');
  };

  const handleExportCSV = (cardsToExport: Flashcard[]) => {
    try {
      const date = new Date().toISOString().split('T')[0];
      const a = document.createElement('a');
      document.body.appendChild(a);
      a.style.display = 'none';

      if (cardsToExport.length === 0) {
        showToast('No cards in the current view to export.');
        return;
      }
      const csvData = convertToCSV(cardsToExport, decks);
      const blob = new Blob([`\uFEFF${csvData}`], { type: 'text/csv;charset=utf-8;' }); // Add BOM for Excel
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `lingua-cards-export-${date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Current view exported as CSV!');

      document.body.removeChild(a);
    } catch (error) {
        console.error('Export failed:', error);
        showToast('Export failed.');
    }
  };
  
  const handleStudyDeck = (deckId: string) => {
    setStudyDeckId(deckId);
    setView('STUDY');
  };
  
  const handleNavigate = (newView: View) => {
    if (newView === 'STUDY') {
      setStudyDeckId(null); // Reset to study all decks when clicking header button
    }
    if (newView === 'LIST' && view !== 'LIST') {
        // When navigating back to list, default to decks view for better mobile UX
        setView('DECKS');
        return;
    }
    setView(newView);
  }

  const handleRenameDeck = async (deckId: string, newName: string) => {
    const existingDeck = decks.find(d => d.name.toLowerCase() === newName.toLowerCase() && !d.isDeleted);
    if (existingDeck && existingDeck.id !== deckId) {
        showToast('A deck with this name already exists.');
        return;
    }

    await db.decks.update(deckId, { name: newName });
    await fetchData(); // Re-fetch to update state and trigger sync
    showToast('Deck renamed successfully!');
  };

  const handleDeleteDeck = async (deckId: string) => {
    // Soft delete the deck and all its cards
    const cardIdsToSoftDelete = flashcards
      .filter(card => card.deckId === deckId)
      .map(card => card.id);
    
    const cardUpdates = cardIdsToSoftDelete.map(id => db.flashcards.update(id, { isDeleted: true }));

    await Promise.all([
        ...cardUpdates,
        db.decks.update(deckId, { isDeleted: true })
    ]);

    await fetchData(); // Re-fetch to update state and trigger sync
    showToast('Deck and its cards deleted successfully!');
  };

  const visibleFlashcards = flashcards.filter(c => !c.isDeleted);
  const visibleDecks = decks.filter(d => !d.isDeleted);

  const renderContent = () => {
    switch (view) {
      case 'STUDY':
        const allCardsForStudy = studyDeckId ? visibleFlashcards.filter(card => card.deckId === studyDeckId) : visibleFlashcards;
        return <StudyView cards={allCardsForStudy} onExit={handleSessionEnd} />;
      case 'PRACTICE':
        return <ConversationView cards={visibleFlashcards} />;
      case 'SYNC':
        return <SyncView 
                    syncKey={syncKey} 
                    setSyncKey={updateSyncKey} 
                    syncStatus={syncStatus} 
                    lastSyncDate={lastSyncDate}
                    onLoadFromCloud={handleLoadFromCloud}
                    showToast={showToast}
                />;
       case 'DECKS':
        return <DeckList 
            decks={visibleDecks} 
            cards={visibleFlashcards} 
            onStudyDeck={handleStudyDeck}
            onRenameDeck={handleRenameDeck}
            onDeleteDeck={handleDeleteDeck}
            onViewAllCards={() => setView('LIST')}
        />;
      case 'FORM':
        const editingCardDeckName = visibleDecks.find(d => d.id === editingCard?.deckId)?.name || '';
        return <FlashcardForm card={editingCard} decks={visibleDecks} onSave={handleSaveCard} onCancel={() => setView('DECKS')} initialDeckName={editingCardDeckName}/>;
      case 'STATS':
        return <StatsView onBack={() => setView('DECKS')} />;
      case 'CHANGELOG':
        return <ChangelogView onBack={() => setView('DECKS')} />;
      case 'LIST':
      default:
        return <FlashcardList cards={visibleFlashcards} decks={visibleDecks} onEdit={handleEditCard} onDelete={handleDeleteCard} onExportCSV={handleExportCSV} onBackToDecks={() => setView('DECKS')} />;
    }
  };

  return (
    <div className="min-h-screen font-sans flex flex-col">
      <Header 
        onNavigate={handleNavigate} 
        onAddCard={handleAddCard}
        isStudyDisabled={visibleFlashcards.length === 0}
        currentView={view}
        syncStatus={syncStatus}
      />
      <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full pb-24 md:pb-8">
        {renderContent()}
      </main>
      
      {['LIST', 'DECKS'].includes(view) && <FloatingActionButton onClick={handleAddCard} />}
      <BottomNav currentView={view} onNavigate={handleNavigate} isStudyDisabled={visibleFlashcards.length === 0} />
      
      {toastMessage && <Toast message={toastMessage} />}
      <footer className="text-center py-4 pb-20 md:pb-4 text-xs text-slate-400 dark:text-slate-500">
         <button onClick={() => handleNavigate('CHANGELOG')} className="hover:underline">
            Version 1.8.0 - View Changelog
        </button>
      </footer>
    </div>
  );
};

export default App;