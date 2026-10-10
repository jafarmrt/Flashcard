import React, { useState, useEffect, useRef, useMemo, useDeferredValue } from 'react';
import { extractKinds, KIND_LABEL } from '../services/cardKinds';
import { AiProviderId, Deck, Settings, ExtractedWordCard } from '../types';
import { testAiConnection } from '../services/geminiService';
import { ModelPicker } from './ModelPicker';
import { aiRequestOptions, providerKey, providerList, providerProblem, withPrimaryProvider } from '../services/aiSettings';
import { extractFromLongText, ExtractionProgress, ExtractionSource } from '../services/extractionPipeline';
import { DEFAULT_CHUNK_WORDS, splitIntoChunks, wordCount as countWords } from '../services/textChunker';
import { speakText, stopSpeech, isSpeechSupported, getAvailableVoices } from '../services/ttsService';
import { readerSection } from '../services/readerText';
import { piecesOf, type ReadAloudVoice } from '../services/readAloud';
import { useReadAloud } from '../hooks/useReadAloud';
import { fa, Icon } from './common/ui';

interface AiTextExtractorViewProps {
  decks: Deck[];
  settings: Settings;
  onUpdateSettings: (newSettings: Partial<Settings>) => void;
  onSaveExtractedCards: (cards: ExtractedWordCard[], deckName: string) => Promise<void>;
  onCancel: () => void;
  showToast: (msg: string) => void;
  existingFronts: string[];
  knownTerms?: string[]; // the "I know it" list: never suggested
}

const KIND_TONE: Record<string, string> = {
  word: 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200',
  phrase: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  collocation: 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200',
  idiom: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  expression: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200',
  slang: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/50 dark:text-fuchsia-200',
  grammar: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
};
const KIND_LABELS: Record<string, { label: string; className: string }> = Object.fromEntries(
  Object.entries(KIND_TONE).map(([kind, className]) => [kind, { label: KIND_LABEL[kind as keyof typeof KIND_LABEL], className }]),
);

const CEFR_LEVELS = [
  { id: 'A1', label: 'مبتدی' },
  { id: 'A2', label: 'پایه' },
  { id: 'B1', label: 'متوسط' },
  { id: 'B2', label: 'بالاتر از متوسط' },
  { id: 'C1', label: 'پیشرفته' },
  { id: 'C2', label: 'تسلط' },
  { id: 'IELTS', label: 'آیلتس، واژه‌های دانشگاهی' },
  { id: 'TOEFL', label: 'واژه‌های تافل' },
];

export interface ProviderPreset {
  id: string;
  name: string;
  note: string; // a few Persian words shown after the name
  provider: 'gemini' | 'openai-compatible';
  baseUrl: string;
  defaultModel: string;
  keyPlaceholder: string;
  keyHelp: string;
}

export const AI_PRESETS: ProviderPreset[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    note: 'رسمی، با کلید سرور',
    provider: 'gemini',
    baseUrl: '',
    defaultModel: 'gemini-2.5-flash',
    keyPlaceholder: 'AIzaSy…',
    keyHelp: 'اگر خالی بماند، کلید سرور به کار می‌رود.',
  },
  {
    id: 'groq',
    name: 'Groq',
    note: 'سریع، سهمیهٔ رایگان',
    provider: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    keyPlaceholder: 'gsk_…',
    keyHelp: 'کلید رایگان را از console.groq.com بگیر.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    note: 'مدل‌های متن‌باز و تجاری',
    provider: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-chat',
    keyPlaceholder: 'sk-or-v1-…',
    keyHelp: 'کلید را از openrouter.ai بگیر.',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    note: 'سرویس رسمی',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keyPlaceholder: 'sk-…',
    keyHelp: 'کلید را از platform.deepseek.com بگیر.',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    note: 'روی رایانهٔ خودت',
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.3',
    keyPlaceholder: '',
    keyHelp: 'با Ollama روی رایانهٔ خودت اجرا می‌شود؛ کلید لازم نیست.',
  },
  {
    id: 'custom',
    name: 'سرویس دیگر',
    note: 'سازگار با OpenAI',
    provider: 'openai-compatible',
    baseUrl: '',
    defaultModel: 'custom-model',
    keyPlaceholder: 'Bearer API key',
    keyHelp: 'با هر سرویس سازگار با OpenAI کار می‌کند؛ مثل vLLM، LM Studio، Together یا خود OpenAI.',
  },
];

// Shared looks, in the style of the other Persian screens.
const panel = 'bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-6';
const fieldLabel = 'block text-sm font-bold text-ink dark:text-slate-200 mb-1.5';
const smallLabel = 'text-xs font-bold text-ink-muted dark:text-slate-400';
const field = 'w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-ink dark:text-white text-sm focus:border-brand-500 focus:outline-none';
const primaryButton = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryButton = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-5 rounded-xl text-sm font-bold text-ink dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors';
const smallButton = 'min-h-[36px] px-3 rounded-xl text-sm font-bold bg-slate-100 dark:bg-slate-700 text-ink dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors';
const segment = (active: boolean) => `min-h-[36px] px-3 rounded-lg text-sm ${active ? 'bg-white dark:bg-slate-600 shadow-sm font-bold text-brand-700 dark:text-white' : 'text-ink-muted dark:text-slate-300'}`;

const PauseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>;
const StopIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>;
const Spinner = () => (
  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

export const AiTextExtractorView: React.FC<AiTextExtractorViewProps> = ({
  decks,
  settings,
  onUpdateSettings,
  onSaveExtractedCards,
  onCancel,
  showToast,
  existingFronts,
  knownTerms = [],
}) => {
  const [inputText, setInputText] = useState('');
  const [targetLevel, setTargetLevel] = useState<string>(settings.userLevel || 'B2');
  const [wordCount, setWordCount] = useState<number>(6);
  const [selectedDeckName, setSelectedDeckName] = useState<string>(decks[0]?.name || 'AI Reading Vocabulary');
  const [isCustomDeck, setIsCustomDeck] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [source, setSource] = useState<ExtractionSource>(settings.extractionSource || 'ai');
  const [includeGrammar, setIncludeGrammar] = useState(true);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [extractedCards, setExtractedCards] = useState<ExtractedWordCard[]>([]);
  const [step, setStep] = useState<'input' | 'review'>('input');

  // TTS State
  const [readingSpeed, setReadingSpeed] = useState<number>(1.0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const [playingCardAudioId, setPlayingCardAudioId] = useState<string | null>(null);

  // AI Config Drawer/Modal
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  // The service tried first, with its own key, model and address.
  const savedProviders = providerList(settings);
  const savedEntry = (id: string) => savedProviders.find(p => p.id === id);
  const firstUsable = savedProviders.find(p => p.enabled && !providerProblem(settings, p));
  const initialPreset = AI_PRESETS.find(p => p.id === (firstUsable?.id || 'gemini')) || AI_PRESETS[0];

  const [selectedPresetId, setSelectedPresetId] = useState(initialPreset.id);
  const [customKeyInput, setCustomKeyInput] = useState(providerKey(settings, initialPreset.id as AiProviderId) || '');
  const [customModelInput, setCustomModelInput] = useState(savedEntry(initialPreset.id)?.model || initialPreset.defaultModel);
  const [customBaseUrl, setCustomBaseUrl] = useState(savedEntry(initialPreset.id)?.baseUrl || initialPreset.baseUrl);
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const activePreset = AI_PRESETS.find(p => p.id === selectedPresetId) || AI_PRESETS[0];

  useEffect(() => {
    if (isSpeechSupported()) {
      const loadVoices = () => {
        const v = getAvailableVoices();
        setVoices(v);
        if (v.length > 0 && !selectedVoiceURI) {
          const defaultEn = v.find(voice => voice.lang === 'en-US') || v[0];
          setSelectedVoiceURI(defaultEn.voiceURI);
        }
      };
      loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    }
    return () => {
      stopSpeech();
    };
  }, []);

  // Reading aloud piece by piece (hooks/useReadAloud): a pause goes on from
  // where it stopped, with the device's voice or an AI voice.
  const voice: ReadAloudVoice = settings.readAloudVoice === 'ai' || !isSpeechSupported() ? 'ai' : 'device';
  const spokenText = useDeferredValue(inputText);
  const pieces = useMemo(() => {
    const section = readerSection(spokenText);
    const cut = voice === 'ai' ? piecesOf(section, 90, 35) : piecesOf(section);
    // A text without English words (Persian, numbers) is read as it is.
    const whole = spokenText.replace(/\s+/g, ' ').trim().slice(0, 600);
    return cut.length || !whole ? cut : [{ text: whole, from: 0, to: 0, paragraph: 0 }];
  }, [spokenText, voice]);
  const readAloud = useReadAloud({
    pieces, textKey: spokenText, voice, settings, rate: readingSpeed, aiRate: readingSpeed, voiceURI: selectedVoiceURI,
    onAiFailed: error => showToast(`صدای هوش مصنوعی جواب نداد؛ با صدای دستگاه ادامه می‌دهم.${error instanceof Error && error.message ? ` \u2068${error.message}\u2069` : ''}`),
  });
  const isReading = readAloud.status !== 'idle';
  const isPaused = readAloud.status === 'paused';

  const handleToggleReadAloud = () => {
    if (!inputText.trim()) {
      showToast('اول متنی بنویس یا بچسبان تا خوانده شود.');
      return;
    }
    readAloud.toggle();
  };

  const handleStopReading = () => readAloud.stop();

  const handlePlayCardSnippet = (textToPlay: string, cardKey: string) => {
    readAloud.pause();
    stopSpeech();
    setPlayingCardAudioId(cardKey);
    speakText(textToPlay, {
      rate: 0.95,
      voiceURI: selectedVoiceURI,
      onEnd: () => setPlayingCardAudioId(null),
      onError: () => setPlayingCardAudioId(null),
    });
  };

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = AI_PRESETS.find(p => p.id === presetId);
    if (preset) {
      setCustomBaseUrl(savedEntry(presetId)?.baseUrl || preset.baseUrl);
      setCustomModelInput(savedEntry(presetId)?.model || preset.defaultModel);
      // Each service has its own key: never send one to another.
      setCustomKeyInput(providerKey(settings, presetId as AiProviderId) || '');
      setTestResult(null);
    }
  };

  const handleTestKey = async () => {
    setIsTestingKey(true);
    setTestResult(null);
    try {
      const isCustomOpenAi = activePreset.provider === 'openai-compatible';
      const result = await testAiConnection({
        aiProvider: activePreset.provider,
        aiBaseUrl: isCustomOpenAi ? customBaseUrl : undefined,
        customApiKey: customKeyInput.trim() || undefined,
        model: customModelInput.trim() || activePreset.defaultModel,
      });
      setTestResult(result);
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message });
    } finally {
      setIsTestingKey(false);
    }
  };

  // The chosen service moves to the front of the list in Settings; the
  // others stay behind it as fallbacks.
  const handleSaveAiSettings = () => {
    const model = customModelInput.trim();
    const baseUrl = customBaseUrl.trim();
    onUpdateSettings({
      ...withPrimaryProvider(settings, {
        id: activePreset.id as AiProviderId,
        enabled: true,
        ...(model && model !== activePreset.defaultModel ? { model } : {}),
        ...(activePreset.provider === 'openai-compatible' && baseUrl && baseUrl !== activePreset.baseUrl ? { baseUrl } : {}),
      }, customKeyInput),
      userLevel: targetLevel as any,
    });
    showToast(`از این به بعد اول ${activePreset.name} امتحان می‌شود.`);
    setIsConfigOpen(false);
  };

  const textWordCount = useMemo(() => countWords(inputText), [inputText]);
  const sectionCount = useMemo(
    () => (inputText.trim() ? splitIntoChunks(inputText, DEFAULT_CHUNK_WORDS).length : 0),
    [inputText]
  );

  const handleSelectSource = (next: ExtractionSource) => {
    setSource(next);
    onUpdateSettings({ extractionSource: next });
  };

  const handleExtract = async () => {
    if (!inputText.trim()) {
      showToast('اول متن انگلیسی را بنویس یا بچسبان.');
      return;
    }

    handleStopReading();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setProgress({ done: 0, total: sectionCount, found: 0, fallbackSections: 0 });
    try {
      const result = await extractFromLongText({
        text: inputText.trim(),
        level: targetLevel,
        perSection: wordCount,
        source,
        existingFronts,
        knownTerms,
        includeGrammar: source === 'ai' && includeGrammar,
        kinds: extractKinds(settings),
        aiOptions: aiRequestOptions(settings),
        signal: controller.signal,
        onProgress: setProgress,
      });

      if (result.cards.length === 0) {
        showToast(result.failedSections > 0
          ? `استخراج نشد. ${result.aiError ? `خطای هوش مصنوعی: ${result.aiError}` : 'تنظیمات هوش مصنوعی یا اتصال اینترنت را بررسی کن.'}`
          : 'واژهٔ مناسبی پیدا نشد. متن بلندتری بده یا سطح را عوض کن.');
        return;
      }

      setExtractedCards(result.cards);
      setStep('review');
      const notes = [
        result.stopped ? 'زودتر متوقف شد' : '',
        result.fallbackSections ? `${fa(result.fallbackSections)} بخش با دیکشنری رایگان${result.aiError ? `، چون ${result.aiError}` : ''}` : '',
        result.failedSections ? `${fa(result.failedSections)} بخش ناموفق` : '',
      ].filter(Boolean).join('؛ ');
      showToast(`${fa(result.cards.length)} مورد در ${fa(result.sections)} بخش پیدا شد${notes ? ` (${notes})` : ''}.`);
    } catch (error) {
      console.error('Extraction error:', error);
      showToast((error as Error).message || 'استخراج واژه‌ها نشد.');
    } finally {
      abortRef.current = null;
      setIsLoading(false);
      setProgress(null);
    }
  };

  const handleStopExtraction = () => {
    abortRef.current?.abort();
  };

  const toggleSelectCard = (index: number) => {
    setExtractedCards(prev => prev.map((c, i) => i === index ? { ...c, selected: !c.selected } : c));
  };

  const handleSelectAll = (select: boolean) => {
    setExtractedCards(prev => prev.map(c => ({ ...c, selected: select })));
  };

  const updateCardField = (index: number, field: keyof ExtractedWordCard, value: any) => {
    setExtractedCards(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
  };

  const handleSaveToDeck = async () => {
    const selectedCards = extractedCards.filter(c => c.selected);
    if (selectedCards.length === 0) {
      showToast('دست‌کم یک مورد را برای ذخیره انتخاب کن.');
      return;
    }

    const deckName = selectedDeckName.trim();
    if (!deckName) {
      showToast('یک دسته انتخاب کن یا نام دستهٔ تازه را بنویس.');
      return;
    }

    setIsLoading(true);
    try {
      await onSaveExtractedCards(selectedCards, deckName);
      showToast(`${fa(selectedCards.length)} کارت به «${deckName}» اضافه شد! 🎉`);
    } catch (e) {
      showToast('کارت‌ها ذخیره نشدند.');
    } finally {
      setIsLoading(false);
    }
  };

  const selectedCount = extractedCards.filter(c => c.selected).length;
  const activeAi = aiRequestOptions(settings);
  const levelInfo = CEFR_LEVELS.find(l => l.id === targetLevel);

  return (
    <div dir="rtl" className="font-fa max-w-4xl mx-auto w-full flex flex-col gap-5">
      {/* Header Banner */}
      <header className="bg-brand-500 text-white rounded-3xl p-5 md:p-7 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-brand-100 mb-1">
            <span>هوش مصنوعی</span>
            <span aria-hidden="true">·</span>
            <bdi dir="ltr" className="font-en font-semibold text-white break-all">{activeAi.model}</bdi>
            {activeAi.aiProvider === 'openai-compatible' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-200 font-medium">متن‌باز</span>
              </>
            )}
          </p>
          <h1 className="text-2xl md:text-3xl font-extrabold">استخراج یکجا</h1>
          <p className="text-sm text-brand-100 mt-1 max-w-xl leading-relaxed">
            متن انگلیسی را بچسبان تا بلند خوانده شود؛ واژه‌ها، عبارت‌ها و ساختارهای هم‌سطح تو پیدا می‌شوند و با معنی فارسی و نکتهٔ حفظ کردن، کارت می‌شوند.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsConfigOpen(true)}
          className="shrink-0 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-white/15 hover:bg-white/25 text-white text-sm font-bold transition-colors"
        >
          <Icon.Gear size={18} />
          <span>تنظیمات هوش مصنوعی</span>
        </button>
      </header>

      {step === 'input' && (
        <section className={`${panel} flex flex-col gap-5`}>
          {/* Text and read-aloud controls */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <label htmlFor="ai-text-input" className="font-bold text-ink dark:text-white flex items-center gap-2">
                <Icon.Log size={18} className="text-brand-500 dark:text-brand-300" />
                <span>متن انگلیسی</span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                {isReading && (
                  <span role="status" className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-brand-50 dark:bg-brand-900/40 text-xs font-bold text-brand-700 dark:text-brand-200">
                    <span className={`w-2 h-2 rounded-full bg-brand-500 ${isPaused ? '' : 'animate-ping'}`}></span>
                    <span>{isPaused ? 'مکث شده' : readAloud.status === 'loading' ? 'آماده کردن صدا…' : 'در حال خواندن…'}</span>
                  </span>
                )}

                <button
                  type="button"
                  onClick={handleToggleReadAloud}
                  className={`inline-flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-xl text-sm font-bold text-white transition-colors ${
                    isReading && !isPaused ? 'bg-amber-600 hover:bg-amber-700' : 'bg-brand-500 hover:bg-brand-600'
                  }`}
                >
                  {isReading && !isPaused ? <PauseIcon /> : <Icon.Speaker size={16} />}
                  <span>{isReading && !isPaused ? 'مکث' : isPaused ? 'ادامهٔ خواندن' : 'بلند بخوان'}</span>
                </button>

                {isReading && (
                  <button
                    type="button"
                    onClick={handleStopReading}
                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-red-100 dark:hover:bg-red-900/40 text-ink-muted dark:text-slate-300 hover:text-red-700 transition-colors"
                    title="توقف خواندن"
                    aria-label="توقف خواندن"
                  >
                    <StopIcon />
                  </button>
                )}
              </div>
            </div>

            {/* Audio Options Subbar (Speed & Voice) */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-muted dark:text-slate-400 bg-slate-50 dark:bg-slate-900/40 p-2.5 rounded-2xl">
              <div role="group" aria-label="صدای خواندن" className="flex p-0.5 rounded-lg bg-white dark:bg-slate-800">
                {(['device', 'ai'] as ReadAloudVoice[]).map(v => (
                  <button key={v} type="button" aria-pressed={voice === v} onClick={() => onUpdateSettings({ readAloudVoice: v })}
                    disabled={v === 'device' && !isSpeechSupported()}
                    className={`min-h-[28px] px-2.5 rounded-md disabled:opacity-40 ${voice === v ? 'bg-brand-500 text-white font-bold' : 'text-ink dark:text-slate-300'}`}>
                    {v === 'device' ? 'صدای دستگاه' : 'صدای هوش مصنوعی'}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-ink dark:text-slate-300">سرعت صدا</span>
                <div role="group" aria-label="سرعت صدا" className="flex items-center gap-1">
                  {[0.75, 1.0, 1.25, 1.5].map(rate => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setReadingSpeed(rate)}
                      aria-pressed={readingSpeed === rate}
                      className={`min-h-[28px] px-2 rounded-md transition-colors ${
                        readingSpeed === rate
                          ? 'bg-brand-500 text-white font-bold'
                          : 'bg-white dark:bg-slate-800 text-ink dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {fa(rate)}×
                    </button>
                  ))}
                </div>
              </div>

              {voices.length > 0 && voice === 'device' && (
                <label className="flex items-center gap-2 min-w-0 max-w-full">
                  <span className="font-bold text-ink dark:text-slate-300 shrink-0">صدای گوینده</span>
                  <select
                    dir="ltr"
                    value={selectedVoiceURI}
                    onChange={e => setSelectedVoiceURI(e.target.value)}
                    className="font-en min-w-0 max-w-[200px] truncate min-h-[32px] px-1.5 text-[11px] rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-ink dark:text-slate-200"
                  >
                    {voices.map(v => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {/* English text: left to right once there is some; the Persian hint reads right to left. */}
            <textarea
              id="ai-text-input"
              rows={11}
              dir={inputText ? 'ltr' : 'rtl'}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="مقاله، فصلی از کتاب، داستان یا متن یک سخنرانی را اینجا بچسبان"
              className={`w-full p-4 rounded-2xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900/50 text-ink dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-brand-500 text-sm leading-relaxed ${inputText ? 'font-en' : ''}`}
            />

            {textWordCount > 0 && (
              <p className="text-xs text-ink-muted dark:text-slate-400">
                {fa(textWordCount)} واژه؛ در {fa(sectionCount)} بخش (هر بخش حداکثر {fa(DEFAULT_CHUNK_WORDS)} واژه) بررسی می‌شود.
              </p>
            )}
          </div>

          {/* Extraction source */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span id="source-label" className="text-sm font-bold text-ink dark:text-slate-200">منبع استخراج</span>
              <div role="group" aria-labelledby="source-label" className="flex flex-wrap gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-700">
                <button type="button" onClick={() => handleSelectSource('ai')} aria-pressed={source === 'ai'} className={segment(source === 'ai')}>
                  هوش مصنوعی
                </button>
                <button type="button" onClick={() => handleSelectSource('free')} aria-pressed={source === 'free'} className={segment(source === 'free')}>
                  دیکشنری رایگان
                </button>
              </div>
            </div>
            {source === 'ai' ? (
              <label className="inline-flex items-center gap-2 text-sm text-ink dark:text-slate-300 cursor-pointer self-start">
                <input
                  type="checkbox"
                  checked={includeGrammar}
                  onChange={e => setIncludeGrammar(e.target.checked)}
                  className="w-[18px] h-[18px] accent-brand-500"
                />
                <span>ساختارهای دستوری هم پیدا شود</span>
              </label>
            ) : (
              <p className="text-xs text-ink-muted dark:text-slate-400 leading-relaxed">
                بدون هوش مصنوعی، واژه‌های سخت از روی بسامدشان پیدا می‌شوند؛ ساختار دستوری و نکتهٔ حفظ کردن فقط با هوش مصنوعی ساخته می‌شود.
              </p>
            )}
          </div>

          {/* Target Level & Options Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Target Level */}
            <div>
              <p id="level-label" className={fieldLabel}>سطح هدف</p>
              <div role="group" aria-labelledby="level-label" className="grid grid-cols-4 gap-1.5">
                {CEFR_LEVELS.map(lvl => (
                  <button
                    key={lvl.id}
                    type="button"
                    onClick={() => setTargetLevel(lvl.id)}
                    aria-pressed={targetLevel === lvl.id}
                    title={lvl.label}
                    className={`font-en min-h-[40px] px-1 text-xs font-bold rounded-xl border transition-colors text-center ${
                      targetLevel === lvl.id
                        ? 'bg-brand-500 text-white border-brand-500'
                        : 'bg-slate-50 dark:bg-slate-700 text-ink dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600'
                    }`}
                  >
                    {lvl.id}
                  </button>
                ))}
              </div>
              {levelInfo && (
                <p className="text-xs text-ink-muted dark:text-slate-400 mt-1.5">
                  <bdi dir="ltr" className="font-en">{levelInfo.id}</bdi>، {levelInfo.label}؛ موردهای خیلی آسان برای این سطح کنار گذاشته می‌شوند.
                </p>
              )}
            </div>

            {/* Number of Words & Deck */}
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex flex-wrap justify-between items-baseline gap-x-3 gap-y-0.5 mb-1.5">
                  <label htmlFor="per-section" className="text-sm font-bold text-ink dark:text-slate-200">
                    چند مورد از هر بخش {fa(DEFAULT_CHUNK_WORDS)} واژه‌ای
                  </label>
                  <span className="text-xs font-bold text-brand-600 dark:text-brand-300">
                    {fa(wordCount)} از هر بخش{sectionCount > 1 ? ` · تا ${fa(wordCount * sectionCount)} در کل` : ''}
                  </span>
                </div>
                <input
                  id="per-section"
                  type="range"
                  min="2"
                  max="15"
                  step="1"
                  value={wordCount}
                  onChange={e => setWordCount(parseInt(e.target.value, 10))}
                  className="w-full h-2 rounded-lg cursor-pointer accent-brand-500"
                />
                <div className="flex justify-between text-[11px] text-ink-muted dark:text-slate-400 px-1 mt-1">
                  <span>{fa(2)} (سریع)</span>
                  <span>{fa(6)} (معمولی)</span>
                  <span>{fa(15)} (کامل)</span>
                </div>
              </div>

              <div>
                <label htmlFor="target-deck" className={fieldLabel}>دستهٔ مقصد</label>
                {!isCustomDeck ? (
                  <div className="flex gap-2">
                    <select
                      id="target-deck"
                      value={selectedDeckName}
                      onChange={e => setSelectedDeckName(e.target.value)}
                      className={`${field} flex-1 min-w-0`}
                    >
                      {decks.map(d => (
                        <option key={d.id} value={d.name}>{d.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomDeck(true);
                        setSelectedDeckName('');
                      }}
                      className="shrink-0 inline-flex items-center gap-1 min-h-[44px] px-3 rounded-xl text-sm font-bold text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-900/60 transition-colors"
                    >
                      <Icon.Plus size={16} />
                      <span>دستهٔ تازه</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      id="target-deck"
                      type="text"
                      dir="auto"
                      placeholder="نام دستهٔ تازه"
                      value={selectedDeckName}
                      onChange={e => setSelectedDeckName(e.target.value)}
                      className={`${field} flex-1 min-w-0 border-brand-500`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomDeck(false);
                        setSelectedDeckName(decks[0]?.name || 'Default Deck');
                      }}
                      className="shrink-0 min-h-[44px] px-3 rounded-xl text-sm font-bold text-ink-muted dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      لغو
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {progress && (
            <div role="status" className="flex flex-col gap-1.5">
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs text-ink-muted dark:text-slate-400">
                <span>بخش {fa(Math.min(progress.done + 1, progress.total))} از {fa(progress.total)} · {fa(progress.found)} مورد پیدا شد</span>
                {progress.fallbackSections > 0 && (
                  <span className="text-amber-700 dark:text-amber-300">{fa(progress.fallbackSections)} بخش با دیکشنری رایگان</span>
                )}
              </div>
              <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="pt-4 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-700">
            {isLoading && (
              <button
                type="button"
                onClick={handleStopExtraction}
                className="min-h-[44px] px-4 rounded-xl text-sm font-bold text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
              >
                توقف
              </button>
            )}
            <button type="button" onClick={onCancel} className={secondaryButton}>
              بازگشت
            </button>
            <button
              type="button"
              disabled={isLoading || !inputText.trim()}
              onClick={handleExtract}
              className={`${primaryButton} w-full sm:w-auto`}
            >
              {isLoading ? (
                <>
                  <Spinner />
                  <span>در حال استخراج…</span>
                </>
              ) : (
                <>
                  <Icon.Bolt size={16} />
                  <span>
                    استخراج با {source === 'free' ? 'دیکشنری رایگان' : 'هوش مصنوعی'} (سطح <bdi dir="ltr" className="font-en">{targetLevel}</bdi>)
                  </span>
                </>
              )}
            </button>
          </div>
        </section>
      )}

      {step === 'review' && (
        <>
          {/* Controls Bar */}
          <section className={`${panel} flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3`}>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted dark:text-slate-400 mb-0.5">
                <span>{fa(extractedCards.length)} مورد پیدا شد</span>
                <span aria-hidden="true">·</span>
                <span>سطح <bdi dir="ltr" className="font-en">{targetLevel}</bdi></span>
              </p>
              <h2 className="text-lg font-extrabold text-ink dark:text-white">
                موردهای پیدا شده را بررسی کن
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => handleSelectAll(true)} className={smallButton}>
                انتخاب همه
              </button>
              <button type="button" onClick={() => handleSelectAll(false)} className={smallButton}>
                هیچ‌کدام
              </button>
            </div>
          </section>

          {/* Cards List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {extractedCards.map((card, idx) => (
              <article
                key={idx}
                className={`min-w-0 rounded-3xl p-5 transition duration-200 ${
                  card.selected
                    ? 'bg-white dark:bg-slate-800 ring-2 ring-brand-300 dark:ring-brand-700'
                    : 'bg-slate-50 dark:bg-slate-900/50 ring-1 ring-slate-200 dark:ring-slate-700 opacity-60'
                }`}
              >
                <div className="flex items-start gap-3 mb-3">
                  <input
                    type="checkbox"
                    id={`card-check-${idx}`}
                    checked={!!card.selected}
                    onChange={() => toggleSelectCard(idx)}
                    aria-label={`انتخاب ${card.front}`}
                    className="mt-1.5 w-5 h-5 shrink-0 cursor-pointer accent-brand-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 dir="ltr" className="font-en text-xl font-bold text-ink dark:text-white tracking-tight break-words min-w-0">{card.front}</h3>
                      <button
                        type="button"
                        onClick={() => handlePlayCardSnippet(card.front, `card-${idx}`)}
                        className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-ink-muted dark:text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-slate-700 transition-colors"
                        title="شنیدن تلفظ"
                        aria-label={`شنیدن تلفظ ${card.front}`}
                      >
                        <Icon.Speaker size={16} className={playingCardAudioId === `card-${idx}` ? 'text-brand-600 dark:text-brand-300 animate-pulse' : ''} />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted dark:text-slate-400 mt-1">
                      {card.kind && KIND_LABELS[card.kind] && (
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${KIND_LABELS[card.kind].className}`}>
                          {KIND_LABELS[card.kind].label}
                        </span>
                      )}
                      {card.alreadyInDeck && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                          قبلاً کارت دارد
                        </span>
                      )}
                      {card.pronunciation && <bdi dir="ltr" className="text-brand-600 dark:text-brand-300">{card.pronunciation}</bdi>}
                      {card.partOfSpeech && (
                        <bdi dir="ltr" className="font-en">({card.partOfSpeech})</bdi>
                      )}
                    </div>
                  </div>
                </div>

                {/* Persian Translation input / display */}
                <div className="flex flex-col gap-3 pt-3 border-t border-slate-100 dark:border-slate-700/60 text-sm">
                  <label className="flex flex-col gap-1">
                    <span className={smallLabel}>معنی فارسی</span>
                    <input
                      type="text"
                      dir="rtl"
                      value={card.back}
                      onChange={e => updateCardField(idx, 'back', e.target.value)}
                      className="w-full min-h-[40px] px-3 text-sm rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-ink dark:text-white font-medium focus:border-brand-500 focus:outline-none"
                    />
                  </label>

                  {card.definition && card.definition.length > 0 && (
                    <div>
                      <p className={`${smallLabel} mb-0.5`}>تعریف</p>
                      <p dir="ltr" className="font-en text-xs text-slate-700 dark:text-slate-300 italic break-words">
                        {card.definition[0]}
                      </p>
                    </div>
                  )}

                  {card.kind === 'grammar' && (card.grammarPattern || card.practicePrompt) && (
                    <div className="flex flex-col gap-1">
                      {card.grammarPattern && (
                        <p dir="ltr" className="text-xs font-mono text-rose-700 dark:text-rose-300 break-words">{card.grammarPattern}</p>
                      )}
                      {card.practicePrompt && (
                        <p className="text-xs text-slate-700 dark:text-slate-300">✍️ {card.practicePrompt}</p>
                      )}
                    </div>
                  )}

                  {card.sourceSentence && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={smallLabel}>در متن تو</span>
                        <button
                          type="button"
                          onClick={() => handlePlayCardSnippet(card.sourceSentence!, `src-${idx}`)}
                          className="inline-flex items-center gap-1 min-h-[28px] text-xs text-brand-600 dark:text-brand-300 hover:underline"
                        >
                          <Icon.Speaker size={12} className={playingCardAudioId === `src-${idx}` ? 'animate-pulse' : ''} />
                          <span>شنیدن</span>
                        </button>
                      </div>
                      <p dir="ltr" className="font-en text-xs text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/50 p-2.5 rounded-xl leading-relaxed break-words">
                        “{card.sourceSentence}”
                      </p>
                    </div>
                  )}

                  {card.exampleSentenceTarget && card.exampleSentenceTarget.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={smallLabel}>مثال</span>
                        <button
                          type="button"
                          onClick={() => handlePlayCardSnippet(card.exampleSentenceTarget![0], `ex-${idx}`)}
                          className="inline-flex items-center gap-1 min-h-[28px] text-xs text-brand-600 dark:text-brand-300 hover:underline"
                        >
                          <Icon.Speaker size={12} className={playingCardAudioId === `ex-${idx}` ? 'animate-pulse' : ''} />
                          <span>شنیدن</span>
                        </button>
                      </div>
                      <p dir="ltr" className="font-en text-xs text-slate-700 dark:text-slate-300 italic leading-relaxed break-words">
                        “{card.exampleSentenceTarget[0]}”
                      </p>
                    </div>
                  )}

                  {card.collocations && card.collocations.length > 0 && (
                    <div>
                      <p className={`${smallLabel} mb-1`}>ترکیب‌های رایج</p>
                      <ul className="flex flex-col gap-1">
                        {card.collocations.map((c, ci) => (
                          <li key={ci} className="flex flex-wrap items-center gap-x-2 text-xs">
                            <button
                              type="button"
                              onClick={() => handlePlayCardSnippet(c.phrase, `col-${idx}-${ci}`)}
                              className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full text-ink-muted dark:text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-slate-700"
                              title="شنیدن"
                              aria-label={`شنیدن ${c.phrase}`}
                            >
                              <Icon.Speaker size={12} className={playingCardAudioId === `col-${idx}-${ci}` ? 'text-brand-600 animate-pulse' : ''} />
                            </button>
                            <bdi dir="ltr" className="font-en font-medium text-ink dark:text-slate-200">{c.phrase}</bdi>
                            {c.meaning && <span className="text-ink-muted dark:text-slate-400">{c.meaning}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {card.notes && (
                    <div>
                      <p className="text-xs font-bold text-amber-700 dark:text-amber-300 mb-1">
                        💡 نکتهٔ حفظ کردن
                      </p>
                      <p className="text-xs text-amber-900 dark:text-amber-100 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-xl leading-relaxed">
                        {card.notes}
                      </p>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>

          {/* Sticky Bottom Actions (above the phone's tab bar) */}
          <div className="sticky bottom-24 md:bottom-4 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md p-4 rounded-3xl shadow-xl ring-1 ring-slate-200 dark:ring-slate-700 flex flex-col sm:flex-row justify-between items-center gap-3">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-sm font-bold text-ink dark:text-slate-200 min-w-0 max-w-full">
              <span>{fa(selectedCount)} از {fa(extractedCards.length)} کارت انتخاب شده</span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1 min-w-0 text-xs font-normal text-ink-muted dark:text-slate-400">
                <span className="shrink-0">دسته:</span>
                <bdi dir="auto" className="font-en font-bold text-ink dark:text-slate-200 truncate">{selectedDeckName}</bdi>
              </span>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setStep('input')}
                className={`${secondaryButton} flex-1 sm:flex-none`}
              >
                <Icon.Back size={16} />
                <span>ویرایش متن</span>
              </button>
              <button
                type="button"
                disabled={isLoading || selectedCount === 0}
                onClick={handleSaveToDeck}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 min-h-[44px] px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-extrabold text-sm transition-colors"
              >
                {isLoading ? 'در حال ذخیره…' : `ذخیرهٔ ${fa(selectedCount)} کارت ✨`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* AI Settings Modal */}
      {isConfigOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div role="dialog" aria-modal="true" aria-labelledby="ai-config-title" className="bg-white dark:bg-slate-800 rounded-3xl p-5 sm:p-6 max-w-lg w-full shadow-2xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center gap-3 border-b border-slate-100 dark:border-slate-700 pb-3">
              <h2 id="ai-config-title" className="text-lg font-extrabold text-ink dark:text-white flex items-center gap-2">
                <Icon.Gear size={20} className="text-brand-500 dark:text-brand-300" />
                <span>تنظیمات هوش مصنوعی</span>
              </h2>
              <button
                type="button"
                onClick={() => setIsConfigOpen(false)}
                aria-label="بستن"
                className="w-9 h-9 flex items-center justify-center rounded-xl text-ink-muted dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <Icon.Close size={18} />
              </button>
            </div>

            <p className="text-sm text-ink-muted dark:text-slate-400 -mt-2">
              سرویسی که اینجا انتخاب کنی اول امتحان می‌شود؛ بقیهٔ سرویس‌های تنظیمات پشت سرش می‌مانند.
            </p>

            <div className="flex flex-col gap-4 text-sm">
              {/* Provider Preset Picker */}
              <div>
                <label htmlFor="ai-preset" className={fieldLabel}>سرویس</label>
                <select
                  id="ai-preset"
                  value={selectedPresetId}
                  onChange={e => handleSelectPreset(e.target.value)}
                  className={field}
                >
                  {AI_PRESETS.map(preset => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name} ({preset.note})
                    </option>
                  ))}
                </select>
              </div>

              {/* Base URL (if openai-compatible) */}
              {activePreset.provider === 'openai-compatible' && (
                <div>
                  <label htmlFor="ai-base-url" className={fieldLabel}>نشانی سرویس (سازگار با OpenAI)</label>
                  <input
                    id="ai-base-url"
                    type="text"
                    dir="ltr"
                    value={customBaseUrl}
                    onChange={e => setCustomBaseUrl(e.target.value)}
                    placeholder="https://api.groq.com/openai/v1"
                    className={`${field} font-en text-xs`}
                  />
                  <p className="text-xs text-ink-muted dark:text-slate-400 mt-1">
                    این نشانی باید <code dir="ltr" className="font-mono">/chat/completions</code> را پشتیبانی کند.
                  </p>
                </div>
              )}

              {/* Model Choice / Input */}
              <div>
                <label htmlFor="ai-model" className={fieldLabel}>مدل</label>
                <input
                  id="ai-model"
                  type="text"
                  dir="ltr"
                  placeholder={activePreset.defaultModel || 'model-name'}
                  value={customModelInput}
                  onChange={e => setCustomModelInput(e.target.value)}
                  className={`${field} font-en text-xs`}
                />
              </div>

              {/* API Key */}
              <div>
                <label htmlFor="ai-key" className={fieldLabel}>
                  کلید API{selectedPresetId === 'ollama' ? ' (اختیاری)' : ''}
                </label>
                <input
                  id="ai-key"
                  type="password"
                  dir="ltr"
                  autoComplete="off"
                  placeholder={activePreset.keyPlaceholder}
                  value={customKeyInput}
                  onChange={e => setCustomKeyInput(e.target.value)}
                  className={`${field} font-en text-xs`}
                />
                <p className="text-xs text-ink-muted dark:text-slate-400 mt-1">
                  {activePreset.keyHelp}
                </p>
              </div>

              <ModelPicker
                key={`${activePreset.id}:${customKeyInput.trim()}:${customBaseUrl}`}
                options={{
                  aiProvider: activePreset.provider,
                  aiBaseUrl: activePreset.provider === 'openai-compatible' ? customBaseUrl : undefined,
                  customApiKey: customKeyInput.trim() || undefined,
                }}
                value={customModelInput.trim() || activePreset.defaultModel}
                onPick={setCustomModelInput}
              />

              {/* Test Connection Button & Result */}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={isTestingKey}
                  onClick={handleTestKey}
                  className={`${smallButton} self-start inline-flex items-center gap-1.5 disabled:opacity-60`}
                >
                  <Icon.Bolt size={14} />
                  <span>{isTestingKey ? 'در حال آزمایش…' : 'آزمایش اتصال'}</span>
                </button>

                {testResult && (
                  <p
                    role="status"
                    className={`p-3 rounded-xl text-xs font-medium flex items-start gap-2 ${
                      testResult.ok
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                        : 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200'
                    }`}
                  >
                    <span aria-hidden="true">{testResult.ok ? '✓' : '✗'}</span>
                    <bdi dir="auto" className="min-w-0 break-words">{testResult.ok ? 'وصل شد و جواب داد.' : testResult.message}</bdi>
                  </p>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
              <button type="button" onClick={() => setIsConfigOpen(false)} className={secondaryButton}>
                لغو
              </button>
              <button
                type="button"
                onClick={handleSaveAiSettings}
                className="min-h-[44px] px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors"
              >
                ذخیره
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
