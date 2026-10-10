import React, { useState, useRef, useCallback, memo, useEffect } from 'react';
import { Flashcard } from '../types';
import { AiRequestOptions, generatePersianDetails } from '../services/geminiService';
import { lookupDictionary, fetchAudioData } from '../services/dictionaryService';
import { aiOrigin, dictionaryOrigin } from '../services/aiSettings';
import { fa, Icon } from './common/ui';

type FlashcardFormData = Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId' | 'isDeleted'>;

// --- TYPES ---
type ProcessStatus = 'pending' | 'loading' | 'done' | 'error' | 'timeout';

interface ProcessDetails {
    status: ProcessStatus;
    source?: string;
    error?: string;
}

interface DictionaryProcessDetails extends ProcessDetails {
    audioUrl?: string;
}

interface ProcessedWord {
    word: string;
    status: ProcessStatus;
    card: Partial<FlashcardFormData>;
    details: {
        dictionary: DictionaryProcessDetails;
        ai: ProcessDetails;
        audio: ProcessDetails;
    };
    isExpanded: boolean;
}

interface BulkAddViewProps {
    onSave: (cards: FlashcardFormData[], deckName: string) => Promise<void>;
    onCancel: () => void;
    showToast: (message: string) => void;
    concurrency: number;
    aiTimeout: number; // in seconds
    dictTimeout: number; // in seconds
    aiOptions?: AiRequestOptions;
}

// --- ICONS ---
const statusIcons = {
    pending: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>,
    loading: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin text-indigo-500"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>,
    done: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>,
    error: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>,
    timeout: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-yellow-500"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
};
const ChevronDown = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>;
const EditIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>;

const timeoutPromise = (ms: number, message: string) =>
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms));

// --- STATUS WORDS ---
const STATUS_LABEL: Record<ProcessStatus, string> = {
    pending: 'در صف',
    loading: 'در حال کار…',
    done: 'آماده',
    error: 'ناموفق',
    timeout: 'دیر جواب داد',
};

// --- DETAIL ROW COMPONENT ---
const DetailRow = memo(({ label, details, onRetry }: { label: string, details: ProcessDetails, onRetry: () => void }) => {
    const isFailed = ['error', 'timeout'].includes(details.status);
    return (
        <div className="flex items-center gap-3 py-2 px-3 text-sm border-t border-slate-200 dark:border-slate-700">
            <div className="w-6 shrink-0">{statusIcons[details.status]}</div>
            <div className="flex-1 min-w-0">
                <p className="font-bold text-ink dark:text-slate-200">{label}</p>
                {details.source && <p className="text-xs text-ink-muted dark:text-slate-400">منبع: <bdi dir="auto">{details.source}</bdi></p>}
                {details.error && (
                    <p className="flex gap-1 min-w-0 text-xs text-red-700 dark:text-red-300" title={details.error}>
                        <span className="shrink-0">خطا:</span><bdi dir="auto" className="truncate min-w-0">{details.error}</bdi>
                    </p>
                )}
            </div>
            {isFailed && (
                <button onClick={onRetry} title="دوباره" aria-label={`دوباره: ${label}`} className="w-9 h-9 shrink-0 flex items-center justify-center text-brand-600 dark:text-brand-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-full">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M2 11.5a10 10 0 0 1 18.8-4.3l-3.3 3.3a5 5 0 0 0-8.5 4.3"/></svg>
                </button>
            )}
        </div>
    );
});

const smallField = 'block w-full min-h-[40px] text-sm px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-ink dark:text-white focus:border-brand-500 focus:outline-none';
const iconButton = 'w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-600';

