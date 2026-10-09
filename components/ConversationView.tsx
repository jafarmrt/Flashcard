import React, { useState, useRef } from 'react';
import { Flashcard } from '../types';
import { AiRequestOptions, generateInstructionalQuiz, InstructionalQuizQuestion, blobToBase64, evaluatePronunciation, PronunciationResult } from '../services/geminiService';
import { fa, Icon } from './common/ui';

interface PracticeViewProps {
  cards: Flashcard[];
  awardXP: (points: number, message?: string) => void;
  onQuizComplete: (score: { score: number, total: number }) => void;
  aiOptions?: AiRequestOptions;
  audioOptions?: AiRequestOptions;
}

// Fix: Make the shuffle function specific to Flashcard[] to avoid generic type inference issues.
const shuffleArray = (array: Flashcard[]): Flashcard[] => {
  return [...array].sort(() => Math.random() - 0.5);
};

const MIN_CARDS = 4;

const panel = 'bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-8';
const primaryButton = 'inline-flex items-center justify-center gap-2 min-h-[52px] px-8 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold transition-colors disabled:opacity-50';
const secondaryButton = 'min-h-[44px] px-5 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors';

const MicIcon = ({ recording, size = 28 }: { recording: boolean; size?: number }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={recording ? 'text-red-600 dark:text-red-400' : 'text-brand-600 dark:text-brand-200'}>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
);

// The page frame: right to left, Persian font. English words inside it set
// their own direction.
const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div dir="rtl" className="font-fa max-w-3xl mx-auto w-full flex flex-col gap-5">{children}</div>
);

// "Question 2 of 5" with a bar that fills from the right.
const StepBar: React.FC<{ label: string; value: number; total: number }> = ({ label, value, total }) => (
    <div className="flex items-center gap-3">
        <div className="flex-1 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
            <div className="h-full bg-brand-500 rounded-full transition-all duration-300" style={{ width: `${total > 0 ? (value / total) * 100 : 0}%` }} />
        </div>
        <span className="text-sm text-ink-muted dark:text-slate-400 whitespace-nowrap">{label} {fa(value)} از {fa(total)}</span>
    </div>
);

