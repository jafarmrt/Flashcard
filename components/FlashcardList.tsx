import React, { useState, useMemo } from 'react';
import { Flashcard, Deck } from '../types';
import { fetchAudioData } from '../services/dictionaryService';

interface FlashcardListProps {
  cards: Flashcard[];
  decks: Deck[];
  onEdit: (card: Flashcard) => void;
  onDelete: (id: string) => void;
  onBackToDecks: () => void;
  onCompleteCard: (cardId: string) => Promise<void>;
  onAutoFixAll: () => void;
  onStopAutoFix: () => void;
  autoFixProgress: { current: number, total: number } | null;
}

const EditIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>;
const DeleteIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
const SpeakerIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>;
const CompleteIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 3 2.5 5L10 3l2.5 5L15 3l2.5 5L20 3"/><path d="M10 13a2.5 2.5 0 0 0-2.5 2.5V21h5v-5.5A2.5 2.5 0 0 0 10 13Z"/><path d="M5 21h14"/></svg>;
const LoadingIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>;
const SearchIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>;
const MagicWandIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 2 2 2-2 2-2-2 2-2Z"/><path d="m5 17 2 2-2 2-2-2 2-2Z"/><path d="m15 17 2 2-2 2-2-2 2-2Z"/><path d="M14.5 4 2.5 16 5.5 19 17.5 7 14.5 4Z"/><line x1="21.5" y1="11" x2="17.5" y2="7"/></svg>;
const StopIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>;

const MissingInfoIndicator: React.FC<{ card: Flashcard }> = ({ card }) => {
    const missing = [];
    if (!card.audioSrc) missing.push({ key: 'A', title: 'Missing Audio' });
    if (!card.pronunciation) missing.push({ key: 'P', title: 'Missing Pronunciation' });
    if (!card.definition?.length) missing.push({ key: 'D', title: 'Missing Definition' });
    if (!card.exampleSentenceTarget?.length) missing.push({ key: 'E', title: 'Missing Example' });

    if (missing.length === 0) return null;

    return (
        <div className="flex items-center gap-1" title={missing.map(m => m.title).join(', ')}>
            {missing.map(m => (
                <span key={m.key} className="flex items-center justify-center w-4 h-4 text-[10px] font-bold text-slate-500 bg-slate-200 dark:bg-slate-600 dark:text-slate-300 rounded-full">
                    {m.key}
                </span>
            ))}
        </div>
    );
};


