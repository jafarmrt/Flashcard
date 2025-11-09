import React, { useState, useEffect } from 'react';
import { Flashcard, Deck } from './types';
import { db } from './services/localDBService';
import Header from './components/Header';
import FlashcardList from './components/FlashcardList';
import FlashcardForm from './components/FlashcardForm';
import { StudyView } from './components/StudyView';
import { StatsView } from './components/StatsView';
import { ConversationView } from './components/ConversationView';
import Toast from './components/Toast';

type View = 'LIST' | 'FORM' | 'STUDY' | 'STATS' | 'PRACTICE' | 'SYNC';

type FlashcardFormData = Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId'>;

// --- SyncView Component ---
// This component is placed here to avoid creating a new file, adhering to the constraints.
const SyncView: React.FC<{ onSyncComplete: () => void, showToast: (message: string) => void }> = ({ onSyncComplete, showToast }) => {
  const [syncKey, setSyncKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(null);

  useEffect(() => {
    const savedKey = localStorage.getItem('syncKey');
    if (savedKey) {
      setSyncKey(savedKey);
    }
     const lastSync = localStorage.getItem('lastSyncDate');
    if (lastSync) {
      setLastSyncDate(new Date(lastSync).toLocaleString());
    }
  }, []);

  const callProxy = async (action: 'sync-save' | 'sync-load', payload: object) => {
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

  const generateNewKey = () => {
    const adjectives = ['happy', 'blue', 'green', 'brave', 'calm', 'bright', 'clever', 'eager', 'gentle', 'gold', 'silver', 'red'];
    const nouns = ['ocean', 'river', 'fox', 'lion', 'tiger', 'mountain', 'forest', 'cat', 'dog', 'whale', 'sky'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 100);
    const newKey = `${adj}-${noun}-${num}`;
    setSyncKey(newKey);
    localStorage.setItem('syncKey', newKey);
    showToast('New Sync Key generated and saved!');
  };

  const handleSaveToCloud = async () => {
    if (!syncKey) {
      showToast('Please generate or enter a Sync Key first.');
      return;
    }
    setIsLoading(true);
    setStatus('Saving data to cloud...');
    try {
      const decks = await db.decks.toArray();
      const cards = await db.flashcards.toArray();
      const data = { decks, cards };
      await callProxy('sync-save', { syncKey, data });
      const now = new Date();
      localStorage.setItem('lastSyncDate', now.toISOString());
      setLastSyncDate(now.toLocaleString());
      setStatus('Data saved successfully!');
      showToast('Data saved to cloud!');
    } catch (error) {
      setStatus(`Error: ${error.message}`);
      showToast('Failed to save data.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadFromCloud = async () => {
    if (!syncKey) {
      showToast('Please enter your Sync Key first.');
      return;
    }
    if (!confirm('This will overwrite all local data with the data from the cloud. Are you sure?')) {
      return;
    }
    setIsLoading(true);
    setStatus('Loading data from cloud...');
    try {
      const response = await callProxy('sync-load', { syncKey });
      if (response.data) {
        const { decks, cards } = response.data;
        await db.transaction('rw', db.decks, db.flashcards, async () => {
            await db.decks.clear();
            await db.flashcards.clear();
            await db.decks.bulkPut(decks);
            await db.flashcards.bulkPut(cards);
        });
        onSyncComplete();
        setStatus('Data loaded and synced successfully!');
        showToast('Data loaded successfully!');
      } else {
         setStatus('No data found for this Sync Key.');
         showToast('No data found for this key.');
      }
    } catch (error) {
      setStatus(`Error: ${error.message}`);
      showToast('Failed to load data.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newKey = e.target.value.toLowerCase().replace(/\s+/g, '-');
      setSyncKey(newKey);
      localStorage.setItem('syncKey', newKey);
  }

  return (
    <div className="max-w-3xl mx-auto bg-white dark:bg-slate-800 p-8 rounded-lg shadow-md space-y-6">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Cloud Sync</h2>
        <p className="text-slate-600 dark:text-slate-400">
            Use a Sync Key to save your flashcards to the cloud and load them on another device.
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
        
        <div className="flex flex-col sm:flex-row gap-4">
             <button onClick={handleSaveToCloud} disabled={isLoading || !syncKey} className="flex-1 flex justify-center items-center gap-2 px-4 py-3 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-wait">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Save to Cloud
            </button>
            <button onClick={handleLoadFromCloud} disabled={isLoading || !syncKey} className="flex-1 flex justify-center items-center gap-2 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-wait">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Load from Cloud
            </button>
        </div>
        
        <div className="h-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {isLoading ? <p className="animate-pulse">{status}</p> : <p>{status}</p>}
            {!isLoading && lastSyncDate && <p>Last save: {lastSyncDate}</p>}
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


const App: React.FC = () => {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [view, setView] = useState<View>('LIST');
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fetchData = async () => {
    const allCards = await db.flashcards.toArray();
    const allDecks = await db.decks.toArray();
    setFlashcards(allCards);
    setDecks(allDecks);
  };

  useEffect(() => {
    fetchData();
  }, []);
  
  useEffect(() => {
    if (flashcards.length === 0 && (view === 'STUDY' || view === 'PRACTICE')) {
      setView('LIST');
    }
  }, [flashcards, view]);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleAddCard = () => {
    setEditingCard(null);
    setView('FORM');
  };

  const handleEditCard = (card: Flashcard) => {
    setEditingCard(card);
    setView('FORM');
  };

  const handleDeleteCard = async (id: string) => {
    await db.flashcards.delete(id);
    setFlashcards(flashcards.filter((card) => card.id !== id));
    showToast('Card deleted successfully!');
  };

  const handleSaveCard = async (cardData: FlashcardFormData, deckName: string) => {
    const trimmedDeckName = deckName.trim();
    if (!trimmedDeckName) {
      showToast('Deck name cannot be empty.');
      return;
    }

    let deck = decks.find(d => d.name.toLowerCase() === trimmedDeckName.toLowerCase());

    if (!deck) {
      const newDeck: Deck = { id: Date.now().toString(), name: trimmedDeckName };
      await db.decks.add(newDeck);
      setDecks(prev => [...prev, newDeck]);
      deck = newDeck;
    }
    
    if (editingCard) {
      const updatedCard: Flashcard = { ...editingCard, ...cardData, deckId: deck.id };
      await db.flashcards.put(updatedCard);
      setFlashcards(flashcards.map((c) => (c.id === updatedCard.id ? updatedCard : c)));
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
      setFlashcards([...flashcards, newCard]);
      showToast('Card added successfully!');
    }
    setEditingCard(null);
    setView('LIST');
  };
  
  const handleSessionEnd = async (updatedCardsFromSession: Flashcard[]) => {
    if (updatedCardsFromSession.length > 0) {
      await db.flashcards.bulkPut(updatedCardsFromSession);
       const updatedCardsMap = new Map(updatedCardsFromSession.map(c => [c.id, c]));
      setFlashcards(prevCards => 
        prevCards.map(card => updatedCardsMap.get(card.id) || card)
      );
    }
    setView('LIST');
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

  const renderContent = () => {
    switch (view) {
      case 'STUDY':
        return <StudyView cards={flashcards} onExit={handleSessionEnd} />;
      case 'PRACTICE':
        return <ConversationView cards={flashcards} />;
      case 'SYNC':
        return <SyncView onSyncComplete={fetchData} showToast={showToast} />;
      case 'FORM':
        const editingCardDeckName = decks.find(d => d.id === editingCard?.deckId)?.name || '';
        return <FlashcardForm card={editingCard} decks={decks} onSave={handleSaveCard} onCancel={() => setView('LIST')} initialDeckName={editingCardDeckName}/>;
      case 'STATS':
        return <StatsView onBack={() => setView('LIST')} />;
      case 'LIST':
      default:
        return <FlashcardList cards={flashcards} decks={decks} onEdit={handleEditCard} onDelete={handleDeleteCard} onExportCSV={handleExportCSV} />;
    }
  };

  return (
    <div className="min-h-screen font-sans flex flex-col">
      <Header 
        onNavigate={setView} 
        onAddCard={handleAddCard} 
        isStudyDisabled={flashcards.length === 0}
        currentView={view}
      />
      <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {renderContent()}
      </main>
      {toastMessage && <Toast message={toastMessage} />}
      <footer className="text-center py-4 text-xs text-slate-400 dark:text-slate-500">
        <p>Version 1.2.0 - Cloud Sync Update</p>
      </footer>
    </div>
  );
};

export default App;