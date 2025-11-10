import React, { useState, useEffect, useMemo } from 'react';
import { Flashcard } from '../types';
import { generateQuizOptions } from '../services/geminiService';

interface QuizViewProps {
  cards: Flashcard[];
}

interface QuizQuestion {
  card: Flashcard;
  options: string[];
  correctAnswer: string;
}

type QuizState = 'loading' | 'ready' | 'cooldown' | 'finished' | 'generating';

const COOLDOWN_HOURS = 6;
const QUIZ_LENGTH = 10;
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

const shuffleArray = <T,>(array: T[]): T[] => {
  return [...array].sort(() => Math.random() - 0.5);
};

export const QuizView: React.FC<QuizViewProps> = ({ cards }) => {
  const [quizState, setQuizState] = useState<QuizState>('loading');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [cooldownTime, setCooldownTime] = useState<number>(0);

  useEffect(() => {
    const lastQuizTime = localStorage.getItem('lastQuizTime');
    if (lastQuizTime) {
      const timeSinceLast = Date.now() - parseInt(lastQuizTime, 10);
      if (timeSinceLast < COOLDOWN_MS) {
        setQuizState('cooldown');
        setCooldownTime(COOLDOWN_MS - timeSinceLast);
        const interval = setInterval(() => {
           setCooldownTime(prev => {
               if (prev <= 1000) {
                   clearInterval(interval);
                   setQuizState('ready');
                   return 0;
               }
               return prev - 1000;
           });
        }, 1000);
        return () => clearInterval(interval);
      }
    }
    setQuizState('ready');
  }, []);

  const startQuiz = async () => {
    if (cards.length < 4) {
        // Not enough cards to make a meaningful quiz
        return;
    }
    setQuizState('generating');
    
    const quizCards = shuffleArray(cards).slice(0, QUIZ_LENGTH);
    const generatedQuestions: QuizQuestion[] = [];

    for (const card of quizCards) {
      const incorrectOptions = await generateQuizOptions(card.front, card.back);
      const allOptions = shuffleArray([card.back, ...incorrectOptions]);
      generatedQuestions.push({
        card,
        options: allOptions,
        correctAnswer: card.back,
      });
    }

    setQuestions(generatedQuestions);
    setCurrentIndex(0);
    setScore(0);
    setSelectedAnswer(null);
    setIsAnswered(false);
    setQuizState('ready');
  };

  const handleAnswer = (answer: string) => {
    if (isAnswered) return;
    setSelectedAnswer(answer);
    setIsAnswered(true);
    if (answer === questions[currentIndex].correctAnswer) {
      setScore(prev => prev + 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setSelectedAnswer(null);
      setIsAnswered(false);
    } else {
      setQuizState('finished');
      localStorage.setItem('lastQuizTime', Date.now().toString());
    }
  };
  
  const currentQuestion = questions[currentIndex];
  
  if (cards.length < 4 && quizState !== 'cooldown') {
      return (
          <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
              <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">More Cards Needed</h2>
              <p className="mt-2 text-slate-500 dark:text-slate-400">You need at least 4 flashcards to start a practice quiz.</p>
          </div>
      );
  }

  if (quizState === 'loading') {
    return <div className="text-center p-10">Loading...</div>;
  }
  
  if (quizState === 'cooldown') {
     const hours = Math.floor(cooldownTime / (1000 * 60 * 60));
     const minutes = Math.floor((cooldownTime % (1000 * 60 * 60)) / (1000 * 60));
     const seconds = Math.floor((cooldownTime % (1000 * 60)) / 1000);
     return (
        <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">Next quiz available in:</h2>
          <p className="mt-2 text-4xl font-bold text-indigo-500">{`${hours}h ${minutes}m ${seconds}s`}</p>
        </div>
     );
  }
  
  if (quizState === 'generating') {
      return (
        <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200 animate-pulse">Generating your quiz...</h2>
          <p className="mt-2 text-slate-500 dark:text-slate-400">This may take a moment.</p>
        </div>
      );
  }

  if (questions.length === 0) {
    return (
      <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">Ready to Practice?</h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400">Take a short quiz to test your knowledge.</p>
        <button onClick={startQuiz} className="mt-6 px-6 py-3 text-lg font-semibold text-white bg-indigo-600 rounded-lg shadow-md hover:bg-indigo-700 transition-colors">
            Start Quiz
        </button>
      </div>
    );
  }
  
  if (quizState === 'finished') {
       return (
        <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">Quiz Complete!</h2>
          <p className="mt-2 text-4xl font-bold text-indigo-500">Your score: {score} / {questions.length}</p>
          <button onClick={() => setQuizState('ready')} className="mt-6 px-6 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">
            Back
          </button>
        </div>
     );
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col p-6 bg-white dark:bg-slate-800 rounded-lg shadow-md">
      <div className="mb-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">Question {currentIndex + 1} of {questions.length}</p>
        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 mt-1">
          <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}></div>
        </div>
      </div>
      <div className="text-center my-8">
        <p className="text-lg text-slate-600 dark:text-slate-300">What is the Persian translation of:</p>
        <h2 className="text-4xl font-bold my-2 text-slate-800 dark:text-slate-100">{currentQuestion.card.front}</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {currentQuestion.options.map(option => {
          const isCorrect = option === currentQuestion.correctAnswer;
          const isSelected = option === selectedAnswer;
          let buttonClass = 'p-4 rounded-lg text-lg font-medium transition-colors border-2 ';
          if (isAnswered) {
             if(isCorrect) {
                 buttonClass += 'bg-green-100 dark:bg-green-900/50 border-green-500 text-green-800 dark:text-green-300';
             } else if (isSelected) {
                 buttonClass += 'bg-red-100 dark:bg-red-900/50 border-red-500 text-red-800 dark:text-red-300';
             } else {
                 buttonClass += 'bg-slate-100 dark:bg-slate-700 border-transparent opacity-60';
             }
          } else {
              buttonClass += 'bg-white dark:bg-slate-700/50 border-slate-300 dark:border-slate-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30';
          }

          return (
            <button key={option} onClick={() => handleAnswer(option)} disabled={isAnswered} className={buttonClass}>
              {option}
            </button>
          )
        })}
      </div>
      {isAnswered && (
        <div className="text-center mt-6">
            <button onClick={handleNext} className="px-10 py-3 text-white bg-indigo-600 rounded-lg shadow hover:bg-indigo-700">
                {currentIndex < questions.length - 1 ? 'Next' : 'Finish'}
            </button>
        </div>
      )}
    </div>
  );
};
// Fix: Removed the redundant export statement that was causing a redeclaration error.
// The component is already exported on line 25.
// export { QuizView };