const SpeakingMode: React.FC<{ cards: Flashcard[]; onFinish: (avgScore: number) => void; audioOptions?: AiRequestOptions }> = ({ cards, onFinish, audioOptions }) => {
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
                        const result = await evaluatePronunciation(currentCard.front, base64Audio, audioBlob.type, audioOptions);
                        setFeedback(result);
                        setScores(prev => [...prev, result.score]);
                    } catch (err) {
                        alert('صدا بررسی نشد. دوباره امتحان کن.');
                    } finally {
                        setIsAnalyzing(false);
                        stream.getTracks().forEach(track => track.stop());
                    }
                };

                mediaRecorderRef.current.start();
                setIsRecording(true);
            } catch (error) {
                console.error("Error accessing microphone:", error);
                alert('برای این تمرین باید به میکروفون اجازه بدهی.');
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

    const isLast = currentIndex >= sessionCards.length - 1;

    return (
        <Shell>
            <div className="max-w-xl mx-auto w-full flex flex-col gap-5">
                <StepBar label="کارت" value={currentIndex + 1} total={sessionCards.length} />

                <section className={`${panel} min-h-[200px] flex flex-col justify-center items-center gap-2 text-center`}>
                    <p className="text-sm text-ink-muted dark:text-slate-400">این واژه را بلند بخوان</p>
                    <h2 dir="ltr" className="font-en text-4xl md:text-5xl font-bold tracking-tight text-ink dark:text-white break-words max-w-full">{currentCard.front}</h2>
                    {currentCard.pronunciation && <p dir="ltr" className="text-ink-muted dark:text-slate-400">{currentCard.pronunciation}</p>}
                </section>

                {!feedback ? (
                    <div className="flex flex-col items-center gap-4">
                        <button
                            type="button"
                            onClick={handleToggleRecording}
                            disabled={isAnalyzing}
                            aria-pressed={isRecording}
                            aria-label={isRecording ? 'توقف ضبط' : 'شروع ضبط'}
                            className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all disabled:opacity-50 ${isRecording ? 'bg-red-100 dark:bg-red-900/50 ring-4 ring-red-500 scale-110' : 'bg-brand-100 dark:bg-brand-900/50 hover:bg-brand-200 dark:hover:bg-brand-800'}`}
                        >
                            <MicIcon recording={isRecording} />
                        </button>
                        <p role="status" className="text-sm font-medium text-ink-muted dark:text-slate-300">
                            {isRecording ? 'برای توقف ضبط بزن' : isAnalyzing ? 'در حال بررسی تلفظ…' : 'بزن، واژه را بگو و دوباره بزن'}
                        </p>
                    </div>
                ) : (
                    <div className="w-full flex flex-col items-center gap-5 animate-flip-in">
                        <div className={`w-full p-5 rounded-3xl border-2 text-center ${feedback.score >= 80 ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : feedback.score >= 60 ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' : 'border-red-500 bg-red-50 dark:bg-red-900/20'}`}>
                            <p className="text-ink dark:text-white">
                                <span className="text-4xl font-extrabold">{fa(feedback.score)}</span>
                                <span className="text-base font-bold text-ink-muted dark:text-slate-400 ms-1.5">از {fa(100)}</span>
                            </p>
                            <p className="mt-2 text-ink dark:text-slate-200 leading-relaxed">{feedback.feedback}</p>
                            {feedback.correction && (
                                <p className="text-sm text-ink-muted dark:text-slate-400 mt-2">
                                    تلفظ درست: <bdi dir="ltr" className="font-en font-bold">{feedback.correction}</bdi>
                                </p>
                            )}
                        </div>
                        <button type="button" onClick={handleNext} className={primaryButton}>
                            {isLast ? 'پایان' : 'کارت بعدی'}
                        </button>
                    </div>
                )}
            </div>
        </Shell>
    );
};


export const PracticeView: React.FC<PracticeViewProps> = ({ cards, awardXP, onQuizComplete, aiOptions, audioOptions }) => {
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
    if (practicePool.length < MIN_CARDS) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueCards = cards.filter(c => new Date(c.dueDate) <= today && !practicePool.find(pc => pc.id === c.id));
      practicePool = [...practicePool, ...dueCards];
    }
    // Tier 3: All cards
    if (practicePool.length < MIN_CARDS) {
      practicePool = [...cards];
    }

    const validPracticePool = practicePool.filter(c => c.front && c.front.trim() !== '');

    if (validPracticePool.length < MIN_CARDS) {
        alert(`برای شروع تمرین دست‌کم ${fa(MIN_CARDS)} کارت لازم است.`);
        return;
    }

    if (mode === 'speaking') {
        setPracticeState('active');
        return;
    }

    // Quiz Mode Logic
    setPracticeState('generating');
    const practiceCards = shuffleArray(validPracticePool).slice(0, 5);
    const generatedQuestions = await generateInstructionalQuiz(practiceCards, aiOptions);

    if (generatedQuestions && generatedQuestions.length > 0) {
        setQuestions(generatedQuestions);
        setCurrentIndex(0);
        setScore(0);
        setSelectedAnswer(null);
        setIsAnswered(false);
        setPracticeState('active');
    } else {
        setErrorMessage('آزمون ساخته نشد؛ شاید سرویس هوش مصنوعی فعلاً در دسترس نیست. کمی بعد دوباره امتحان کن.');
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
      awardXP(score * 5, `آزمون تمام شد! +${fa(score * 5)} امتیاز`);
      onQuizComplete({ score, total: questions.length });
    }
  };

  const handleSpeakingFinish = (avgScore: number) => {
      setScore(avgScore); // Reuse score state for avg
      setPracticeState('finished');
      const xp = Math.round(avgScore / 2); // e.g. 80 score -> 40 XP
      awardXP(xp, `تمرین تلفظ تمام شد! +${fa(xp)} امتیاز`);
      onQuizComplete({ score: avgScore, total: 100 }); // Normalized
  };

  const currentQuestion = questions[currentIndex];

  if (cards.length === 0) {
      return (
          <Shell>
              <section className={`${panel} text-center py-16`}>
                  <h2 className="text-2xl font-extrabold text-ink dark:text-white">هنوز کارتی نداری</h2>
                  <p className="mt-2 text-ink-muted dark:text-slate-400">چند کارت بساز تا بتوانی با آن‌ها تمرین کنی.</p>
              </section>
          </Shell>
      );
  }

  if (practiceState === 'generating') {
      return (
        <Shell>
            <section role="status" className={`${panel} text-center py-16`}>
                <h2 className="text-2xl font-extrabold text-ink dark:text-white animate-pulse">در حال ساختن آزمون…</h2>
                <p className="mt-2 text-ink-muted dark:text-slate-400">هوش مصنوعی برای واژه‌هایت جمله و گزینه می‌سازد.</p>
            </section>
        </Shell>
      );
  }

  if (practiceState === 'idle') {
    return (
      <Shell>
          <header>
              <h1 className="text-2xl font-extrabold text-ink dark:text-white">تمرین مکالمه و آزمون</h1>
              <p className="text-sm text-ink-muted dark:text-slate-400 mt-1">واژه‌های تازه‌ات را در جمله بیازما یا تلفظشان را تمرین کن.</p>
          </header>

          {/* Mode Selection Tabs */}
          <div role="group" aria-label="نوع تمرین" className="self-start flex flex-wrap gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setMode('quiz')}
                aria-pressed={mode === 'quiz'}
                className={`min-h-[40px] px-4 rounded-lg text-sm transition-all ${mode === 'quiz' ? 'bg-white dark:bg-slate-700 shadow-sm font-bold text-brand-700 dark:text-white' : 'text-ink-muted dark:text-slate-400 hover:text-ink dark:hover:text-slate-200'}`}
              >
                  آزمون چندگزینه‌ای
              </button>
              <button
                type="button"
                onClick={() => setMode('speaking')}
                aria-pressed={mode === 'speaking'}
                className={`min-h-[40px] px-4 rounded-lg text-sm transition-all ${mode === 'speaking' ? 'bg-white dark:bg-slate-700 shadow-sm font-bold text-brand-700 dark:text-white' : 'text-ink-muted dark:text-slate-400 hover:text-ink dark:hover:text-slate-200'}`}
              >
                  تمرین تلفظ
              </button>
          </div>

          <section className={`${panel} flex flex-col items-center text-center gap-3`}>
            <span className="w-14 h-14 rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-900/60 dark:text-brand-200 flex items-center justify-center">
                {mode === 'quiz' ? <Icon.Chat size={26} /> : <MicIcon recording={false} size={26} />}
            </span>
            <h2 className="text-xl font-extrabold text-ink dark:text-white">
                {mode === 'quiz' ? 'آزمون واژه‌ها' : 'تمرین تلفظ'}
            </h2>
            <p className="text-ink-muted dark:text-slate-400 max-w-md leading-relaxed">
                {mode === 'quiz'
                    ? 'هوش مصنوعی با چند واژهٔ تازه‌ات جمله می‌سازد و جای واژه را خالی می‌گذارد؛ از میان چهار گزینه، واژهٔ درست را انتخاب کن.'
                    : 'واژه را بلند بخوان؛ هوش مصنوعی صدایت را می‌شنود، از ۱۰۰ نمره می‌دهد و به فارسی راهنمایی‌ات می‌کند.'}
            </p>
            {errorMessage && (
                <p role="alert" className="mt-1 px-4 py-3 rounded-2xl bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 text-sm">
                    {errorMessage}
                </p>
            )}
            <button type="button" onClick={startPractice} className={`${primaryButton} mt-3`}>
                {mode === 'quiz' ? 'شروع آزمون' : 'شروع تمرین'}
            </button>
          </section>
      </Shell>
    );
  }

  if (practiceState === 'finished') {
       return (
        <Shell>
            <section className={`${panel} text-center py-12 flex flex-col items-center gap-2`}>
                <h2 className="text-2xl font-extrabold text-ink dark:text-white">آفرین، تمرین تمام شد!</h2>
                <p className="mt-4">
                    <span className="text-6xl font-extrabold text-brand-500 dark:text-brand-300">{fa(score)}</span>
                    <span className="text-xl text-ink-muted dark:text-slate-400 ms-2">از {fa(mode === 'quiz' ? questions.length : 100)}</span>
                </p>
                <p className="text-ink-muted dark:text-slate-400 mb-6">{mode === 'quiz' ? 'جواب درست' : 'میانگین نمرهٔ تلفظ'}</p>
                <button type="button" onClick={() => setPracticeState('idle')} className={secondaryButton}>
                    بازگشت به تمرین‌ها
                </button>
            </section>
        </Shell>
     );
  }

  // Render Speaking Mode
  if (mode === 'speaking' && practiceState === 'active') {
      return <SpeakingMode cards={cards} onFinish={handleSpeakingFinish} audioOptions={audioOptions} />;
  }

  // Render Quiz Mode
  if (!currentQuestion) return null;

  const answeredRight = isAnswered && selectedAnswer === currentQuestion.correctAnswer;

  return (
    <Shell>
      <section className={`${panel} flex flex-col gap-5`}>
        <StepBar label="پرسش" value={currentIndex + 1} total={questions.length} />

        <div className="text-center flex flex-col gap-2">
          <p className="text-sm text-ink-muted dark:text-slate-400">جای خالی را با واژهٔ درست پر کن</p>
          <h2 dir="ltr" className="font-en text-xl md:text-2xl font-bold leading-relaxed text-ink dark:text-white break-words">{currentQuestion.questionText}</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {currentQuestion.options.map(option => {
            const isCorrect = option === currentQuestion.correctAnswer;
            const isSelected = option === selectedAnswer;
            let buttonClass = 'min-h-[56px] p-4 rounded-2xl text-lg font-medium transition-colors border-2 text-center break-words font-en ';
            if (isAnswered) {
               if(isCorrect) {
                   buttonClass += 'bg-emerald-50 dark:bg-emerald-900/40 border-emerald-500 text-emerald-900 dark:text-emerald-200';
               } else if (isSelected) {
                   buttonClass += 'bg-red-50 dark:bg-red-900/40 border-red-500 text-red-900 dark:text-red-200';
               } else {
                   buttonClass += 'bg-slate-50 dark:bg-slate-700 border-transparent text-ink dark:text-slate-200 opacity-60';
               }
            } else {
                buttonClass += 'bg-white dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-ink dark:text-white hover:border-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30';
            }

            return (
              <button key={option} type="button" dir="ltr" onClick={() => handleAnswer(option)} disabled={isAnswered} className={buttonClass}>
                {option}
              </button>
            )
          })}
        </div>
        {isAnswered && (
          <>
              <p role="status" className={`text-center font-bold ${answeredRight ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                  {answeredRight
                      ? 'درست بود!'
                      : <>جواب درست: <bdi dir="ltr" className="font-en">{currentQuestion.correctAnswer}</bdi></>}
              </p>
              <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl animate-flip-in">
                  <p className="text-sm text-ink-muted dark:text-slate-400 font-bold mb-1">جملهٔ کامل</p>
                  <p dir="ltr" className="font-en italic text-ink dark:text-slate-200 leading-relaxed break-words">“{currentQuestion.sourceSentence}”</p>
              </div>
              <div className="text-center">
                  <button type="button" onClick={handleNext} className={primaryButton}>
                      {currentIndex < questions.length - 1 ? 'پرسش بعدی' : 'پایان'}
                  </button>
              </div>
          </>
        )}
      </section>
    </Shell>
  );
};
