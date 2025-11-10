import React, { useState } from 'react';
import { Flashcard } from '../types';
import { generatePersianDetails } from '../services/geminiService';
import { fetchFromFreeDictionary, fetchFromMerriamWebster, fetchAudioData } from '../services/dictionaryService';

type FlashcardFormData = Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId' | 'isDeleted'>;
type ProcessingStatus = 'pending' | 'loading' | 'done' | 'error';
interface ProcessedWord {
    word: string;
    status: ProcessingStatus;
    card?: FlashcardFormData;
    error?: string;
}
type DictionarySource = 'free' | 'mw';

interface BulkAddViewProps {
    onSave: (cards: FlashcardFormData[], deckName: string) => Promise<void>;
    onCancel: () => void;
    showToast: (message: string) => void;
    defaultApiSource: DictionarySource;
}

const statusIcons = {
    pending: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>,
    loading: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin text-indigo-500"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>,
    done: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>,
    error: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>,
};

export const BulkAddView: React.FC<BulkAddViewProps> = ({ onSave, onCancel, showToast, defaultApiSource }) => {
    const [step, setStep] = useState<'input' | 'processing' | 'review'>('input');
    const [wordsInput, setWordsInput] = useState('');
    const [deckName, setDeckName] = useState('New Vocabulary');
    const [processedWords, setProcessedWords] = useState<ProcessedWord[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    const handleProcessWords = async () => {
        const words = wordsInput.split('\n').map(w => w.trim()).filter(Boolean);
        if (words.length === 0) {
            showToast("Please enter at least one word.");
            return;
        }
        if (!deckName.trim()) {
            showToast("Please enter a deck name.");
            return;
        }

        setStep('processing');
        const initialProcessedWords: ProcessedWord[] = words.map(word => ({ word, status: 'pending' }));
        setProcessedWords(initialProcessedWords);
        
        let completedCount = 0;
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            
            setProcessedWords(prev => prev.map((item, index) => index === i ? { ...item, status: 'loading' } : item));

            try {
                const dictionaryFetcher = defaultApiSource === 'free' ? fetchFromFreeDictionary : fetchFromMerriamWebster;
                const dictionaryPromise = dictionaryFetcher(word);
                const aiPromise = generatePersianDetails(word);

                const [dictDetails, aiDetails] = await Promise.all([dictionaryPromise, aiPromise]);

                let audioDataUrl: string | undefined = undefined;
                if (dictDetails.audioUrl) {
                    try { audioDataUrl = await fetchAudioData(dictDetails.audioUrl); } catch (audioError) { console.warn(`Could not fetch audio for ${word}`, audioError); }
                }
                
                const newCard: FlashcardFormData = {
                    front: word,
                    back: aiDetails.back,
                    pronunciation: dictDetails.pronunciation,
                    partOfSpeech: dictDetails.partOfSpeech,
                    definition: dictDetails.definitions,
                    exampleSentenceTarget: dictDetails.exampleSentences,
                    notes: aiDetails.notes,
                    audioSrc: audioDataUrl,
                };
                
                setProcessedWords(prev => prev.map((item, index) => index === i ? { ...item, status: 'done', card: newCard } : item));
            } catch (error) {
                console.error(`Failed to process word "${word}":`, error);
                const errorMessage = (error instanceof Error) ? error.message : "An unknown error occurred.";
                setProcessedWords(prev => prev.map((item, index) => index === i ? { ...item, status: 'error', error: errorMessage } : item));
            }
            completedCount++;
            if (completedCount === words.length) {
                setTimeout(() => setStep('review'), 500);
            }
        }
    };
    
    const handleSave = async () => {
        setIsSaving(true);
        const cardsToSave = processedWords.filter(pw => pw.status === 'done' && pw.card).map(pw => pw.card!);
        if (cardsToSave.length > 0) {
            await onSave(cardsToSave, deckName);
        } else {
            showToast("No cards to save.");
            onCancel();
        }
    };

    const renderInputStep = () => (
        <div className="max-w-3xl mx-auto bg-white dark:bg-slate-800 p-8 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-1 text-slate-800 dark:text-slate-100">Bulk Add Words</h2>
            <p className="text-slate-600 dark:text-slate-400 mb-6">Enter a list of English words, one per line. We'll automatically create flashcards for them.</p>
            
            <div className="space-y-6">
                <div>
                    <label htmlFor="words-input" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Words to Add</label>
                    <textarea 
                        id="words-input"
                        rows={10}
                        value={wordsInput}
                        onChange={e => setWordsInput(e.target.value)}
                        className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                        placeholder="ephemeral&#10;ubiquitous&#10;mellifluous"
                    />
                </div>
                <div>
                    <label htmlFor="deckName-bulk" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Add to Deck</label>
                    <input 
                        type="text"
                        id="deckName-bulk"
                        value={deckName}
                        onChange={e => setDeckName(e.target.value)}
                        className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                </div>
                <div className="flex justify-end gap-4 pt-4">
                    <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
                        Cancel
                    </button>
                    <button type="button" onClick={handleProcessWords} className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors">
                        Process Words
                    </button>
                </div>
            </div>
        </div>
    );
    
    const renderProcessingStep = () => (
        <div className="max-w-3xl mx-auto bg-white dark:bg-slate-800 p-8 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-4 text-slate-800 dark:text-slate-100">Creating Flashcards...</h2>
            <div className="space-y-2 h-96 overflow-y-auto pr-2">
                {processedWords.map((item, index) => (
                    <div key={index} className="flex items-center gap-4 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-md">
                        {statusIcons[item.status]}
                        <span className="flex-1 font-medium text-slate-700 dark:text-slate-200">{item.word}</span>
                        <span className="text-sm text-slate-500 dark:text-slate-400 capitalize">{item.status}</span>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderReviewStep = () => {
        const successCount = processedWords.filter(p => p.status === 'done').length;
        const errorCount = processedWords.filter(p => p.status === 'error').length;
        return (
            <div className="max-w-3xl mx-auto bg-white dark:bg-slate-800 p-8 rounded-lg shadow-md">
                <h2 className="text-2xl font-bold mb-1 text-slate-800 dark:text-slate-100">Review & Save</h2>
                <p className="text-slate-600 dark:text-slate-400 mb-6">
                    <span className="text-green-600 dark:text-green-400 font-semibold">{successCount} cards</span> ready to be saved. <span className="text-red-600 dark:text-red-400 font-semibold">{errorCount} words</span> failed.
                </p>

                <div className="space-y-4 h-96 overflow-y-auto p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                    {successCount > 0 && (
                        <div>
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">Ready to Save</h3>
                            <ul className="space-y-2">
                                {processedWords.filter(p => p.status === 'done').map((item, i) => (
                                    <li key={i} className="flex justify-between items-center p-3 bg-white dark:bg-slate-800 rounded-md shadow-sm">
                                        <span className="font-semibold">{item.word}</span>
                                        <span className="text-slate-500 dark:text-slate-400">{item.card?.back}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                     {errorCount > 0 && (
                        <div>
                            <h3 className="text-lg font-semibold text-red-700 dark:text-red-400 mt-6 mb-2">Failed Words</h3>
                             <ul className="space-y-2">
                                {processedWords.filter(p => p.status === 'error').map((item, i) => (
                                    <li key={i} className="flex justify-between items-center p-3 bg-red-50 dark:bg-red-900/30 rounded-md">
                                        <span className="font-semibold text-red-800 dark:text-red-200">{item.word}</span>
                                        <span className="text-xs text-red-600 dark:text-red-300 truncate">{item.error}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
                
                <div className="flex justify-end gap-4 pt-6">
                    <button type="button" onClick={() => setStep('input')} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
                        Back
                    </button>
                    <button type="button" onClick={handleSave} disabled={isSaving || successCount === 0} className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-wait">
                        {isSaving ? 'Saving...' : `Save ${successCount} Cards`}
                    </button>
                </div>
            </div>
        );
    };

    return <div className="animate-flip-in">{renderInputStep()}</div>;
};
