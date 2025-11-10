import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Flashcard } from '../types';
import { calculateSrs, PerformanceRating } from '../services/srsService';
import { db } from '../services/localDBService';
import { levenshtein } from '../services/stringSimilarity';

interface StudyViewProps {
  cards: Flashcard[];
  onExit: (updatedCards: Flashcard[]) => void;
}

const SpeakerIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>;

const FlashcardComponent: React.FC<{ card: Flashcard; isFlipped: boolean; }> = ({ card, isFlipped }) => {
  const playAudio = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (card.audioSrc) {
      const audio = new Audio(card.audioSrc);
      audio.play().catch(error => console.error("Audio playback failed:", error));
    }
  };

  return (
    <div className="w-full h-full" style={{ perspective: '1000px' }}>
      <div className="relative w-full h-full transition-transform duration-500" style={{ transformStyle: 'preserve-3d', transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
        {/* Front */}
        <div className="absolute w-full h-full bg-white dark:bg-slate-800 rounded-lg shadow-xl flex flex-col justify-center items-center p-6" style={{ backfaceVisibility: 'hidden' }}>
          {card.audioSrc && (
            <button onClick={playAudio} aria-label="Play pronunciation" className="absolute top-4 right-4 text-slate-400 hover:text-indigo-500 transition-colors">
              <SpeakerIcon />
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
            {card.definition && card.definition.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-indigo-200 uppercase tracking-wider">Definition(s)</p>
                    <ol className="list-decimal list-inside space-y-1 mt-1">
                      {card.definition.map((def, i) => <li key={i} className="text-md text-indigo-50">{def}</li>)}
                    </ol>
                </div>
            )}

            {card.exampleSentenceTarget && card.exampleSentenceTarget.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-indigo-200 uppercase tracking-wider">Example(s)</p>
                     <ul className="space-y-1 mt-1">
                      {card.exampleSentenceTarget.map((ex, i) => <li key={i} className="italic text-indigo-50">"{ex}"</li>)}
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

export const StudyView: React.FC<StudyViewProps> = ({ cards, onExit }) => {
  const [sessionQueue, setSessionQueue] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [updatedCards, setUpdatedCards] = useState<Map<string, Flashcard>>(new Map());
  const [sessionComplete, setSessionComplete] = useState(false);
  const [dueCardCount, setDueCardCount] = useState(0);
  const [studyMode, setStudyMode] = useState<'flip' | 'type'>('flip');
  const [typedAnswer, setTypedAnswer] = useState('');
  const [answerState, setAnswerState] = useState<'correct' | 'incorrect' | null>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);

  const setupSession = (cardSet: Flashcard[]) => {
    const shuffled = [...cardSet];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setSessionQueue(shuffled);
    setCurrentIndex(0);
    setIsFlipped(false);
    setSessionComplete(false);
    setTypedAnswer('');
    setAnswerState(null);
  };
  
  useEffect(() => {
    // Optimization: To prevent freezing with large datasets, we avoid creating
    // a new Date object for every card. Instead, we get today's ISO string
    // once and perform a much faster string comparison.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISOString = today.toISOString();
    
    const dueCards = cards.filter(c => c.dueDate <= todayISOString);
    setDueCardCount(dueCards.length);

    if (dueCards.length > 0) {
      setupSession(dueCards);
    } else {
      setSessionComplete(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (studyMode === 'type' && !isFlipped) {
      answerInputRef.current?.focus();
    }
  }, [currentIndex, studyMode, isFlipped]);


  const handleRating = async (rating: PerformanceRating) => {
    if (!currentCard) return;

    await db.studyHistory.add({
      cardId: currentCard.id,
      date: new Date().toISOString().split('T')[0],
      rating: rating,
    });

    const updatedCard = calculateSrs(currentCard, rating);
    setUpdatedCards(prev => new Map(prev).set(updatedCard.id, updatedCard));
    
    let newQueue = [...sessionQueue];
    if (rating === 'AGAIN') {
      const reAddIndex = Math.min(currentIndex + 5, newQueue.length);
      newQueue.splice(reAddIndex, 0, currentCard);
      setSessionQueue(newQueue);
    }

    setIsFlipped(false);
    setTimeout(() => {
      if (currentIndex + 1 < newQueue.length) {
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
          {dueCardCount > 0 ? "Session Complete!" : "You're all caught up!"}
        </h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
            {dueCardCount > 0 ? `You reviewed ${dueCardCount} card${dueCardCount > 1 ? 's' : ''}.` : "No cards are due for review today."}
        </p>
        <div className="mt-6 flex justify-center gap-4">
            <button onClick={() => onExit(Array.from(updatedCards.values()))} className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-md hover:bg-indigo-700 transition-colors">
              Back to List
            </button>
             <button onClick={() => setupSession(cards)} className="px-6 py-2 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold shadow-md hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors">
              Study All Cards
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