// --- REVIEW ITEM COMPONENT ---
const ReviewItem = memo(({
    item, onUpdateCard, onToggleDetails, onRetryPart
}: {
    item: ProcessedWord;
    onUpdateCard: (word: string, updatedCard: Partial<FlashcardFormData>) => void;
    onToggleDetails: (word: string) => void;
    onRetryPart: (word: string, part: 'dictionary' | 'ai' | 'audio') => void;
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState({ back: '', notes: '' });

    useEffect(() => {
        // CRITICAL FIX: Only sync if we are NOT editing. 
        // This prevents background updates (like audio finishing) from wiping out text while the user is typing.
        if (item.card && !isEditing) {
            setEditData({ back: item.card.back || '', notes: item.card.notes || '' });
        }
    }, [item.card, isEditing]);

    const handleSaveEdit = () => {
        onUpdateCard(item.word, { ...item.card, ...editData });
        setIsEditing(false);
    };

    const handleCancelEdit = () => {
        setEditData({ back: item.card.back || '', notes: item.card.notes || '' });
        setIsEditing(false);
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl">
            <div className="flex items-center gap-3 p-3">
                <div className="flex-shrink-0 w-5">{statusIcons[item.status]}</div>
                {isEditing ? (
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                        <p dir="ltr" className="font-en font-bold text-ink dark:text-white truncate text-right">{item.word}</p>
                        <input type="text" dir="rtl" value={editData.back} onChange={e => setEditData(d => ({...d, back: e.target.value}))} className={smallField} placeholder="معنی فارسی" aria-label="معنی فارسی"/>
                        <input type="text" dir="rtl" value={editData.notes} onChange={e => setEditData(d => ({...d, notes: e.target.value}))} className={smallField} placeholder="یادداشت" aria-label="یادداشت"/>
                    </div>
                ) : (
                    <div className="flex-1 min-w-0">
                         <p dir="ltr" className="font-en font-bold text-ink dark:text-white truncate text-right">{item.word}</p>
                         {item.status === 'done' && <p dir="auto" className="text-sm text-ink-muted dark:text-slate-400 truncate text-right">{item.card.back}</p>}
                         {item.status !== 'done' && <p className="text-sm text-ink-muted dark:text-slate-400">{STATUS_LABEL[item.status]}</p>}
                    </div>
                )}
                <div className="flex items-center gap-1 shrink-0">
                    {isEditing ? (
                        <>
                            <button onClick={handleSaveEdit} aria-label="ذخیره" title="ذخیره" className={`${iconButton} text-emerald-600 dark:text-emerald-400`}><Icon.Check size={16} /></button>
                            <button onClick={handleCancelEdit} aria-label="لغو" title="لغو" className={`${iconButton} text-red-600 dark:text-red-400`}><Icon.Close size={16} /></button>
                        </>
                    ) : (
                       <>
                         {item.status === 'done' && <button onClick={() => setIsEditing(true)} aria-label={`ویرایش ${item.word}`} title="ویرایش" className={`${iconButton} text-ink-muted dark:text-slate-400`}><EditIcon /></button>}
                         <button onClick={() => onToggleDetails(item.word)} aria-expanded={item.isExpanded} aria-label={`جزئیات ${item.word}`} title="جزئیات" className={`${iconButton} text-ink-muted dark:text-slate-400`}>
                            <span className={`transition-transform ${item.isExpanded ? 'rotate-180' : ''}`}><ChevronDown /></span>
                         </button>
                       </>
                    )}
                </div>
            </div>
             {item.isExpanded && !isEditing && (
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-b-2xl">
                    <DetailRow label="دیکشنری" details={item.details.dictionary} onRetry={() => onRetryPart(item.word, 'dictionary')} />
                    <DetailRow label="معنی با هوش مصنوعی" details={item.details.ai} onRetry={() => onRetryPart(item.word, 'ai')} />
                    <DetailRow label="صدا" details={item.details.audio} onRetry={() => onRetryPart(item.word, 'audio')} />
                </div>
            )}
        </div>
    );
});


export const BulkAddView: React.FC<BulkAddViewProps> = ({ onSave, onCancel, showToast, concurrency, aiTimeout, dictTimeout, aiOptions }) => {
    const [step, setStep] = useState<'input' | 'processing' | 'review'>('input');
    const [wordsInput, setWordsInput] = useState('');
    const [deckName, setDeckName] = useState('New Vocabulary');
    const [processedWords, setProcessedWords] = useState<ProcessedWord[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const isCancelledRef = useRef(false);

    // The ref is the source of truth and is updated at once, so a step that
    // has just finished (the dictionary found an audio URL) is visible to the
    // next step before React renders.
    const processedWordsRef = useRef<ProcessedWord[]>([]);
    const commitWords = (next: ProcessedWord[]) => {
        processedWordsRef.current = next;
        setProcessedWords(next);
    };

    const updateWordState = (word: string, updater: (draft: ProcessedWord) => void) => {
        const prev = processedWordsRef.current;
        const index = prev.findIndex(p => p.word === word);
        if (index === -1) return;
        const newState = [...prev];
        // Create a deep copy to safely mutate nested objects like `details` and `card`
        const newWordState = JSON.parse(JSON.stringify(newState[index]));
        updater(newWordState);
        newState[index] = newWordState;
        commitWords(newState);
    };
    
    const processWordPart = useCallback(async (
        word: string,
        part: 'dictionary' | 'ai' | 'audio'
    ) => {
        if (isCancelledRef.current) return;

        try {
            if (part === 'dictionary') {
                updateWordState(word, draft => { draft.details.dictionary.status = 'loading'; });
                // The dictionaries in the order set in the settings; each has
                // `dictTimeout` seconds before the next one is asked.
                const details = await lookupDictionary(word, { timeoutMs: dictTimeout * 1000 });
                const source = details.source || 'دیکشنری';
                updateWordState(word, draft => {
                    draft.card = { ...draft.card,
                        pronunciation: details.pronunciation,
                        partOfSpeech: details.partOfSpeech,
                        definition: details.definitions,
                        exampleSentenceTarget: details.exampleSentences,
                    };
                    draft.details.dictionary = { status: 'done', source, audioUrl: details.audioUrl };
                });
            } else if (part === 'ai') {
                updateWordState(word, draft => { draft.details.ai.status = 'loading'; });
                const details = await Promise.race([
                    generatePersianDetails(word, aiOptions),
                    timeoutPromise(aiTimeout * 1000, `هوش مصنوعی دیر جواب داد.`)
                ]);
                updateWordState(word, draft => {
                    // CRITICAL FIX: Check if the user has already manually entered values.
                    // If existing values are present and not empty, prioritize user input over delayed AI response.
                    const currentBack = draft.card.back;
                    const currentNotes = draft.card.notes;
                    
                    // Use the user's manual input if available, otherwise use AI result
                    const finalBack = (currentBack && currentBack.trim() !== '') ? currentBack : details.back;
                    const finalNotes = (currentNotes && currentNotes.trim() !== '') ? currentNotes : details.notes;

                    draft.card = { ...draft.card, back: finalBack, notes: finalNotes, ...(details.origin ? { origin: details.origin } : {}) };
                    draft.details.ai = { status: 'done', source: details.origin?.provider || 'هوش مصنوعی' };
                });
            } else if (part === 'audio') {
                const wordState = processedWordsRef.current.find(p => p.word === word);
                const audioUrl = wordState?.details.dictionary.audioUrl;

                if (!audioUrl) {
                    updateWordState(word, draft => {
                         if (draft.details.audio.status === 'pending') {
                            draft.details.audio = { status: 'error', error: 'صدایی برای این واژه پیدا نشد.' };
                        }
                    });
                    return;
                }
                updateWordState(word, draft => { draft.details.audio.status = 'loading'; });
                // The sound is checked once, and the card keeps its address
                // (not the sound itself), so it syncs to other devices.
                await fetchAudioData(audioUrl);
                updateWordState(word, draft => {
                    draft.card.audioSrc = audioUrl;
                    draft.details.audio = { status: 'done' };
                });
            }
        } catch (error) {
            const errorMessage = (error instanceof Error) ? error.message : "خطای ناشناخته.";
            const status: ProcessStatus = errorMessage.toLowerCase().includes('timeout') ? 'timeout' : 'error';
            updateWordState(word, draft => {
                if (part === 'dictionary') {
                    draft.details.dictionary = { status, error: errorMessage };
                    draft.details.audio = { status: 'error', error: 'دیکشنری جواب نداد.' };
                } else if (part === 'ai') {
                    draft.details.ai = { status, error: errorMessage };
                } else if (part === 'audio') {
                    draft.details.audio = { status, error: errorMessage };
                }
            });
        }
    }, [aiTimeout, dictTimeout, aiOptions]);

    const handleProcessWord = useCallback(async (word: string) => {
        if (isCancelledRef.current) return;
        updateWordState(word, draft => { draft.status = 'loading'; });
    
        // Step 1: Run Dictionary and AI fetches in parallel
        const dictPromise = processWordPart(word, 'dictionary');
        const aiPromise = processWordPart(word, 'ai');
        await Promise.allSettled([dictPromise, aiPromise]);
    
        // Step 2: Conditionally fetch audio AFTER dictionary is done
        const wordStateAfterApis = processedWordsRef.current.find(p => p.word === word);
        if (wordStateAfterApis?.details.dictionary.status === 'done' && wordStateAfterApis.details.dictionary.audioUrl) {
            await processWordPart(word, 'audio');
        }
    
        // Step 3: Finalize the overall status based on the outcome
        const finalState = processedWordsRef.current.find(p => p.word === word);
        if (finalState) {
            // A card is considered successful if the essential parts (dict, ai) are done.
            // Audio is optional and its failure shouldn't fail the card.
            const isSuccess = finalState.details.dictionary.status === 'done' && finalState.details.ai.status === 'done';
            updateWordState(word, draft => {
                draft.status = isSuccess ? 'done' : 'error';
            });
        }
    }, [processWordPart]);

    const runProcessingQueue = async (wordsQueue: string[]) => {
        isCancelledRef.current = false;
        setIsProcessing(true);
        if (step !== 'processing') setStep('processing');
        
        const queue = [...wordsQueue];
        const workers = Array(concurrency).fill(null).map(async () => {
            while (queue.length > 0) {
                if (isCancelledRef.current) break;
                const word = queue.shift();
                if (word) await handleProcessWord(word);
            }
        });
        await Promise.all(workers);

        if (!isCancelledRef.current) {
            setIsProcessing(false);
            if (step !== 'review') {
                const finalWords = processedWordsRef.current;
                const successCount = finalWords.filter(p => p.status === 'done').length;
                const failureCount = finalWords.length - successCount;
                showToast(`ساختن کارت‌ها تمام شد: ${fa(successCount)} آماده، ${fa(failureCount)} ناموفق.`);
                setStep('review');
            }
        }
    };
    
    const handleInitialProcess = () => {
        const words: string[] = Array.from(new Set(wordsInput.split('\n').map(word => word.trim()).filter(Boolean)));
        if (words.length === 0) { showToast("دست‌کم یک واژه بنویس."); return; }
        if (!deckName.trim()) { showToast("نام دسته را بنویس."); return; }
        
        commitWords(words.map(word => ({
            word,
            status: 'pending',
            card: { front: word },
            details: {
                dictionary: { status: 'pending' },
                ai: { status: 'pending' },
                audio: { status: 'pending' }
            },
            isExpanded: false
        })));
        runProcessingQueue(words);
    };

    const handleRetryAllFailed = () => {
        const failedWords = processedWords.filter(p => ['error', 'timeout'].includes(p.status)).map(p => p.word);
        if(failedWords.length > 0) {
            runProcessingQueue(failedWords);
        } else {
            showToast("واژهٔ ناموفقی نمانده.");
        }
    };

    const handleRetryPart = async (word: string, part: 'dictionary' | 'ai' | 'audio') => {
        await processWordPart(word, part);
    
        // After the part is retried, re-evaluate the overall status
        const finalState = processedWordsRef.current.find(p => p.word === word);
        if (finalState) {
            const isSuccess = finalState.details.dictionary.status === 'done' && finalState.details.ai.status === 'done';
            
            // Only update if the status needs changing (e.g., from 'error' to 'done')
            if (isSuccess && finalState.status !== 'done') {
                updateWordState(word, draft => { draft.status = 'done'; });
            } else if (!isSuccess && finalState.status === 'done') {
                // This case is unlikely but handles if a retry causes failure
                updateWordState(word, draft => { draft.status = 'error'; });
            }
        }
    };
    
    const handleUpdateWordCard = (word: string, updatedCard: Partial<FlashcardFormData>) => {
        updateWordState(word, draft => {
            draft.card = { ...draft.card, ...updatedCard };
        });
    };

    const handleSave = async () => {
        setIsSaving(true);
        const cardsToSave = processedWords.filter(pw => pw.status === 'done' && pw.card).map(pw => ({
            ...(pw.card as FlashcardFormData),
            // The service that answered; a card the AI never filled came from the dictionary.
            origin: pw.card?.origin || (pw.details.ai.status === 'done' ? aiOrigin(aiOptions) : dictionaryOrigin()),
        }));
        if (cardsToSave.length > 0) {
            await onSave(cardsToSave, deckName);
        } else {
            showToast("کارتی برای ذخیره ساخته نشد.");
            onCancel();
        }
        setIsSaving(false);
    };

    const handleCancelProcessing = () => {
        isCancelledRef.current = true;
        setIsProcessing(false);
        const successCount = processedWords.filter(p => p.status === 'done').length;
        showToast(`متوقف شد؛ ${fa(successCount)} واژه آماده شد.`);
        setStep('review');
    };

    const toggleDetails = (word: string) => {
        updateWordState(word, draft => { draft.isExpanded = !draft.isExpanded; });
    };

    const panel = 'max-w-3xl mx-auto w-full bg-white dark:bg-slate-800 p-5 sm:p-8 rounded-3xl';
    const secondaryButton = 'min-h-[44px] px-5 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors';
    const primaryButton = 'min-h-[44px] px-6 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-wait';

    const renderInputStep = () => (
        <div className={panel}>
            <h1 className="text-2xl font-extrabold mb-1 text-ink dark:text-white">افزودن گروهی</h1>
            <p className="text-ink-muted dark:text-slate-400 mb-6">واژه‌های انگلیسی را هر کدام در یک خط بنویس؛ برای هر کدام خودکار کارت ساخته می‌شود.</p>

            <div className="flex flex-col gap-6">
                <div>
                    <label htmlFor="words-input" className="block text-sm font-bold text-ink dark:text-slate-200">واژه‌ها</label>
                    <textarea
                        id="words-input"
                        dir="ltr"
                        rows={10}
                        value={wordsInput}
                        onChange={e => setWordsInput(e.target.value)}
                        className="mt-1 block w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-ink dark:text-white font-en placeholder-slate-400 focus:border-brand-500 focus:outline-none"
                        placeholder="ephemeral&#10;ubiquitous&#10;mellifluous"
                    />
                </div>
                <div>
                    <label htmlFor="deckName-bulk" className="block text-sm font-bold text-ink dark:text-slate-200">افزودن به دسته</label>
                    <input
                        type="text"
                        id="deckName-bulk"
                        dir="auto"
                        value={deckName}
                        onChange={e => setDeckName(e.target.value)}
                        className="mt-1 block w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-ink dark:text-white font-en focus:border-brand-500 focus:outline-none"
                    />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={onCancel} className={secondaryButton}>
                        لغو
                    </button>
                    <button type="button" onClick={handleInitialProcess} className={primaryButton}>
                        ساختن کارت‌ها
                    </button>
                </div>
            </div>
        </div>
    );

    const renderProcessingStep = () => {
        const completed = processedWords.filter(p => p.status !== 'pending' && p.status !== 'loading').length;
        const total = processedWords.length;
        const progress = total > 0 ? (completed / total) * 100 : 0;

        return (
            <div className={panel}>
                <div className="flex justify-between items-baseline gap-3 mb-4">
                    <h1 className="text-2xl font-extrabold text-ink dark:text-white">در حال ساختن کارت‌ها…</h1>
                    <span className="text-sm font-bold text-ink-muted dark:text-slate-400 shrink-0">{fa(completed)} از {fa(total)}</span>
                </div>
                 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 mb-4 overflow-hidden">
                    <div className="bg-brand-500 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                </div>
                <div className="flex flex-col gap-2 h-96 overflow-y-auto pe-1">
                    {processedWords.map(item => (
                        <div key={item.word} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                            <span className="shrink-0">{statusIcons[item.status]}</span>
                            <span dir="ltr" className="flex-1 min-w-0 font-en font-bold text-ink dark:text-slate-200 truncate text-right">{item.word}</span>
                            <span className="text-sm text-ink-muted dark:text-slate-400 shrink-0">{STATUS_LABEL[item.status]}</span>
                        </div>
                    ))}
                </div>
                <div className="text-center mt-6">
                    <button onClick={handleCancelProcessing} className="min-h-[44px] px-6 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors">
                        توقف
                    </button>
                </div>
            </div>
        );
    };

    const renderReviewStep = () => {
        const successCount = processedWords.filter(p => p.status === 'done').length;
        const failedCount = processedWords.filter(p => ['error', 'timeout'].includes(p.status)).length;
        return (
            <div className={panel}>
                <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-3 mb-5">
                    <div>
                        <h1 className="text-2xl font-extrabold mb-1 text-ink dark:text-white">بررسی و ذخیره</h1>
                        <p className="text-ink-muted dark:text-slate-400">
                            <span className="text-emerald-700 dark:text-emerald-300 font-bold">{fa(successCount)} کارت</span> آماده، <span className="text-red-700 dark:text-red-300 font-bold">{fa(failedCount)} ناموفق</span>. معنی‌ها را ویرایش کن یا جزئیات هر واژه را ببین.
                        </p>
                    </div>
                    {failedCount > 0 && <button onClick={handleRetryAllFailed} className="min-h-[44px] px-4 rounded-xl text-sm font-bold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-900/60 transition-colors shrink-0">تلاش دوباره برای ناموفق‌ها</button>}
                </div>

                <div className="flex flex-col gap-2 h-96 overflow-y-auto p-2 bg-slate-100 dark:bg-slate-900/50 rounded-2xl">
                    {processedWords.map(item => (
                       <ReviewItem 
                            key={item.word}
                            item={item}
                            onUpdateCard={handleUpdateWordCard}
                            onToggleDetails={toggleDetails}
                            onRetryPart={handleRetryPart}
                       />
                    ))}
                </div>

                <div className="flex flex-wrap justify-end gap-3 pt-6">
                    <button type="button" onClick={() => { setWordsInput(''); setStep('input'); }} className={secondaryButton}>
                        افزودن واژه‌های بیشتر
                    </button>
                    <button type="button" onClick={handleSave} disabled={isSaving || successCount === 0} className={primaryButton}>
                        {isSaving ? 'در حال ذخیره…' : `ذخیرهٔ ${fa(successCount)} کارت`}
                    </button>
                </div>
            </div>
        );
    };

    const renderContent = () => {
        switch (step) {
            case 'processing': return renderProcessingStep();
            case 'review': return renderReviewStep();
            case 'input': default: return renderInputStep();
        }
    };

    return <div dir="rtl" className="font-fa animate-flip-in">{renderContent()}</div>;
};