const FlashcardList: React.FC<FlashcardListProps> = ({ cards, decks, onEdit, onDelete, onBackToDecks, onCompleteCard, onAutoFixAll, onStopAutoFix, autoFixProgress }) => {
  const [sortKey, setSortKey] = useState<string>('front-asc');
  const [selectedDeckId, setSelectedDeckId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [completingCardId, setCompletingCardId] = useState<string | null>(null);
  const [playingAudioUrl, setPlayingAudioUrl] = useState<string | null>(null);
  const CARDS_PER_PAGE = 100;

  const decksById = useMemo(() => new Map(decks.map(deck => [deck.id, deck.name])), [decks]);

  const filteredCards = useMemo(() => {
    let result = cards;
    
    // 1. Deck Filter
    if (selectedDeckId !== 'all') {
        result = result.filter(card => card.deckId === selectedDeckId);
    }
    
    // 2. Search Filter
    if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        result = result.filter(card => 
            card.front.toLowerCase().includes(query) || 
            card.back.toLowerCase().includes(query)
        );
    }
    
    return result;
  }, [cards, selectedDeckId, searchQuery]);

  const sortedCards = useMemo(() => {
    let sortableCards = [...filteredCards];
    sortableCards.sort((a, b) => {
        switch (sortKey) {
            case 'front-asc':
                return a.front.localeCompare(b.front);
            case 'front-desc':
                return b.front.localeCompare(a.front);
            case 'back-asc':
                return a.back.localeCompare(b.back);
            case 'back-desc':
                return b.back.localeCompare(a.back);
            case 'latest':
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            case 'needs-audio':
                if (!a.audioSrc && b.audioSrc) return -1;
                if (a.audioSrc && !b.audioSrc) return 1;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); // secondary sort
            default:
                return 0;
        }
    });
    return sortableCards;
  }, [filteredCards, sortKey]);

  const paginatedCards = useMemo(() => {
    const startIndex = (currentPage - 1) * CARDS_PER_PAGE;
    return sortedCards.slice(startIndex, startIndex + CARDS_PER_PAGE);
  }, [sortedCards, currentPage]);

  const totalPages = Math.ceil(sortedCards.length / CARDS_PER_PAGE);
  
  // Reset page when filters change
  useMemo(() => {
      setCurrentPage(1);
  }, [selectedDeckId, searchQuery, sortKey]);


  const playAudio = async (audioUrl: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingAudioUrl) return; 
    setPlayingAudioUrl(audioUrl);
    try {
      const dataUrl = await fetchAudioData(audioUrl);
      const audio = new Audio(dataUrl);
      audio.play();
      audio.addEventListener('ended', () => setPlayingAudioUrl(null));
      audio.addEventListener('error', () => setPlayingAudioUrl(null));
    } catch (error) {
      console.error("Failed to play audio:", error);
      setPlayingAudioUrl(null);
    }
  };

  const handleComplete = async (cardId: string) => {
    setCompletingCardId(cardId);
    await onCompleteCard(cardId);
    setCompletingCardId(null);
  };

  if (cards.length === 0) {
    return (
      <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">No flashcards yet!</h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400">Tap the '+' button to create your first one or visit the Settings page to import cards or sync from the cloud.</p>
      </div>
    );
  }
  
  const actionButtonClasses = "w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-slate-200 dark:hover:bg-slate-600";


  return (
    <div>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
             <button onClick={onBackToDecks} className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                Back to Decks
            </button>
            
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
                {autoFixProgress ? (
                     <button onClick={onStopAutoFix} className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md shadow-sm transition-colors">
                        <StopIcon /> Stop ({autoFixProgress.current}/{autoFixProgress.total})
                     </button>
                ) : (
                    <button onClick={onAutoFixAll} className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm transition-colors">
                        <MagicWandIcon /> Auto-Fix All
                    </button>
                )}

                <div className="relative w-full sm:w-auto">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <SearchIcon />
                    </div>
                    <input
                        type="text"
                        placeholder="Search cards..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="block w-full pl-10 pr-3 py-2 text-base border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                    />
                </div>
                
                <select id="deck-filter" value={selectedDeckId} onChange={e => setSelectedDeckId(e.target.value)} className="block w-full sm:w-auto pl-3 pr-10 py-2 text-base border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">
                    <option value="all">All Decks</option>
                    {decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
                </select>
                <select id="sort-order" value={sortKey} onChange={e => setSortKey(e.target.value)} className="block w-full sm:w-auto pl-3 pr-10 py-2 text-base border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">
                    <option value="front-asc">English (A-Z)</option>
                    <option value="front-desc">English (Z-A)</option>
                    <option value="back-asc">Persian (A-Z)</option>
                    <option value="back-desc">Persian (Z-A)</option>
                    <option value="latest">Latest Added</option>
                    <option value="needs-audio">Missing Audio First</option>
                </select>
            </div>
        </div>
        
        {paginatedCards.length === 0 ? (
            <div className="text-center py-10">
                <p className="text-slate-500 dark:text-slate-400">No cards match your search.</p>
            </div>
        ) : (
            <div className="space-y-3">
                {paginatedCards.map((card) => (
                    <div key={card.id} className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 flex justify-between items-center transition-all hover:shadow-md hover:bg-slate-50 dark:hover:bg-slate-700/50">
                        <div className="flex-1 overflow-hidden min-w-0">
                            <p className="text-lg font-semibold text-slate-800 dark:text-slate-100 truncate">{card.front}</p>
                            <p className="text-slate-600 dark:text-slate-400 truncate">{card.back}</p>
                            <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 mt-2">
                                <span title={decksById.get(card.deckId) || 'Unknown'} className="bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full truncate max-w-32">{decksById.get(card.deckId) || 'Unknown'}</span>
                                <MissingInfoIndicator card={card} />
                            </div>
                        </div>
                        <div className="flex flex-shrink-0 gap-1 sm:gap-2 pl-2 items-center">
                            {card.audioSrc && (
                                <button 
                                    onClick={(e) => playAudio(card.audioSrc!, e)} 
                                    disabled={!!playingAudioUrl}
                                    aria-label={`Play audio for ${card.front}`} 
                                    className={`${actionButtonClasses} text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-300 disabled:opacity-50`}
                                >
                                    {playingAudioUrl === card.audioSrc ? <LoadingIcon /> : <SpeakerIcon />}
                                </button>
                            )}
                            <button onClick={() => handleComplete(card.id)} disabled={completingCardId === card.id || !!autoFixProgress} aria-label={`Complete details for ${card.front}`} className={`${actionButtonClasses} text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 disabled:opacity-50 disabled:cursor-wait`}>
                                {completingCardId === card.id ? <LoadingIcon /> : <CompleteIcon />}
                            </button>
                            <button onClick={() => onEdit(card)} aria-label={`Edit ${card.front}`} className={`${actionButtonClasses} text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300`}><EditIcon /></button>
                            <button onClick={() => onDelete(card.id)} aria-label={`Delete ${card.front}`} className={`${actionButtonClasses} text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300`}><DeleteIcon /></button>
                        </div>
                    </div>
                ))}
            </div>
        )}
        
        {totalPages > 1 && (
            <div className="flex justify-center items-center gap-4 mt-6">
                <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="px-4 py-2 text-sm font-medium rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-50">Previous</button>
                <span className="text-sm text-slate-600 dark:text-slate-300">Page {currentPage} of {totalPages}</span>
                <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="px-4 py-2 text-sm font-medium rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-50">Next</button>
            </div>
        )}
    </div>
  );
};

export default FlashcardList;