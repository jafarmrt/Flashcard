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

type View = 'LIST' | 'FORM' | 'STUDY' | 'STATS' | 'PRACTICE';

type FlashcardFormData = Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId'>;

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

  const handleExport = async (format: 'json' | 'csv', cardsToExport?: Flashcard[]) => {
    try {
      const date = new Date().toISOString().split('T')[0];
      const a = document.createElement('a');
      document.body.appendChild(a);
      a.style.display = 'none';

      if (format === 'json') {
          const allCards = await db.flashcards.toArray();
          const allDecks = await db.decks.toArray();
          const exportData = {
              decks: allDecks,
              cards: allCards,
          };
          const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          a.href = url;
          a.download = `lingua-cards-backup-${date}.json`;
          a.click();
          URL.revokeObjectURL(url);
          showToast('Full backup exported successfully!');
      } else if (format === 'csv' && cardsToExport) {
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
      }
      document.body.removeChild(a);
    } catch (error) {
        console.error('Export failed:', error);
        showToast('Export failed.');
    }
  };

  const handleImport = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const data = JSON.parse(event.target?.result as string);
            if (!data.decks || !data.cards) {
                throw new Error('Invalid file format.');
            }
            await db.transaction('rw', db.decks, db.flashcards, async () => {
                await db.decks.bulkPut(data.decks);
                await db.flashcards.bulkPut(data.cards);
            });
            await fetchData(); // Refresh data from DB
            showToast('Import successful!');
        } catch (error) {
            console.error('Import failed:', error);
            showToast(`Import failed: ${error.message}`);
        }
    };
    reader.readAsText(file);
  };

  const renderContent = () => {
    switch (view) {
      case 'STUDY':
        return <StudyView cards={flashcards} onExit={handleSessionEnd} />;
      case 'PRACTICE':
        return <ConversationView cards={flashcards} />;
      case 'FORM':
        const editingCardDeckName = decks.find(d => d.id === editingCard?.deckId)?.name || '';
        return <FlashcardForm card={editingCard} decks={decks} onSave={handleSaveCard} onCancel={() => setView('LIST')} initialDeckName={editingCardDeckName}/>;
      case 'STATS':
        return <StatsView onBack={() => setView('LIST')} />;
      case 'LIST':
      default:
        return <FlashcardList cards={flashcards} decks={decks} onEdit={handleEditCard} onDelete={handleDeleteCard} onImport={handleImport} onExport={handleExport} />;
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
        <p>Version 1.1.0</p>
      </footer>
    </div>
  );
};

export default App;