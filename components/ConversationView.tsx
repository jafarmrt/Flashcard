import React, { useMemo, useState } from 'react';
import { Flashcard, Occurrence, SpeechAttempt } from '../types';
import { AiRequestOptions, generateInstructionalQuiz, InstructionalQuizQuestion } from '../services/geminiService';
import {
  dueSchedules, pickSpeechItems, practiceSentence, sessionResults, SessionItemResult, soundInfo, SpeechChoice, SpeechItem,
  SpeechKind, speechSchedules, WEAK_SCORE, weakSounds,
} from '../services/speechPractice';
import { dueLabel, MicIcon, SentenceMarks, SpeakingMode, SpeechProgress, scoreTone, StageChip } from './practice/SpeakingPractice';
import { fa, Icon } from './common/ui';

interface PracticeViewProps {
  cards: Flashcard[];
  occurrences?: Occurrence[];
  aiOptions?: AiRequestOptions;
  audioOptions?: AiRequestOptions;
  speechAttempts: SpeechAttempt[];
  onSaveSpeechAttempt: (attempt: SpeechAttempt) => Promise<void> | void;
}

// What one pronunciation session did for each item, and when it comes back.
const SessionResultList: React.FC<{ results: SessionItemResult[] }> = ({ results }) => (
  <ul className="w-full max-w-md flex flex-col gap-2 text-right">
    {results.map(r => (
      <li key={r.key} className="px-3 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-700/40 flex flex-col gap-1">
        {r.kind === 'sentence'
          ? <SentenceMarks text={r.target} focus={r.focus} size="text-sm" />
          : <bdi dir="ltr" className="font-en font-bold text-ink dark:text-white">{r.target}</bdi>}
        <p className="text-xs text-ink-muted dark:text-slate-400 flex flex-wrap items-center gap-1.5">
          <span>
            نمره: {r.tries > 1 ? <><span className={`font-bold ${scoreTone(r.first)}`}>{fa(r.first)}</span> ← </> : null}
            <span className={`font-bold ${scoreTone(r.last)}`}>{fa(r.last)}</span>
          </span>
          <span>· مرور بعد: <b className="text-ink dark:text-slate-200">{dueLabel(r.dueDay)}</b></span>
          <StageChip stage={r.stage} />
        </p>
      </li>
    ))}
  </ul>
);

// Fix: Make the shuffle function specific to Flashcard[] to avoid generic type inference issues.
const shuffleArray = (array: Flashcard[]): Flashcard[] => {
  return [...array].sort(() => Math.random() - 0.5);
};

const MIN_CARDS = 4;

const panel = 'bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-8';
const primaryButton = 'inline-flex items-center justify-center gap-2 min-h-[52px] px-8 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold transition-colors disabled:opacity-50';
const secondaryButton = 'min-h-[44px] px-5 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors';

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

