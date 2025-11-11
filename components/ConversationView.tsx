
import React, { useState } from 'react';
import { Flashcard } from '../types';
import { generateInstructionalQuiz, InstructionalQuizQuestion } from '../services/geminiService';

interface PracticeViewProps {
  cards: Flashcard[];
}

const shuffleArray = <T,>(array: T[]): T[] => {
  return [...array].sort(() => Math.random() - 0.5);
};

export const PracticeView: React.FC<PracticeViewProps> = ({ cards }) => {
  type PracticeState = 'idle' | 'generating' | 'active' | 'finished';

  const [practiceState, setPracticeState] = useState<PracticeState>('idle');
  const [questions, setQuestions] = useState<InstructionalQuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);

  const startPractice = async () => {
    // A "new" word is one that has never been reviewed correctly.
    // Fix: Explicitly type the parameter 'c' to resolve a potential type inference issue.
    const newCards = cards.filter((c: Flashcard) => c.repetition === 0);
    
    if (newCards.length < 4) {
      alert("You need at least 4 new cards (cards you haven't studied yet) to start a practice session.");
      return;
    }

    setPracticeState('generating');
    
    const practiceCards = shuffleArray(newCards).slice(0, 10);
    const generatedQuestions = await generateInstructionalQuiz(practiceCards);

    if (generatedQuestions && generatedQuestions.length > 0) {
        setQuestions(generatedQuestions);
        setCurrentIndex(0);
        setScore(0);
        setSelectedAnswer(null);
        setIsAnswered(false);
        setPracticeState('active');
    } else {
        alert("Sorry, we couldn't generate a practice session right now. Please try again later.");
        setPracticeState('idle');
    }
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
      setPracticeState('finished');
    }
  };
  
  const currentQuestion = questions[currentIndex];
  
  if (cards.length === 0) {
      return (
          <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
              <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">No Cards Yet</h2>
              <p className="mt-2 text-slate-500 dark:text-slate-400">Add some flashcards to start practicing.</p>
          </div>
      );
  }

  if (practiceState === 'generating') {
      return (
        <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200 animate-pulse">Generating your practice session...</h2>
          <p className="mt-2 text-slate-500 dark:text-slate-400">Our AI is creating custom questions for you. This may take a moment.</p>
        </div>
      );
  }
  
  if (practiceState === 'idle') {
    return (
      <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">Ready to Practice?</h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400">Take a short, AI-generated quiz on your newest words to reinforce your learning.</p>
        <button onClick={startPractice} className="mt-6 px-6 py-3 text-lg font-semibold text-white bg-indigo-600 rounded-lg shadow-md hover:bg-indigo-700 transition-colors">
            Start Practice Session
        </button>
      </div>
    );
  }
  
  if (practiceState === 'finished') {
       return (
        <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">Practice Complete!</h2>
          <p className="mt-2 text-4xl font-bold text-indigo-500">Your score: {score} / {questions.length}</p>
          <button onClick={startPractice} className="mt-6 px-6 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">
            Practice Again
          </button>
        </div>
     );
  }

  if (!currentQuestion) {
    return (
       <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">Something went wrong.</h2>
          <p className="mt-2 text-slate-500 dark:text-slate-400">Could not load the next question.</p>
          <button onClick={() => setPracticeState('idle')} className="mt-6 px-6 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">
            Back
          </button>
        </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col p-6 bg-white dark:bg-slate-800 rounded-lg shadow-md">
      <div className="mb-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">Question {currentIndex + 1} of {questions.length}</p>
        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 mt-1">
          <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}></div>
        </div>
      </div>
      
      <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg my-6">
          <p className="text-sm text-slate-600 dark:text-slate-400 font-semibold mb-1">Context:</p>
          <p className="text-md italic text-slate-800 dark:text-slate-200">"{currentQuestion.sourceSentence}"</p>
      </div>

      <div className="text-center my-4">
        <h2 className="text-xl font-bold my-2 text-slate-800 dark:text-slate-100">{currentQuestion.questionText}</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {currentQuestion.options.map(option => {
          const isCorrect = option === currentQuestion.correctAnswer;
          const isSelected = option === selectedAnswer;
          let buttonClass = 'p-4 rounded-lg text-lg font-medium transition-colors border-2 text-left ';
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
