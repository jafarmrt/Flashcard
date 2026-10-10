import React, { useState, useEffect, useRef } from 'react';
import { CARD_KINDS, KIND_LABEL } from '../services/cardKinds';
import { Flashcard, Deck, CefrLevel } from '../types';
import {
  AiRequestOptions,
  getPronunciationFeedback,
  blobToBase64
} from '../services/geminiService';
import { fetchAudioData } from '../services/dictionaryService';
import {
  applyProposal,
  CardProposal,
  FIELD_NAMES,
  parseCollocations,
  proposalChanges,
  refreshCard,
  refreshErrorText,
  RefreshField,
  RefreshSource,
  shownValue,
} from '../services/cardRefresh';
import { originText } from '../services/library';
import { CEFR } from '../services/wordLevel';


// Fix: Omit `createdAt` and `isDeleted` as they are not managed by the form.
type FlashcardFormData = Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId' | 'createdAt' | 'updatedAt' | 'isDeleted'>;

interface FlashcardFormProps {
  card: Flashcard | null;
  decks: Deck[];
  onSave: (card: FlashcardFormData, deckName: string) => void | Promise<void>;
  onCancel: () => void;
  initialDeckName?: string;
  showToast: (message: string) => void;
  sources: RefreshSource[]; // the AI services and dictionaries a card can be filled from
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


// Lists typed one per line in the form.
const lines = (value: string): string[] => value.split('\n').map(l => l.trim()).filter(Boolean);
const asList = (v: string[] | string | undefined): string[] => (Array.isArray(v) ? v : v ? [String(v)] : []);

const EMPTY: FlashcardFormData = {
  front: '', back: '', pronunciation: '', partOfSpeech: '', definition: [], exampleSentenceTarget: [], notes: '', audioSrc: undefined,
};

// What a source would change, field by field, next to what the card says now.
// The user ticks the fields to take; nothing changes before that.
const ProposalPanel: React.FC<{
  card: Partial<FlashcardFormData>;
  proposal: CardProposal;
  sourceName: string;
  onApply: (fields: RefreshField[]) => void;
  onDismiss: () => void;
}> = ({ card, proposal, sourceName, onApply, onDismiss }) => {
  const changes = proposalChanges(card, proposal);
  const [picked, setPicked] = useState<Set<RefreshField>>(() => new Set(changes.map(c => c.field)));
  const toggle = (field: RefreshField) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(field)) next.delete(field); else next.add(field);
    return next;
  });
  return (
    <section aria-label={`پیشنهاد ${sourceName}`} className="rounded-2xl border-2 border-brand-200 dark:border-brand-700 bg-brand-50/60 dark:bg-slate-900/60 p-4 flex flex-col gap-3">
      <p className="text-sm font-bold text-ink dark:text-white">
        پیشنهاد <bdi dir="auto">{sourceName}</bdi>
        {changes.length > 0 && <span className="font-normal text-ink-muted dark:text-slate-400"> · هر کدام را می‌خواهی تیک بزن</span>}
      </p>
      {changes.length === 0 ? (
        <p className="text-sm text-ink-muted dark:text-slate-300">این منبع چیزی متفاوت با کارت فعلی نگفت.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {changes.map(c => {
            const ltr = c.field !== 'back' && c.field !== 'notes' && c.field !== 'practicePrompt';
            return (
              <li key={c.field}>
                <label className="flex items-start gap-3 rounded-xl bg-white dark:bg-slate-800 p-3 cursor-pointer">
                  <input type="checkbox" checked={picked.has(c.field)} onChange={() => toggle(c.field)} className="mt-1 w-5 h-5 accent-brand-500 shrink-0" />
                  <span className="flex-1 min-w-0 flex flex-col gap-1">
                    <span className="text-xs font-bold text-ink-muted dark:text-slate-400">{FIELD_NAMES[c.field]}</span>
                    {c.field === 'audioSrc' ? (
                      <span className="text-sm text-ink dark:text-slate-100">{c.current ? 'صدای تازه به‌جای صدای فعلی' : 'صدای تلفظ اضافه شود'}</span>
                    ) : (
                      <>
                        <span dir={ltr ? 'ltr' : 'rtl'} className={`text-sm whitespace-pre-line break-words text-ink dark:text-white ${ltr ? 'font-en text-left' : ''}`}>{c.proposed}</span>
                        {c.current && (
                          <span dir={ltr ? 'ltr' : 'rtl'} className={`text-xs whitespace-pre-line break-words text-ink-muted dark:text-slate-400 line-through decoration-slate-400/60 ${ltr ? 'font-en text-left' : ''}`}>{c.current}</span>
                        )}
                      </>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" onClick={onDismiss} className="min-h-[44px] px-4 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-white dark:hover:bg-slate-700">
          {changes.length === 0 ? 'بستن' : 'هیچ‌کدام'}
        </button>
        {changes.length > 0 && (
          <button type="button" disabled={picked.size === 0} onClick={() => onApply(changes.map(c => c.field).filter(f => picked.has(f)))}
            className="min-h-[44px] px-5 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-40">
            گذاشتن انتخاب‌ها در کارت
          </button>
        )}
      </div>
    </section>
  );
};

const FlashcardForm: React.FC<FlashcardFormProps> = ({ card, decks, onSave, onCancel, initialDeckName, showToast, sources, audioOptions }) => {
  const [formData, setFormData] = useState<FlashcardFormData>(EMPTY);
  // Lists are edited as text, one item per line, and read back on save.
  const [definitionText, setDefinitionText] = useState('');
  const [examplesText, setExamplesText] = useState('');
  const [collocationsText, setCollocationsText] = useState('');
  const [deckName, setDeckName] = useState('Default Deck');
  const [saving, setSaving] = useState(false);

  // Another source's answer for this card
  const [sourceId, setSourceId] = useState(sources[0]?.id || '');
  const [asking, setAsking] = useState(false);
  const [proposal, setProposal] = useState<{ value: CardProposal; sourceName: string } | null>(null);
  const [askError, setAskError] = useState('');

  const [isFetchingAudio, setIsFetchingAudio] = useState(false);

  // Pronunciation feedback state
  const [isRecording, setIsRecording] = useState(false);
  const [pronunciationFeedback, setPronunciationFeedback] = useState('');
  const [isCheckingPronunciation, setIsCheckingPronunciation] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const showLists = (data: Partial<FlashcardFormData>) => {
    setDefinitionText(asList(data.definition).join('\n'));
    setExamplesText(asList(data.exampleSentenceTarget).join('\n'));
    setCollocationsText(shownValue('collocations', data.collocations || []));
  };

  useEffect(() => {
    if (card) {
      const { id: _id, deckId: _deck, repetition: _r, easinessFactor: _e, interval: _i, dueDate: _d, createdAt: _c, updatedAt: _u, isDeleted: _x,
        stability: _s, difficulty: _df, lastReviewed: _l, lapses: _lp, ...content } = card;
      const data: FlashcardFormData = {
        ...content,
        // Older cards kept one string where there is now a list.
        definition: asList(content.definition),
        exampleSentenceTarget: asList(content.exampleSentenceTarget),
      };
      setFormData(data);
      showLists(data);
      // A card whose deck is gone asks for one rather than moving to the default.
      setDeckName(initialDeckName || '');
    } else {
      setFormData(EMPTY);
      showLists(EMPTY);
      setDeckName('Default Deck');
    }
    setProposal(null);
    setAskError('');
  }, [card, initialDeckName]);

  useEffect(() => {
    if (!sources.some(s => s.id === sourceId)) setSourceId(sources[0]?.id || '');
  }, [sources, sourceId]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
      // A meaning typed by hand is the user's own.
      ...(name === 'back' && value !== prev.back ? { origin: { by: 'manual' as const, at: new Date().toISOString() } } : {}),
    }));
  };

  // The form as it stands, with the lists read from their text boxes.
  const current = (): FlashcardFormData => ({
    ...formData,
    definition: lines(definitionText),
    exampleSentenceTarget: lines(examplesText),
    collocations: parseCollocations(collocationsText),
    level: formData.level || undefined,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.front.trim() || !formData.back.trim() || !deckName.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(current(), deckName);
    } finally {
      setSaving(false);
    }
  };

  const source = sources.find(s => s.id === sourceId);
  const grammar = formData.kind === 'grammar';

  const handleAsk = async () => {
    if (!source || !formData.front.trim()) return;
    setAsking(true);
    setAskError('');
    setProposal(null);
    try {
      const value = await refreshCard(current(), source);
      setProposal({ value, sourceName: source.name });
    } catch (error) {
      console.error('Filling the card from another source failed:', error);
      setAskError(refreshErrorText(error, source));
    } finally {
      setAsking(false);
    }
  };

  const handleApply = (fields: RefreshField[]) => {
    if (!proposal) return;
    const next = applyProposal(current(), proposal.value, fields);
    setFormData(next);
    showLists(next);
    setProposal(null);
    showToast('پیشنهاد در کارت گذاشته شد. برای ماندن، کارت را ذخیره کن.');
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

  const madeBy = originText(formData.origin);

  return (
    <div dir="rtl" className="font-fa max-w-3xl mx-auto w-full bg-white dark:bg-slate-800 p-5 sm:p-8 rounded-3xl"
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-6">
        <h1 className="text-2xl font-extrabold text-ink dark:text-white">{card ? 'ویرایش کارت' : 'کارت تازه'}</h1>
        {madeBy && <span className="text-xs text-ink-muted dark:text-slate-400">پرشده با: <bdi dir="auto">{madeBy}</bdi></span>}
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div>
            <label htmlFor="front" className={label}>
                {grammar ? 'نام ساختار' : 'واژه یا عبارت انگلیسی'} <span className="text-red-500">*</span>
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

        <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-4 flex flex-col gap-3">
          <div>
            <label htmlFor="refresh-source" className={label}>{card ? 'پرکردن دوباره از منبع دیگر' : 'پرکردن خودکار'}</label>
            <p id="refresh-hint" className={hint}>
              {formData.sourceSentence?.trim() && !grammar ? 'هوش مصنوعی معنی را در جملهٔ متن پیدا می‌کند. ' : ''}
              اول جواب را کنار مقدار فعلی می‌بینی و خودت انتخاب می‌کنی.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <select id="refresh-source" aria-describedby="refresh-hint" value={sourceId} onChange={e => { setSourceId(e.target.value); setAskError(''); }}
              className={`${field} px-3 sm:flex-1`}>
              <optgroup label="هوش مصنوعی">
                {sources.filter(s => s.kind === 'ai').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
              {!grammar && (
                <optgroup label="دیکشنری">
                  {sources.filter(s => s.kind === 'dictionary').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              )}
            </select>
            <button type="button" onClick={handleAsk} disabled={asking || !formData.front.trim() || !source || (grammar && source.kind !== 'ai')}
              className="min-h-[44px] px-5 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-wait whitespace-nowrap">
              {asking ? 'در حال پرسیدن…' : 'بپرس'}
            </button>
          </div>
          {askError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{askError}</p>}
          {proposal && (
            <ProposalPanel key={proposal.sourceName + JSON.stringify(proposal.value)} card={current()} proposal={proposal.value} sourceName={proposal.sourceName}
              onApply={handleApply} onDismiss={() => setProposal(null)} />
          )}
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
              {grammar ? 'توضیح فارسی' : 'معنی فارسی'} <span className="text-red-500">*</span>
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

        {grammar && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label htmlFor="grammarPattern" className={label}>ساختار گرامری</label>
              <input type="text" id="grammarPattern" name="grammarPattern" dir="ltr" value={formData.grammarPattern || ''} onChange={handleTextChange}
                className={`${field} mt-1 px-3 font-en`} placeholder="had + past participle" />
            </div>
            <div>
              <label htmlFor="practicePrompt" className={label}>تمرین جمله‌سازی</label>
              <input type="text" id="practicePrompt" name="practicePrompt" dir="rtl" value={formData.practicePrompt || ''} onChange={handleTextChange}
                className={`${field} mt-1 px-3`} />
            </div>
          </div>
        )}

        {!grammar && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          {/* Pronunciation */}
          <div className="col-span-2 sm:col-span-1">
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
            <div>
              <label htmlFor="kind" className={label}>نوع</label>
              <select id="kind" name="kind" value={formData.kind || 'word'} onChange={handleTextChange} className={`${field} mt-1 px-3`}>
                {CARD_KINDS.filter(k => k !== 'grammar').map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="level" className={label}>سطح</label>
              <select id="level" name="level" dir="ltr" value={formData.level || ''} onChange={handleTextChange} className={`${field} mt-1 px-3 font-en`}>
                <option value="">—</option>
                {CEFR.map((l: CefrLevel) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
        </div>
        )}

        <div>
          <label htmlFor="sourceSentence" className={label}>جملهٔ متن</label>
          <p id="sentence-hint" className={hint}>جمله‌ای که این {grammar ? 'ساختار' : 'واژه'} در آن دیده شد. هوش مصنوعی معنی را در همین جمله می‌دهد.</p>
          <textarea id="sourceSentence" name="sourceSentence" dir="ltr" rows={2} aria-describedby="sentence-hint" value={formData.sourceSentence || ''} onChange={handleTextChange} className={`${field} mt-1 px-3 py-2 font-en`} />
        </div>

        <div>
          <label htmlFor="definition" className={label}>تعریف انگلیسی</label>
          <p id="definition-hint" className={hint}>هر تعریف در یک خط.</p>
          <textarea id="definition" name="definition" dir="ltr" rows={3} aria-describedby="definition-hint" value={definitionText} onChange={e => setDefinitionText(e.target.value)} className={`${field} mt-1 px-3 py-2 font-en`} />
        </div>

        <div>
           <label htmlFor="exampleSentenceTarget" className={label}>جملهٔ مثال</label>
           <p id="example-hint" className={hint}>هر مثال در یک خط.</p>
          <textarea id="exampleSentenceTarget" name="exampleSentenceTarget" dir="ltr" rows={3} aria-describedby="example-hint" value={examplesText} onChange={e => setExamplesText(e.target.value)} className={`${field} mt-1 px-3 py-2 font-en`} />
        </div>

        {!grammar && (
          <div>
            <label htmlFor="collocations" className={label}>ترکیب‌های رایج</label>
            <p id="collocations-hint" className={hint}>هر ترکیب در یک خط؛ معنی فارسی بعد از =، مثل <bdi dir="ltr" className="font-en">make a decision = تصمیم گرفتن</bdi></p>
            <textarea id="collocations" name="collocations" dir="ltr" rows={3} aria-describedby="collocations-hint" value={collocationsText} onChange={e => setCollocationsText(e.target.value)} className={`${field} mt-1 px-3 py-2 font-en`} />
          </div>
        )}

        <div>
          <label htmlFor="notes" className={label}>یادداشت و ترفند به‌خاطرسپاری</label>
          <textarea id="notes" name="notes" dir="rtl" rows={3} value={formData.notes || ''} onChange={handleTextChange} className={`${field} mt-1 px-3 py-2`} />
        </div>

        {!grammar && (
        <div>
            <span className={label}>صدای تلفظ</span>
            <div className="mt-1 flex items-center gap-3 min-h-[52px] flex-wrap">
                {formData.audioSrc ? (
                  <>
                    <button
                        type="button"
                        onClick={playAudio}
                        disabled={isFetchingAudio}
                        className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                    >
                        {isFetchingAudio ? <LoadingIcon/> : <SpeakerIcon />}
                        <span>پخش صدا</span>
                    </button>
                    <button type="button" onClick={() => setFormData(prev => ({ ...prev, audioSrc: undefined }))}
                      className="min-h-[44px] px-3 rounded-xl text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40">
                      حذف صدا
                    </button>
                  </>
                ) : (
                     <span className="text-sm text-ink-muted dark:text-slate-400 px-1">صدا با پرکردن از دیکشنری گرفته می‌شود.</span>
                )}
            </div>
        </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onCancel} className="min-h-[44px] px-5 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            لغو
          </button>
          <button type="submit" disabled={saving} className="min-h-[44px] px-6 rounded-xl text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 transition-colors disabled:opacity-50">
            {saving ? 'در حال ذخیره…' : 'ذخیرهٔ کارت'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default FlashcardForm;
