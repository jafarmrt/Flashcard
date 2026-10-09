import React, { useState, useEffect, useRef } from 'react';
import { Flashcard, Deck } from '../types';
import { 
  AiRequestOptions,
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
  aiOptions?: AiRequestOptions;
  audioOptions?: AiRequestOptions;
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


const label = 'block text-sm font-bold text-ink dark:text-slate-200';
const hint = 'text-xs text-ink-muted dark:text-slate-400 mt-0.5';
const field = 'block w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-ink dark:text-white placeholder-slate-400 focus:border-brand-500 focus:outline-none';


const FlashcardForm: React.FC<FlashcardFormProps> = ({ card, decks, onSave, onCancel, initialDeckName, showToast, defaultApiSource, aiOptions, audioOptions }) => {
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
          showToast(`جزئیات از ${defaultApiSource === 'free' ? 'دیکشنری رایگان' : 'Merriam-Webster'} آمد.`);

      } catch (error) {
          console.error("Failed to fetch details from dictionary API:", error);
          showToast(`«${formData.front}» در دیکشنری پیدا نشد.`);
      } finally {
          setIsFetchingDetails(false);
      }
  };

  const handleGenerateAiDetails = async () => {
    if (!formData.front) return;
    setIsGeneratingAI(true);
    try {
      const details = await generatePersianDetails(formData.front, aiOptions);
      setFormData(prev => ({
        ...prev,
        back: details.back,
        notes: details.notes
      }));
    } catch(error) {
       console.error("Failed to generate AI details:", error);
       showToast('هوش مصنوعی معنی را نساخت. دوباره امتحان کن.');
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
            const feedback = await getPronunciationFeedback(formData.front, base64Audio, audioBlob.type, audioOptions);
            setPronunciationFeedback(feedback);
          } catch (err) {
            setPronunciationFeedback('بازخوردی نیامد. دوباره امتحان کن.');
          } finally {
            setIsCheckingPronunciation(false);
             stream.getTracks().forEach(track => track.stop());
          }
        };

        mediaRecorderRef.current.start();
        setIsRecording(true);
      } catch (error) {
        console.error("Error accessing microphone:", error);
        alert("برای این کار باید اجازهٔ میکروفون را در تنظیمات مرورگر بدهی.");
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
        showToast("صدا پخش نشد.");
        setIsFetchingAudio(false);
    }
  };

  return (
    <div dir="rtl" className="font-fa max-w-3xl mx-auto w-full bg-white dark:bg-slate-800 p-5 sm:p-8 rounded-3xl">
      <h1 className="text-2xl font-extrabold mb-6 text-ink dark:text-white">{card ? 'ویرایش کارت' : 'کارت تازه'}</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div>
            <label htmlFor="front" className={label}>
                واژه یا عبارت انگلیسی <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1">
                <input
                    type="text"
                    id="front"
                    name="front"
                    dir="ltr"
                    value={formData.front || ''}
                    onChange={handleTextChange}
                    required
                    autoComplete="off"
                    className={`${field} font-en text-base pl-3 pr-12`}
                    placeholder="hello"
                />
                <button type="button" onClick={handleToggleRecording} disabled={!formData.front || isCheckingPronunciation}
                    className="absolute inset-y-0 right-0 w-11 flex items-center justify-center disabled:opacity-50"
                    aria-label={isRecording ? 'پایان ضبط' : 'ضبط تلفظ خودت'} title={isRecording ? 'پایان ضبط' : 'تلفظ را بگو تا هوش مصنوعی بررسی کند'}>
                    <MicIcon recording={isRecording} />
                </button>
            </div>
             {(isCheckingPronunciation || pronunciationFeedback) && (
                <div className="mt-2 text-sm p-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-ink dark:text-slate-100">
                    {isCheckingPronunciation ? 'در حال بررسی تلفظ…' : <>نظر هوش مصنوعی: <bdi dir="auto">{pronunciationFeedback}</bdi></>}
                </div>
             )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button type="button" onClick={handleFetchDetails} disabled={isFetchingDetails || !formData.front} className="w-full min-h-[48px] px-4 rounded-xl text-sm font-bold text-ink dark:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-wait">
                {isFetchingDetails ? 'در حال گرفتن…' : 'گرفتن جزئیات از دیکشنری'}
            </button>
            <button type="button" onClick={handleGenerateAiDetails} disabled={isGeneratingAI || !formData.front} className="w-full min-h-[48px] px-4 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-wait">
                {isGeneratingAI ? 'در حال ساختن…' : '✨ معنی فارسی با هوش مصنوعی'}
            </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
             {/* Deck Name */}
            <div>
                <label htmlFor="deckName" className={label}>
                    دسته <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    id="deckName"
                    name="deckName"
                    dir="auto"
                    value={deckName}
                    onChange={(e) => setDeckName(e.target.value)}
                    required
                    list="deck-options"
                    className={`${field} mt-1 px-3 font-en`}
                />
                <datalist id="deck-options">
                    {decks.map(d => <option key={d.id} value={d.name} />)}
                </datalist>
            </div>
            {/* Back of Card */}
          <div>
            <label htmlFor="back" className={label}>
              معنی فارسی <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="back"
              name="back"
              dir="rtl"
              value={formData.back || ''}
              onChange={handleTextChange}
              required
              className={`${field} mt-1 px-3`}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Pronunciation */}
          <div>
            <label htmlFor="pronunciation" className={label}>
              تلفظ <span className="font-en font-normal text-ink-muted dark:text-slate-400">(IPA)</span>
            </label>
            <input
              type="text"
              id="pronunciation"
              name="pronunciation"
              dir="ltr"
              value={formData.pronunciation || ''}
              onChange={handleTextChange}
              className={`${field} mt-1 px-3 font-en`}
            />
          </div>
            <div>
              <label htmlFor="partOfSpeech" className={label}>
                نقش دستوری
              </label>
              <input
                type="text"
                id="partOfSpeech"
                name="partOfSpeech"
                dir="ltr"
                value={formData.partOfSpeech || ''}
                onChange={handleTextChange}
                className={`${field} mt-1 px-3 font-en`}
                placeholder="noun, verb…"
              />
            </div>
        </div>

        <div>
          <label htmlFor="definition" className={label}>تعریف انگلیسی</label>
          <p id="definition-hint" className={hint}>اگر چند تعریف داری، با یک خط خالی از هم جدایشان کن.</p>
          <textarea id="definition" name="definition" dir="ltr" rows={3} aria-describedby="definition-hint" value={formData.definition?.join('\n\n') || ''} onChange={handleTextAreaChange} className={`${field} mt-1 px-3 py-2 font-en`} />
        </div>

        <div>
           <label htmlFor="exampleSentenceTarget" className={label}>جملهٔ مثال</label>
           <p id="example-hint" className={hint}>اگر چند مثال داری، با یک خط خالی از هم جدایشان کن.</p>
          <textarea id="exampleSentenceTarget" name="exampleSentenceTarget" dir="ltr" rows={3} aria-describedby="example-hint" value={formData.exampleSentenceTarget?.join('\n\n') || ''} onChange={handleTextAreaChange} className={`${field} mt-1 px-3 py-2 font-en`} />
        </div>

        <div>
          <label htmlFor="notes" className={label}>یادداشت و ترفند به‌خاطرسپاری</label>
          <textarea id="notes" name="notes" dir="rtl" rows={3} value={formData.notes || ''} onChange={handleTextChange} className={`${field} mt-1 px-3 py-2`} />
        </div>

        <div>
            <span className={label}>صدای تلفظ</span>
            <div className="mt-1 flex items-center gap-4 min-h-[52px]">
                {formData.audioSrc ? (
                    <button
                        type="button"
                        onClick={playAudio}
                        disabled={isFetchingAudio}
                        className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                    >
                        {isFetchingAudio ? <LoadingIcon/> : <SpeakerIcon />}
                        <span>پخش صدا</span>
                    </button>
                ) : (
                     <span className="text-sm text-ink-muted dark:text-slate-400 px-1">
                        {isFetchingDetails ? 'در حال گرفتن جزئیات…' : 'صدا همراه جزئیات دیکشنری گرفته می‌شود.'}
                     </span>
                )}
            </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onCancel} className="min-h-[44px] px-5 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            لغو
          </button>
          <button type="submit" className="min-h-[44px] px-6 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 transition-colors">
            ذخیرهٔ کارت
          </button>
        </div>
      </form>
    </div>
  );
};

export default FlashcardForm;
