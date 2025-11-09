import React, { useState, useEffect, useRef } from 'react';
import { Flashcard, Deck } from '../types';
import { 
  generateFlashcardDetails, 
  generateAudio, 
  getGrammarExplanation,
  getPronunciationFeedback,
  blobToBase64 
} from '../services/geminiService';
import Modal from './Modal';


type FlashcardFormData = Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId'>;

interface FlashcardFormProps {
  card: Flashcard | null;
  decks: Deck[];
  onSave: (card: FlashcardFormData, deckName: string) => void;
  onCancel: () => void;
  initialDeckName?: string;
}

const MicIcon = ({ recording }: { recording: boolean }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={recording ? 'text-red-500' : 'text-slate-500'}>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
);


const FlashcardForm: React.FC<FlashcardFormProps> = ({ card, decks, onSave, onCancel, initialDeckName }) => {
  const [formData, setFormData] = useState<FlashcardFormData>({
    front: '',
    back: '',
    pronunciation: '',
    partOfSpeech: '',
    definition: '',
    exampleSentenceTarget: '',
    notes: '',
    audioSrc: undefined,
  });
  const [deckName, setDeckName] = useState('Default Deck');
  const [isGenerating, setIsGenerating] = useState(false);

  // Pronunciation feedback state
  const [isRecording, setIsRecording] = useState(false);
  const [pronunciationFeedback, setPronunciationFeedback] = useState('');
  const [isCheckingPronunciation, setIsCheckingPronunciation] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Grammar explanation state
  const [grammarExplanation, setGrammarExplanation] = useState('');
  const [isExplainingGrammar, setIsExplainingGrammar] = useState(false);
  const [showGrammarModal, setShowGrammarModal] = useState(false);

  useEffect(() => {
    if (card) {
      // Destructure to only get the fields relevant to the form,
      // excluding SRS data and the old deckId. This prevents stale data.
      const { 
          front, back, pronunciation, partOfSpeech, definition, 
          exampleSentenceTarget, notes, audioSrc 
      } = card;
      setFormData({ 
          front, back, pronunciation, partOfSpeech, definition, 
          exampleSentenceTarget, notes, audioSrc 
      });

      if (initialDeckName) {
        setDeckName(initialDeckName);
      }
    } else {
      // Reset the form when creating a new card
      setFormData({
        front: '',
        back: '',
        pronunciation: '',
        partOfSpeech: '',
        definition: '',
        exampleSentenceTarget: '',
        notes: '',
        audioSrc: undefined,
      });
      setDeckName('Default Deck');
    }
  }, [card, initialDeckName]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.front && formData.back && deckName) {
      onSave(formData, deckName);
    }
  };
  
  const handleGenerateDetails = async () => {
    if (!formData.front) return;
    setIsGenerating(true);
    setFormData(prev => ({...prev, audioSrc: undefined}));

    try {
      const detailsPromise = generateFlashcardDetails(formData.front);
      const audioPromise = generateAudio(formData.front);
      const [details, audioSrc] = await Promise.all([detailsPromise, audioPromise]);
      
      setFormData(prev => ({
        ...prev,
        back: details.back,
        pronunciation: details.pronunciation,
        partOfSpeech: details.partOfSpeech,
        definition: details.definition,
        exampleSentenceTarget: details.exampleSentenceTarget,
        notes: details.notes,
        audioSrc: audioSrc,
      }));
    } catch (error) {
        console.error("Failed to generate all card details:", error);
    } finally {
        setIsGenerating(false);
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
  
  const handleExplainGrammar = async () => {
    if (!formData.exampleSentenceTarget) return;
    setIsExplainingGrammar(true);
    setShowGrammarModal(true);
    setGrammarExplanation('Analyzing grammar...');
    const explanation = await getGrammarExplanation(formData.exampleSentenceTarget);
    setGrammarExplanation(explanation);
    setIsExplainingGrammar(false);
  };

  return (
    <>
    <Modal show={showGrammarModal} onClose={() => setShowGrammarModal(false)} title="Grammar Explanation">
      {isExplainingGrammar ? <p>Loading...</p> : <p>{grammarExplanation}</p>}
    </Modal>
    <div className="max-w-3xl mx-auto bg-white dark:bg-slate-800 p-8 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6 text-slate-800 dark:text-slate-100">{card ? 'Edit Card' : 'Create New Card'}</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Front of Card */}
            <div>
                <div className="flex justify-between items-center">
                    <label htmlFor="front" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Front (English Word) <span className="text-red-500">*</span>
                    </label>
                    <button type="button" onClick={handleGenerateDetails} disabled={isGenerating || !formData.front} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50 disabled:cursor-wait">
                        {isGenerating ? 'Generating...' : '✨ AI Generate Details'}
                    </button>
                </div>
                <div className="relative">
                    <input
                        type="text"
                        id="front"
                        name="front"
                        value={formData.front || ''}
                        onChange={handleChange}
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
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
              onChange={handleChange}
              required
              className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
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
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="partOfSpeech" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Part of Speech
              </label>
              <input
                type="text"
                id="partOfSpeech"
                name="partOfSpeech"
                value={formData.partOfSpeech || ''}
                onChange={handleChange}
                className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Pronunciation Audio</label>
              <div className="flex items-center justify-center p-2 h-[42px] rounded-md bg-slate-100 dark:bg-slate-700/50">
                 {formData.audioSrc ? (
                    <audio controls src={formData.audioSrc} className="w-full h-8"></audio>
                ) : isGenerating ? (
                    <span className="text-sm text-slate-500 dark:text-slate-400">Generating audio...</span>
                ) : (
                    <span className="text-sm text-slate-500 dark:text-slate-400">Audio will be auto-generated.</span>
                )}
              </div>
            </div>
        </div>
        
        <div>
          <label htmlFor="definition" className="block text-sm font-medium text-slate-700 dark:text-slate-300">English Definition</label>
          <textarea id="definition" name="definition" rows={2} value={formData.definition || ''} onChange={handleChange} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
        </div>
        
        <div>
           <div className="flex justify-between items-center">
             <label htmlFor="exampleSentenceTarget" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Example Sentence (English)</label>
             <button type="button" onClick={handleExplainGrammar} disabled={isExplainingGrammar || !formData.exampleSentenceTarget} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50">
                {isExplainingGrammar ? 'Analyzing...' : 'Explain Grammar'}
              </button>
           </div>
          <textarea id="exampleSentenceTarget" name="exampleSentenceTarget" rows={2} value={formData.exampleSentenceTarget || ''} onChange={handleChange} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
        </div>

        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Notes / Mnemonics (Persian)</label>
          <textarea id="notes" name="notes" rows={3} value={formData.notes || ''} onChange={handleChange} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
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
    </>
  );
};

export default FlashcardForm;