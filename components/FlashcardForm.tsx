import React, { useState, useEffect, useRef } from 'react';
import { Flashcard, Deck } from '../types';
import { 
  generatePersianDetails, 
  getPronunciationFeedback,
  blobToBase64 
} from '../services/geminiService';
import {
  fetchFromFreeDictionary,
  fetchFromMerriamWebster,
  fetchAudioData,
  DictionaryResult
} from '../services/dictionaryService';


// Fix: Omit `createdAt` and `isDeleted` as they are not managed by the form.
type FlashcardFormData = Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId' | 'createdAt' | 'updatedAt' | 'isDeleted'>;
type DictionarySource = 'free' | 'mw';

interface FlashcardFormProps {
  card: Flashcard | null;
  decks: Deck[];
  onSave: (card: FlashcardFormData, deckName: string) => void;
  onCancel: () => void;
  initialDeckName?: string;
  showToast: (message: string) => void;
  defaultApiSource: DictionarySource;
}

const MicIcon = ({ recording }: { recording: boolean }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={recording ? 'text-red-500' : 'text-slate-500'}>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
);

const SpeakerIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>;
const LoadingIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>;


const FlashcardForm: React.FC<FlashcardFormProps> = ({ card, decks, onSave, onCancel, initialDeckName, showToast, defaultApiSource }) => {
  const [formData, setFormData] = useState<FlashcardFormData>({
    front: '',
    back: '',
    pronunciation: '',
    partOfSpeech: '',
    definition: [],
    exampleSentenceTarget: [],
    notes: '',
    audioSrc: undefined,
  });
  const [deckName, setDeckName] = useState('Default Deck');
  
  // Loading states
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [isFetchingAudio, setIsFetchingAudio] = useState(false);

  // Pronunciation feedback state
  const [isRecording, setIsRecording] = useState(false);
  const [pronunciationFeedback, setPronunciationFeedback] = useState('');
  const [isCheckingPronunciation, setIsCheckingPronunciation] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (card) {
      const { 
          front, back, pronunciation, partOfSpeech, definition, 
          exampleSentenceTarget, notes, audioSrc 
      } = card;

      // Fix: Ensure 'definition' and 'exampleSentenceTarget' are always arrays to handle legacy data.
      const safeDefinition = Array.isArray(definition) ? definition : (definition ? [String(definition)] : []);
      const safeExamples = Array.isArray(exampleSentenceTarget) ? exampleSentenceTarget : (exampleSentenceTarget ? [String(exampleSentenceTarget)] : []);

      setFormData({ 
          front, back, pronunciation, partOfSpeech, 
          definition: safeDefinition, 
          exampleSentenceTarget: safeExamples,
          notes, audioSrc 
      });

      if (initialDeckName) {
        setDeckName(initialDeckName);
      }
    } else {
      // Reset for new card
      setFormData({
        front: '',
        back: '',
        pronunciation: '',
        partOfSpeech: '',
        definition: [],
        exampleSentenceTarget: [],
        notes: '',
        audioSrc: undefined,
      });
      setDeckName('Default Deck');
    }
  }, [card, initialDeckName]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleTextAreaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const valueAsArray = value.split('\n\n').filter(s => s.trim() !== '');
    setFormData(prev => ({ ...prev, [name]: valueAsArray }));
  };


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.front && formData.back && deckName) {
      onSave(formData, deckName);
    }
  };
  
  const handleFetchDetails = async () => {
      if (!formData.front) return;
      setIsFetchingDetails(true);
      setFormData(prev => ({...prev, audioSrc: undefined}));
      
      try {
          const fetcher = defaultApiSource === 'free' ? fetchFromFreeDictionary : fetchFromMerriamWebster;
          const details: DictionaryResult = await fetcher(formData.front);
                    
          setFormData(prev => ({
              ...prev,
              pronunciation: details.pronunciation,
              partOfSpeech: details.partOfSpeech,
              definition: details.definitions,
              exampleSentenceTarget: details.exampleSentences,
              audioSrc: details.audioUrl,
          }));
          showToast(`Details fetched from ${defaultApiSource === 'free' ? 'Free Dictionary' : 'Merriam-Webster'}.`);

      } catch (error) {
          console.error("Failed to fetch details from dictionary API:", error);
          showToast(`Could not find "${formData.front}" in the selected dictionary.`);
      } finally {
          setIsFetchingDetails(false);
      }
  };

  const handleGenerateAiDetails = async () => {
    if (!formData.front) return;
    setIsGeneratingAI(true);
    try {
      const details = await generatePersianDetails(formData.front);
      setFormData(prev => ({
        ...prev,
        back: details.back,
        notes: details.notes
      }));
    } catch(error) {
       console.error("Failed to generate AI details:", error);
       showToast('AI generation failed.');
    } finally {
      setIsGeneratingAI(false);
    }
  };

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
          setIsCheckingPronunciation(true);
          setPronunciationFeedback('');
          try {
            const base64Audio = await blobToBase64(audioBlob);
            const feedback = await getPronunciationFeedback(formData.front, base64Audio, audioBlob.type);
            setPronunciationFeedback(feedback);
          } catch (err) {
            setPronunciationFeedback('Could not get feedback. Please try again.');
          } finally {
            setIsCheckingPronunciation(false);
             stream.getTracks().forEach(track => track.stop());
          }
        };

        mediaRecorderRef.current.start();
        setIsRecording(true);
      } catch (error) {
        console.error("Error accessing microphone:", error);
        alert("Microphone access is required for this feature. Please enable it in your browser settings.");
      }
    }
  };

  const playAudio = async () => {
    if (!formData.audioSrc || isFetchingAudio) return;
    setIsFetchingAudio(true);
    try {
        const dataUrl = await fetchAudioData(formData.audioSrc);
        const audio = new Audio(dataUrl);
        audio.play();
        audio.onended = () => setIsFetchingAudio(false);
    } catch (error) {
        console.error("Failed to play audio:", error);
        showToast("Could not play audio.");
        setIsFetchingAudio(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto bg-white dark:bg-slate-800 p-8 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6 text-slate-800 dark:text-slate-100">{card ? 'Edit Card' : 'Create New Card'}</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
            <label htmlFor="front" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Front (English Word) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
                <input
                    type="text"
                    id="front"
                    name="front"
                    value={formData.front || ''}
                    onChange={handleTextChange}
                    required
                    className="mt-1 block w-full pl-3 pr-10 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="e.g., hello"
                />
                <button type="button" onClick={handleToggleRecording} disabled={!formData.front || isCheckingPronunciation} className="absolute inset-y-0 right-0 top-1 flex items-center pr-3 disabled:opacity-50" aria-label="Record pronunciation">
                    <MicIcon recording={isRecording} />
                </button>
            </div>
             {(isCheckingPronunciation || pronunciationFeedback) && (
                <div className="mt-2 text-sm p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                    {isCheckingPronunciation ? 'Analyzing...' : `AI Feedback: ${pronunciationFeedback}`}
                </div>
             )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button type="button" onClick={handleFetchDetails} disabled={isFetchingDetails || !formData.front} className="w-full px-4 py-3 text-sm font-medium text-white bg-slate-600 hover:bg-slate-700 dark:bg-slate-500 dark:hover:bg-slate-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-wait">
                {isFetchingDetails ? 'Fetching...' : 'Fetch Details'}
            </button>
            <button type="button" onClick={handleGenerateAiDetails} disabled={isGeneratingAI || !formData.front} className="w-full px-4 py-3 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-wait">
                {isGeneratingAI ? 'Generating...' : '✨ AI Generate Persian'}
            </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             {/* Deck Name */}
            <div>
                <label htmlFor="deckName" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Deck <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    id="deckName"
                    name="deckName"
                    value={deckName}
                    onChange={(e) => setDeckName(e.target.value)}
                    required
                    list="deck-options"
                    className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="e.g., Chapter 1 Verbs"
                />
                <datalist id="deck-options">
                    {decks.map(d => <option key={d.id} value={d.name} />)}
                </datalist>
            </div>
            {/* Back of Card */}
          <div>
            <label htmlFor="back" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Back (Persian) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="back"
              name="back"
              value={formData.back || ''}
              onChange={handleTextChange}
              required
              className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Pronunciation */}
          <div>
            <label htmlFor="pronunciation" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Pronunciation (IPA)
            </label>
            <input
              type="text"
              id="pronunciation"
              name="pronunciation"
              value={formData.pronunciation || ''}
              onChange={handleTextChange}
              className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
            <div>
              <label htmlFor="partOfSpeech" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Part of Speech
              </label>
              <input
                type="text"
                id="partOfSpeech"
                name="partOfSpeech"
                value={formData.partOfSpeech || ''}
                onChange={handleTextChange}
                className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>
        </div>
        
        <div>
          <label htmlFor="definition" className="block text-sm font-medium text-slate-700 dark:text-slate-300">English Definition(s)</label>
          <textarea id="definition" name="definition" rows={3} value={formData.definition?.join('\n\n') || ''} onChange={handleTextAreaChange} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="Separate multiple definitions with two newlines (Enter key twice)"/>
        </div>
        
        <div>
           <label htmlFor="exampleSentenceTarget" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Example Sentence(s)</label>
          <textarea id="exampleSentenceTarget" name="exampleSentenceTarget" rows={3} value={formData.exampleSentenceTarget?.join('\n\n') || ''} onChange={handleTextAreaChange} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="Separate multiple examples with two newlines (Enter key twice)"/>
        </div>

        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Notes / Mnemonics (Persian)</label>
          <textarea id="notes" name="notes" rows={3} value={formData.notes || ''} onChange={handleTextChange} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
        </div>

        <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Pronunciation Audio</label>
            <div className="mt-1 flex items-center gap-4 h-[52px]">
                {formData.audioSrc ? (
                    <button 
                        type="button" 
                        onClick={playAudio} 
                        disabled={isFetchingAudio}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
                    >
                        {isFetchingAudio ? <LoadingIcon/> : <SpeakerIcon />}
                        <span>Play Audio</span>
                    </button>
                ) : (
                     <span className="text-sm text-slate-500 dark:text-slate-400 px-1">
                        {isFetchingDetails ? "Fetching details..." : "Audio will be fetched with details."}
                     </span>
                )}
            </div>
        </div>

        <div className="flex justify-end gap-4 pt-4">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
            Cancel
          </button>
          <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors">
            Save Card
          </button>
        </div>
      </form>
    </div>
  );
};

export default FlashcardForm;