export const PracticeView: React.FC<PracticeViewProps> = ({ cards, occurrences = [], aiOptions, audioOptions, speechAttempts, onSaveSpeechAttempt }) => {
  type PracticeState = 'idle' | 'generating' | 'active' | 'finished';
  type Mode = 'quiz' | 'speaking' | 'progress';

  const [mode, setMode] = useState<Mode>('quiz');
  const [practiceState, setPracticeState] = useState<PracticeState>('idle');
  const [questions, setQuestions] = useState<InstructionalQuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Words are practised in their sentence unless asked otherwise.
  const [speakKind, setSpeakKind] = useState<SpeechKind>('sentence');
  const [cardChoice, setCardChoice] = useState<SpeechChoice>('plan');
  const [speakingItems, setSpeakingItems] = useState<SpeechItem[]>([]);
  const [sessionTries, setSessionTries] = useState<SpeechAttempt[]>([]);

  const liveCards = useMemo(() => cards.filter(c => !c.isDeleted && c.kind !== 'grammar'), [cards]);
  const liveIds = useMemo(() => new Set(liveCards.map(c => c.id)), [liveCards]);
  const sentenceCount = useMemo(() => liveCards.filter(c => practiceSentence(c, occurrences)).length, [liveCards, occurrences]);
  const counts = useMemo(() => {
    const ofKind = speechAttempts.filter(a => a.kind === speakKind);
    const mine = (cardId?: string) => !!cardId && liveIds.has(cardId);
    const practised = new Set(ofKind.map(a => a.cardId).filter(Boolean));
    return {
      weak: speechSchedules(ofKind).filter(s => mine(s.cardId) && s.lastScore < WEAK_SCORE).length,
      due: dueSchedules(ofKind).filter(s => mine(s.cardId)).length,
      fresh: liveCards.filter(c => !practised.has(c.id) && (speakKind === 'word' || practiceSentence(c, occurrences))).length,
    };
  }, [speechAttempts, speakKind, liveIds, liveCards, occurrences]);

  const startSpeaking = (kind: SpeechKind = speakKind, choice: SpeechChoice = cardChoice) => {
    setErrorMessage(null);
    const picked = pickSpeechItems({ cards, attempts: speechAttempts, occurrences, kind, choice });
    if (picked.length === 0) {
      setErrorMessage(kind === 'sentence' && choice === 'plan' && sentenceCount === 0
        ? 'هیچ کارتی جمله ندارد؛ واژه‌ها را از کتاب‌ها بساز یا جملهٔ نمونه به کارت‌ها اضافه کن.'
        : choice === 'weak' ? 'مورد ضعیفی نمانده؛ آفرین!' : 'برای امروز چیزی نمانده؛ آفرین!');
      return;
    }
    setSpeakKind(kind);
    setCardChoice(choice);
    setSpeakingItems(picked);
    setSessionTries([]);
    setMode('speaking');
    setPracticeState('active');
  };


  const startPractice = async () => {
    setErrorMessage(null);
    if (mode === 'speaking') { startSpeaking(); return; }

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
    }
  };

  const handleSpeakingFinish = ({ average: avgScore, tried }: { average: number; tried: SpeechAttempt[] }) => {
      setSessionTries(tried);
      if (tried.length === 0) { setPracticeState('idle'); return; }
      setScore(avgScore); // Reuse score state for avg
      setPracticeState('finished');
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

  const tab = (value: Mode, label: string) => (
      <button
        type="button"
        onClick={() => { setMode(value); setErrorMessage(null); }}
        aria-pressed={mode === value}
        className={`min-h-[40px] px-4 rounded-lg text-sm transition-all ${mode === value ? 'bg-white dark:bg-slate-700 shadow-sm font-bold text-brand-700 dark:text-white' : 'text-ink-muted dark:text-slate-400 hover:text-ink dark:hover:text-slate-200'}`}
      >
          {label}
      </button>
  );

  const choice = <T extends string>(current: T, value: T, set: (v: T) => void, label: React.ReactNode, disabled = false) => (
      <button
        type="button"
        onClick={() => set(value)}
        aria-pressed={current === value}
        disabled={disabled}
        className={`min-h-[40px] px-4 rounded-xl text-sm border transition-colors disabled:opacity-40 ${current === value ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/40 font-bold text-brand-700 dark:text-white' : 'border-slate-200 dark:border-slate-600 text-ink dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
      >
          {label}
      </button>
  );

  if (practiceState === 'idle') {
    return (
      <Shell>
          <header>
              <h1 className="text-2xl font-extrabold text-ink dark:text-white">تمرین مکالمه و آزمون</h1>
              <p className="text-sm text-ink-muted dark:text-slate-400 mt-1">واژه‌های تازه‌ات را در جمله بیازما یا تلفظشان را تمرین کن.</p>
          </header>

          <div role="group" aria-label="نوع تمرین" className="self-start flex flex-wrap gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
              {tab('quiz', 'آزمون چندگزینه‌ای')}
              {tab('speaking', 'تمرین تلفظ')}
              {tab('progress', 'پیشرفت تلفظ')}
          </div>

          {mode === 'progress' ? (
              <SpeechProgress attempts={speechAttempts} weakCount={counts.weak} dueCount={counts.due}
                onDeleteAttempt={a => onSaveSpeechAttempt({ ...a, isDeleted: true, updatedAt: new Date().toISOString() })}
                onPracticeWeak={() => startSpeaking(speakKind, 'weak')} onPracticeDue={() => startSpeaking(speakKind, 'plan')} />
          ) : (
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
                    : 'واژه‌هایت را در همان جمله‌ای که در کتاب دیدی بلند بخوان. هوش مصنوعی (Gemini یا مدل صوتی OpenRouter، از تنظیمات) کل جمله را می‌شنود و واژه‌به‌واژه نشان می‌دهد کدام درست، کدام نامفهوم و کدام اشتباه بود؛ روانی، تکیه و آهنگ جمله را هم نمره می‌دهد. هر مورد سر وقتش برای مرور برمی‌گردد.'}
            </p>
            {mode === 'speaking' && (
                <div className="flex flex-col gap-3 items-center mt-1">
                    <div role="group" aria-label="چه بخوانم" className="flex flex-wrap justify-center gap-2">
                        {choice<SpeechKind>(speakKind, 'sentence', setSpeakKind, <>واژه در جمله ({fa(sentenceCount)})</>, sentenceCount === 0)}
                        {choice<SpeechKind>(speakKind, 'word', setSpeakKind, 'فقط واژه')}
                    </div>
                    <div role="group" aria-label="کدام موردها" className="flex flex-wrap justify-center gap-2">
                        {choice<SpeechChoice>(cardChoice, 'plan', setCardChoice,
                            counts.due + counts.fresh === 0 ? 'برنامهٔ امروز: تمام شد'
                                : <>برنامهٔ امروز: {[counts.due > 0 && `${fa(counts.due)} مرور`, counts.fresh > 0 && `${fa(counts.fresh)} تازه`].filter(Boolean).join(' + ')}</>)}
                        {choice<SpeechChoice>(cardChoice, 'weak', setCardChoice, <>موردهای ضعیف ({fa(counts.weak)})</>, counts.weak === 0)}
                    </div>
                </div>
            )}
            {errorMessage && (
                <p role="alert" className="mt-1 px-4 py-3 rounded-2xl bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 text-sm">
                    {errorMessage}
                </p>
            )}
            <button type="button" onClick={startPractice} className={`${primaryButton} mt-3`}>
                {mode === 'quiz' ? 'شروع آزمون' : 'شروع تمرین'}
            </button>
          </section>
          )}
      </Shell>
    );
  }

  if (practiceState === 'finished') {
       // What still went wrong in each item's last try of the session.
       const lastTries = Array.from(new Map<string, SpeechAttempt>(sessionTries.map(t => [`${t.cardId || t.target}|${t.kind}`, t])).values());
       const sessionSounds = mode === 'speaking' ? weakSounds(lastTries, lastTries.length) : [];
       const results = mode === 'speaking' ? sessionResults(speechAttempts, sessionTries) : [];
       return (
        <Shell>
            <section className={`${panel} text-center py-12 flex flex-col items-center gap-2`}>
                <h2 className="text-2xl font-extrabold text-ink dark:text-white">آفرین، تمرین تمام شد!</h2>
                <p className="mt-4">
                    <span className="text-6xl font-extrabold text-brand-500 dark:text-brand-300">{fa(score)}</span>
                    <span className="text-xl text-ink-muted dark:text-slate-400 ms-2">از {fa(mode === 'quiz' ? questions.length : 100)}</span>
                </p>
                <p className="text-ink-muted dark:text-slate-400 mb-4">{mode === 'quiz' ? 'جواب درست' : 'میانگین نمرهٔ تلفظ'}</p>
                {sessionSounds.length > 0 && (
                    <div className="w-full max-w-md text-right mb-4">
                        <p className="text-sm font-bold text-ink dark:text-white mb-2">در این تمرین بیشتر روی این‌ها کار کن:</p>
                        <ul className="flex flex-col gap-1.5">
                            {sessionSounds.slice(0, 4).map(w => (
                                <li key={w.sound} className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-700/40 text-sm text-ink dark:text-slate-200">
                                    <span className="font-bold">{soundInfo(w.sound).label}</span>
                                    {w.words.length > 0 && <> در <bdi dir="ltr" className="font-en">{w.words.join(', ')}</bdi></>}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {results.length > 0 && (
                    <div className="w-full max-w-md flex flex-col items-stretch gap-2 mb-4">
                        <p className="text-sm font-bold text-ink dark:text-white text-right">موردهای این تمرین و مرور بعدشان</p>
                        <SessionResultList results={results} />
                    </div>
                )}
                <div className="flex flex-wrap justify-center gap-2">
                    {mode === 'speaking' && (
                        <button type="button" onClick={() => { setMode('progress'); setPracticeState('idle'); }} className={secondaryButton}>
                            دیدن پیشرفت تلفظ
                        </button>
                    )}
                    <button type="button" onClick={() => setPracticeState('idle')} className={secondaryButton}>
                        بازگشت به تمرین‌ها
                    </button>
                </div>
            </section>
        </Shell>
     );
  }

  // Render Speaking Mode
  if (mode === 'speaking' && practiceState === 'active') {
      return <Shell><SpeakingMode items={speakingItems} attempts={speechAttempts} onSaveAttempt={onSaveSpeechAttempt} onFinish={handleSpeakingFinish} audioOptions={audioOptions} /></Shell>;
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
