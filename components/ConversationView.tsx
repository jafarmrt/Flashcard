import React, { useState, useRef } from 'react';
import { Flashcard } from '../types';
import { generateInstructionalQuiz, InstructionalQuizQuestion, blobToBase64, evaluatePronunciation, PronunciationResult } from '../services/geminiService';

interface PracticeViewProps {
  cards: Flashcard[];
  awardXP: (points: number, message?: string) => void;
  onQuizComplete: (score: { score: number, total: number }) => void;
}

// Fix: Make the shuffle function specific to Flashcard[] to avoid generic type inference issues.
const shuffleArray = (array: Flashcard[]): Flashcard[] => {
  return [...array].sort(() => Math.random() - 0.5);
};

const MicIcon = ({ recording }: { recording: boolean }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={recording ? 'text-red-500' : 'text-slate-500'}>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
);

const SpeakingMode: React.FC<{ cards: Flashcard[]; onFinish: (avgScore: number) => void }> = ({ cards, onFinish }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [scores, setScores] = useState<number[]>([]);
    const [isRecording, setIsRecording] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [feedback, setFeedback] = useState<PronunciationResult | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    // Use 5 cards for the session
    const sessionCards = useRef(shuffleArray(cards).slice(0, 5)).current;
    const currentCard = sessionCards[currentIndex];

    const handleToggleRecording = async () => {
        if (isRecording) {
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorderRef.current = new MediaRecorder(stream);
                audioChunksRef.current = [];

                mediaRecorderRef.current.ondataavailable = event => {
                    audioChunksRef.current.push(event.data);
                };

                mediaRecorderRef.current.onstop = async () => {
                    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                    setIsAnalyzing(true);
                    try {
                        const base64Audio = await blobToBase64(audioBlob);
                        const result = await evaluatePronunciation(currentCard.front, base64Audio, audioBlob.type);
                        setFeedback(result);
                        setScores(prev => [...prev, result.score]);
                    } catch (err) {
                        alert('Could not analyze audio. Please try again.');
                    } finally {
                        setIsAnalyzing(false);
                        stream.getTracks().forEach(track => track.stop());
                    }
                };

                mediaRecorderRef.current.start();
                setIsRecording(true);
            } catch (error) {
                console.error("Error accessing microphone:", error);
                alert("Microphone access is required for this feature.");
            }
        }
    };

    const handleNext = () => {
        if (currentIndex < sessionCards.length - 1) {
            setCurrentIndex(prev => prev + 1);
            setFeedback(null);
        } else {
            const totalScore = scores.reduce((a, b) => a + b, 0);
            const avgScore = scores.length > 0 ? Math.round(totalScore / scores.length) : 0;
            onFinish(avgScore);
        }
    };

    return (
        <div className="max-w-xl mx-auto flex flex-col items-center text-center p-6">
            <div className="mb-6 w-full">
                <p className="text-sm text-slate-500 dark:text-slate-400">Card {currentIndex + 1} of {sessionCards.length}</p>
                 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 mt-1">
                    <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: `${((currentIndex + 1) / sessionCards.length) * 100}%` }}></div>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 shadow-lg rounded-xl p-8 w-full mb-6 min-h-[200px] flex flex-col justify-center items-center">
                <h2 className="text-4xl font-bold text-slate-800 dark:text-slate-100 mb-2">{currentCard.front}</h2>
                {currentCard.pronunciation && <p className="text-slate-500 dark:text-slate-400">{currentCard.pronunciation}</p>}
            </div>

            {!feedback ? (
                <div className="flex flex-col items-center gap-4">
                    <button 
                        onClick={handleToggleRecording}
                        disabled={isAnalyzing}
                        className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all ${isRecording ? 'bg-red-100 dark:bg-red-900/50 ring-4 ring-red-500 scale-110' : 'bg-indigo-100 dark:bg-indigo-900/50 hover:bg-indigo-200 dark:hover:bg-indigo-800'}`}
                    >
                         <MicIcon recording={isRecording} />
                    </button>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                        {isRecording ? 'Tap to stop' : isAnalyzing ? 'Analyzing...' : 'Tap to record'}
                    </p>
                </div>
            ) : (
                <div className="w-full animate-flip-in">
                    <div className={`p-4 rounded-lg mb-6 border-2 ${feedback.score >= 80 ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : feedback.score >= 60 ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20' : 'border-red-500 bg-red-50 dark:bg-red-900/20'}`}>
                        <div className="text-3xl font-bold mb-1">{feedback.score}/100</div>
                        <p className="text-slate-700 dark:text-slate-200">{feedback.feedback}</p>
                        {feedback.correction && <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Did you mean: {feedback.correction}</p>}
                    </div>
                    <button onClick={handleNext} className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-md transition-colors">
                        {currentIndex < sessionCards.length - 1 ? 'Next Card' : 'Finish'}
                    </button>
                </div>
            )}
        </div>
    );
};


