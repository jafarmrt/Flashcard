import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Flashcard } from '../types';
import { calculateSrs, PerformanceRating } from '../services/srsService';
import { db } from '../services/localDBService';
import { levenshtein } from '../services/stringSimilarity';
import { fetchAudioData } from '../services/dictionaryService';

interface StudyViewProps {
  cards: Flashcard[];
  onExit: (updatedCards: Flashcard[]) => void;
  awardXP: (points: number) => void;
}

const SpeakerIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>;

const FlashcardComponent: React.FC<{ card: Flashcard; isFlipped: boolean; }> = ({ card, isFlipped }) => {
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const playAudio = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (card.audioSrc && !isAudioPlaying) {
      setIsAudioPlaying(true);
      try {
        const dataUrl = await fetchAudioData(card.audioSrc);
        const audio = new Audio(dataUrl);
        audio.play().catch(error => {
            console.error("Audio playback failed:", error);
            setIsAudioPlaying(false);
        });
        audio.onended = () => setIsAudioPlaying(false);
      } catch (error) {
        console.error("Failed to play audio:", error);
        setIsAudioPlaying(false);
      }
    }
  };

  // Fix: Defensively handle legacy data where definition or example could be a string.
  const definitions = Array.isArray(card.definition) ? card.definition : (card.definition ? [String(card.definition)] : []);
  const exampleSentences = Array.isArray(card.exampleSentenceTarget) ? card.exampleSentenceTarget : (card.exampleSentenceTarget ? [String(card.exampleSentenceTarget)] : []);

  return (
    <div className="w-full h-full" style={{ perspective: '1000px' }}>
      <div className="relative w-full h-full transition-transform duration-500" style={{ transformStyle: 'preserve-3d', transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
        {/* Front */}
        <div className="absolute w-full h-full bg-white dark:bg-slate-800 rounded-lg shadow-xl flex flex-col justify-center items-center p-6" style={{ backfaceVisibility: 'hidden' }}>
          {card.audioSrc && (
            <button onClick={playAudio} disabled={isAudioPlaying} aria-label="Play pronunciation" className="absolute top-4 right-4 text-slate-400 hover:text-indigo-500 transition-colors disabled:opacity-50">
              {isAudioPlaying ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                      <line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                  </svg>
              ) : (
                  <SpeakerIcon />
              )}
            </button>
          )}
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">{card.pronunciation}</p>
          <h2 className="text-4xl md:text-5xl font-bold text-center text-slate-800 dark:text-slate-100 break-words">{card.front}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">{card.partOfSpeech}</p>
        </div>
        {/* Back */}
        <div 
          className="absolute w-full h-full bg-indigo-500 dark:bg-indigo-600 rounded-lg shadow-xl flex flex-col p-6 text-white overflow-hidden" 
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          {/* Main Translation */}
          <div className="text-center mb-4 shrink-0">
            <h2 className="text-4xl md:text-5xl font-bold break-words">{card.back}</h2>
            {card.partOfSpeech && <p className="text-lg text-indigo-200 mt-1">{card.partOfSpeech}</p>}
          </div>

          {/* Details Section */}
          <div className="w-full space-y-4 text-left border-t border-indigo-400/50 pt-4 overflow-y-auto">
            {definitions.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-indigo-200 uppercase tracking-wider">Definition(s)</p>
                    <ol className="list-decimal list-inside space-y-1 mt-1">
                      {definitions.map((def, i) => <li key={i} className="text-md text-indigo-50">{def}</li>)}
                    </ol>
                </div>
            )}

            {exampleSentences && exampleSentences.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-indigo-200 uppercase tracking-wider">Example(s)</p>
                     <ul className="space-y-1 mt-1">
                      {exampleSentences.map((ex, i) => <li key={i} className="italic text-indigo-50">"{ex}"</li>)}
                    </ul>
                </div>
            )}

            {card.notes && (
                <div>
                    <p className="text-xs font-semibold text-indigo-200 uppercase tracking-wider">Notes</p>
                    <p className="mt-1 text-indigo-50">{card.notes}</p>
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const StudyView: React.FC<StudyViewProps> = ({ cards, onExit, awardXP }) => {
  const [sessionQueue, setSessionQueue] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [updatedCards, setUpdatedCards] = useState<Map<string, Flashcard>>(new Map());
  const [sessionComplete, setSessionComplete] = useState(false);
  const [initialCardCount, setInitialCardCount] = useState(0);
  const [studyMode, setStudyMode] = useState<'flip' | 'type'>('flip');
  const [typedAnswer, setTypedAnswer] = useState('');
  const [answerState, setAnswerState] = useState<'correct' | 'incorrect' | null>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (cards.length > 0) {
        setSessionQueue(cards);
        setInitialCardCount(cards.length);
        setCurrentIndex(0);
        setIsFlipped(false);
        setSessionComplete(false);
        setTypedAnswer('');
        setAnswerState(null);
    } else {
        setSessionComplete(true);
    }
  }, [cards]);


  useEffect(() => {
    if (studyMode === 'type' && !isFlipped) {
      answerInputRef.current?.focus();
    }
  }, [currentIndex, studyMode, isFlipped]);


  const handleRating = async (rating: PerformanceRating) => {
    if (!currentCard) return;

    // Award XP for successful reviews
    if (rating === 'EASY') awardXP(10);
    if (rating === 'GOOD') awardXP(5);

    await db.studyHistory.add({
      cardId: currentCard.id,
      date: new Date().toISOString().split('T')[0],
      rating: rating,
    });

    const updatedCard = calculateSrs(currentCard, rating);
    setUpdatedCards(prev => new Map(prev).set(updatedCard.id, updatedCard));
    
    let finalQueue = [...sessionQueue];
    if (rating === 'AGAIN') {
      const reAddIndex = Math.min(currentIndex + 5, finalQueue.length);
      finalQueue.splice(reAddIndex, 0, currentCard);
      setSessionQueue(finalQueue);
    }

    setIsFlipped(false);
    setTimeout(() => {
      if (currentIndex + 1 < finalQueue.length) {
        setCurrentIndex(prev => prev + 1);
        setTypedAnswer('');
        setAnswerState(null);
      } else {
        setSessionComplete(true);
      }
    }, 150);
  };

  const handleCheckAnswer = () => {
    const distance = levenshtein(typedAnswer.toLowerCase().trim(), currentCard.back.toLowerCase().trim());
    const isCorrect = distance <= 2; // Allow for small typos
    setAnswerState(isCorrect ? 'correct' : 'incorrect');
    setIsFlipped(true);
  };

  const currentCard = useMemo(() => sessionQueue[currentIndex], [sessionQueue, currentIndex]);

  if (sessionComplete) {
     return (
      <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">
            Session Complete!
        </h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
            {`You reviewed ${initialCardCount} card${initialCardCount > 1 ? 's' : ''}.`}
        </p>
        <div className="mt-6 flex justify-center gap-4">
            <button onClick={() => onExit(Array.from(updatedCards.values()))} className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-md hover:bg-indigo-700 transition-colors">
              Finish Session
            </button>
        </div>
      </div>
    );
  }

  if (!currentCard) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500 dark:text-slate-400">Loading study session...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col items-center">
      <div className="w-full flex justify-between items-center mb-4">
        <p className="text-slate-500 dark:text-slate-400">Card {currentIndex + 1} of {sessionQueue.length}</p>
        <div className="flex items-center gap-2 p-1 bg-slate-200 dark:bg-slate-700 rounded-lg">
            <button onClick={() => setStudyMode('flip')} className={`px-3 py-1 text-sm rounded-md ${studyMode === 'flip' ? 'bg-white dark:bg-slate-600 shadow' : ''}`}>Flip</button>
            <button onClick={() => setStudyMode('type')} className={`px-3 py-1 text-sm rounded-md ${studyMode === 'type' ? 'bg-white dark:bg-slate-600 shadow' : ''}`}>Type</button>
        </div>
      </div>
      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5">
          <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${((currentIndex + 1) / sessionQueue.length) * 100}%` }}></div>
      </div>
      
      <div className="w-full h-80 max-w-2xl cursor-pointer mt-4" onClick={() => studyMode === 'flip' && setIsFlipped(true)}>
        <FlashcardComponent card={currentCard} isFlipped={isFlipped} />
      </div>

      <div className="mt-8 flex flex-col justify-center items-center gap-4 w-full h-20">
        {isFlipped ? (
            <div className="flex justify-center items-center gap-2 sm:gap-4 w-full animate-flip-in">
                 <button onClick={() => handleRating('AGAIN')} className="px-4 sm:px-6 py-3 w-1/3 max-w-xs rounded-lg bg-red-500 text-white font-semibold shadow-md hover:bg-red-600 transition-colors">
                    Again
                </button>
                <button onClick={() => handleRating('GOOD')} className="px-4 sm:px-6 py-3 w-1/3 max-w-xs rounded-lg bg-blue-500 text-white font-semibold shadow-md hover:bg-blue-600 transition-colors">
                    Good
                </button>
                <button onClick={() => handleRating('EASY')} className="px-4 sm:px-6 py-3 w-1/3 max-w-xs rounded-lg bg-green-500 text-white font-semibold shadow-md hover:bg-green-600 transition-colors">
                    Easy
                </button>
            </div>
        ) : studyMode === 'flip' ? (
             <button onClick={() => setIsFlipped(true)} className="px-10 py-3 rounded-lg bg-indigo-600 text-white font-semibold shadow-md hover:bg-indigo-700 transition-colors">
                Show Answer
            </button>
        ) : (
            <form onSubmit={e => { e.preventDefault(); handleCheckAnswer(); }} className="w-full max-w-md flex flex-col items-center">
              <input 
                ref={answerInputRef}
                type="text" 
                value={typedAnswer}
                onChange={e => setTypedAnswer(e.target.value)}
                placeholder="Type the Persian translation..."
                className="w-full text-center px-4 py-3 border-2 rounded-lg bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 focus:ring-indigo-500 focus:border-indigo-500 transition"
              />
               <button type="submit" className="mt-4 px-10 py-3 rounded-lg bg-indigo-600 text-white font-semibold shadow-md hover:bg-indigo-700 transition-colors">
                Check Answer
              </button>
            </form>
        )}
      </div>
        {isFlipped && answerState && (
            <div className={`mt-2 text-lg font-bold ${answerState === 'correct' ? 'text-green-500' : 'text-red-500'}`}>
                {answerState === 'correct' ? 'Correct!' : 'Incorrect.'}
            </div>
        )}
      <button onClick={() => onExit(Array.from(updatedCards.values()))} className="mt-8 text-sm text-slate-500 hover:underline">Exit Study Session</button>
    </div>
  );
};