export const PracticeView: React.FC<PracticeViewProps> = ({ cards, awardXP, onQuizComplete }) => {
  type PracticeState = 'idle' | 'generating' | 'active' | 'finished';
  type Mode = 'quiz' | 'speaking';

  const [mode, setMode] = useState<Mode>('quiz');
  const [practiceState, setPracticeState] = useState<PracticeState>('idle');
  const [questions, setQuestions] = useState<InstructionalQuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);


  const startPractice = async () => {
    setErrorMessage(null);
    
    // Tier 1: Prefer new cards
    let practicePool = cards.filter(c => c.repetition === 0);
    // Tier 2: Add due cards
    if (practicePool.length < 4) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueCards = cards.filter(c => new Date(c.dueDate) <= today && !practicePool.find(pc => pc.id === c.id));
      practicePool = [...practicePool, ...dueCards];
    }
    // Tier 3: All cards
    if (practicePool.length < 4) {
      practicePool = [...cards];
    }
    
    const validPracticePool = practicePool.filter(c => c.front && c.front.trim() !== '');

    if (validPracticePool.length < 4) {
        alert("You need at least 4 valid cards to start a practice session.");
        return;
    }

    if (mode === 'speaking') {
        setPracticeState('active');
        return;
    }

    // Quiz Mode Logic
    setPracticeState('generating');
    const practiceCards = shuffleArray(validPracticePool).slice(0, 5);
    const generatedQuestions = await generateInstructionalQuiz(practiceCards);

    if (generatedQuestions && generatedQuestions.length > 0) {
        setQuestions(generatedQuestions);
        setCurrentIndex(0);
        setScore(0);
        setSelectedAnswer(null);
        setIsAnswered(false);
        setPracticeState('active');
    } else {
        setErrorMessage("Sorry, we couldn't generate a quiz session. The AI service may be temporarily unavailable.");
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
      awardXP(score * 5, `Quiz Complete! +${score * 5} XP`);
      onQuizComplete({ score, total: questions.length });
    }
  };

  const handleSpeakingFinish = (avgScore: number) => {
      setScore(avgScore); // Reuse score state for avg
      setPracticeState('finished');
      const xp = Math.round(avgScore / 2); // e.g. 80 score -> 40 XP
      awardXP(xp, `Speaking Session Complete! +${xp} XP`);
      onQuizComplete({ score: avgScore, total: 100 }); // Normalized
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
          <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200 animate-pulse">Generating session...</h2>
          <p className="mt-2 text-slate-500 dark:text-slate-400">Our AI is preparing your practice content.</p>
        </div>
      );
  }
  
  if (practiceState === 'idle') {
    return (
      <div className="max-w-3xl mx-auto">
          {/* Mode Selection Tabs */}
          <div className="flex justify-center mb-8">
              <div className="flex p-1 bg-slate-200 dark:bg-slate-700 rounded-lg">
                  <button 
                    onClick={() => setMode('quiz')} 
                    className={`px-6 py-2 text-sm font-medium rounded-md transition-all ${mode === 'quiz' ? 'bg-white dark:bg-slate-600 shadow text-indigo-600 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                  >
                      Quiz Mode
                  </button>
                  <button 
                    onClick={() => setMode('speaking')} 
                    className={`px-6 py-2 text-sm font-medium rounded-md transition-all ${mode === 'speaking' ? 'bg-white dark:bg-slate-600 shadow text-indigo-600 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                  >
                      Speaking Mode
                  </button>
              </div>
          </div>

          <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">
                {mode === 'quiz' ? 'Vocabulary Quiz' : 'Pronunciation Trainer'}
            </h2>
            <p className="mt-2 text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                {mode === 'quiz' 
                    ? "Take a short, AI-generated quiz on your newest words to reinforce your learning." 
                    : "Practice your pronunciation with real-time AI feedback. Read words aloud and get scored."}
            </p>
            {errorMessage && (
                <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm inline-block">
                    <p>{errorMessage}</p>
                </div>
            )}
            <div className="mt-8">
                <button onClick={startPractice} className="px-8 py-3 text-lg font-semibold text-white bg-indigo-600 rounded-lg shadow-md hover:bg-indigo-700 transition-colors">
                    Start {mode === 'quiz' ? 'Quiz' : 'Session'}
                </button>
            </div>
          </div>
      </div>
    );
  }
  
  if (practiceState === 'finished') {
       return (
        <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">Session Complete!</h2>
          <div className="mt-6 mb-8">
            <span className="text-6xl font-bold text-indigo-500">{score}</span>
            <span className="text-xl text-slate-400 ml-2">{mode === 'quiz' ? ` / ${questions.length}` : '% Avg Score'}</span>
          </div>
          <button onClick={() => setPracticeState('idle')} className="px-6 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">
            Back to Menu
          </button>
        </div>
     );
  }

  // Render Speaking Mode
  if (mode === 'speaking' && practiceState === 'active') {
      return <SpeakingMode cards={cards} onFinish={handleSpeakingFinish} />;
  }

  // Render Quiz Mode
  if (!currentQuestion) return null;

  return (
    <div className="max-w-3xl mx-auto flex flex-col p-6 bg-white dark:bg-slate-800 rounded-lg shadow-md">
      <div className="mb-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">Question {currentIndex + 1} of {questions.length}</p>
        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 mt-1">
          <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}></div>
        </div>
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
        <>
            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg my-6 animate-flip-in">
                <p className="text-sm text-slate-600 dark:text-slate-400 font-semibold mb-1">Context:</p>
                <p className="text-md italic text-slate-800 dark:text-slate-200">"{currentQuestion.sourceSentence}"</p>
            </div>
            <div className="text-center mt-6">
                <button onClick={handleNext} className="px-10 py-3 text-white bg-indigo-600 rounded-lg shadow hover:bg-indigo-700">
                    {currentIndex < questions.length - 1 ? 'Next' : 'Finish'}
                </button>
            </div>
        </>
      )}
    </div>
  );
};