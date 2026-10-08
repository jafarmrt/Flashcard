import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Deck, Settings, ExtractedWordCard } from '../types';
import { testAiConnection } from '../services/geminiService';
import { extractFromLongText, ExtractionProgress, ExtractionSource } from '../services/extractionPipeline';
import { DEFAULT_CHUNK_WORDS, splitIntoChunks, wordCount as countWords } from '../services/textChunker';
import { speakText, stopSpeech, pauseSpeech, resumeSpeech, isSpeechSupported, getAvailableVoices } from '../services/ttsService';

interface AiTextExtractorViewProps {
  decks: Deck[];
  settings: Settings;
  onUpdateSettings: (newSettings: Partial<Settings>) => void;
  onSaveExtractedCards: (cards: ExtractedWordCard[], deckName: string) => Promise<void>;
  onCancel: () => void;
  showToast: (msg: string) => void;
  existingFronts: string[];
}

const KIND_LABELS: Record<string, { label: string; className: string }> = {
  word: { label: 'واژه', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' },
  phrase: { label: 'عبارت', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' },
  idiom: { label: 'اصطلاح', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
  grammar: { label: 'ساختار دستوری', className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' },
};

const CEFR_LEVELS = [
  { id: 'A1', label: 'A1 - Beginner' },
  { id: 'A2', label: 'A2 - Elementary' },
  { id: 'B1', label: 'B1 - Intermediate' },
  { id: 'B2', label: 'B2 - Upper Intermediate' },
  { id: 'C1', label: 'C1 - Advanced' },
  { id: 'C2', label: 'C2 - Proficient' },
  { id: 'IELTS', label: 'IELTS / Academic' },
  { id: 'TOEFL', label: 'TOEFL Vocabulary' },
];

export interface ProviderPreset {
  id: string;
  name: string;
  provider: 'gemini' | 'openai-compatible';
  baseUrl: string;
  defaultModel: string;
  models: string[];
  keyPlaceholder: string;
  keyHelp: string;
}

export const AI_PRESETS: ProviderPreset[] = [
  {
    id: 'gemini',
    name: 'Google Gemini (Official / Built-in)',
    provider: 'gemini',
    baseUrl: '',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    keyPlaceholder: 'AIzaSy... (Leave empty to use built-in server key)',
    keyHelp: 'Built-in server key is used if empty.',
  },
  {
    id: 'groq',
    name: 'Groq (Ultra-Fast Open Source - Llama 3 / Mixtral)',
    provider: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    keyPlaceholder: 'gsk_...',
    keyHelp: 'Get a free API key from console.groq.com',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (All Open-Source & Proprietary Models)',
    provider: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-chat',
    models: [
      'deepseek/deepseek-chat',
      'deepseek/deepseek-r1',
      'meta-llama/llama-3.3-70b-instruct',
      'qwen/qwen-2.5-72b-instruct',
      'mistralai/mistral-large-2411',
    ],
    keyPlaceholder: 'sk-or-v1-...',
    keyHelp: 'Get your key from openrouter.ai',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek (Official API)',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyPlaceholder: 'sk-...',
    keyHelp: 'Get your key from platform.deepseek.com',
  },
  {
    id: 'ollama',
    name: 'Ollama / Local AI (Self-Hosted Open-Source)',
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.3',
    models: ['llama3.3', 'llama3.1', 'mistral', 'qwen2.5:7b', 'deepseek-r1:8b'],
    keyPlaceholder: 'Not required for local Ollama',
    keyHelp: 'Runs locally on your machine with Ollama.',
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-Compatible / Self-Hosted',
    provider: 'openai-compatible',
    baseUrl: '',
    defaultModel: 'custom-model',
    models: [],
    keyPlaceholder: 'Bearer API Key',
    keyHelp: 'Compatible with any vLLM, LMStudio, Together, or OpenAI endpoint.',
  },
];

export const AiTextExtractorView: React.FC<AiTextExtractorViewProps> = ({
  decks,
  settings,
  onUpdateSettings,
  onSaveExtractedCards,
  onCancel,
  showToast,
  existingFronts,
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
  const [isReading, setIsReading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [readingSpeed, setReadingSpeed] = useState<number>(1.0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const [playingCardAudioId, setPlayingCardAudioId] = useState<string | null>(null);

  // AI Config Drawer/Modal
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  
  // Find current preset
  const initialPreset = AI_PRESETS.find(p => {
    if (settings.aiProvider === 'openai-compatible') {
      if (settings.aiBaseUrl?.includes('groq')) return p.id === 'groq';
      if (settings.aiBaseUrl?.includes('openrouter')) return p.id === 'openrouter';
      if (settings.aiBaseUrl?.includes('deepseek')) return p.id === 'deepseek';
      if (settings.aiBaseUrl?.includes('localhost') || settings.aiBaseUrl?.includes('11434')) return p.id === 'ollama';
      return p.id === 'custom';
    }
    return p.id === 'gemini';
  }) || AI_PRESETS[0];

  const [selectedPresetId, setSelectedPresetId] = useState(initialPreset.id);
  const [customKeyInput, setCustomKeyInput] = useState(settings.customApiKey || '');
  const [customModelInput, setCustomModelInput] = useState(settings.aiModel || initialPreset.defaultModel);
  const [customBaseUrl, setCustomBaseUrl] = useState(settings.aiBaseUrl || initialPreset.baseUrl);
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

  const handleToggleReadAloud = () => {
    if (!inputText.trim()) {
      showToast('Please enter some text to read aloud.');
      return;
    }

    if (isReading) {
      if (isPaused) {
        resumeSpeech();
        setIsPaused(false);
      } else {
        pauseSpeech();
        setIsPaused(true);
      }
    } else {
      setIsReading(true);
      setIsPaused(false);
      speakText(inputText, {
        rate: readingSpeed,
        voiceURI: selectedVoiceURI,
        onEnd: () => {
          setIsReading(false);
          setIsPaused(false);
        },
        onError: () => {
          setIsReading(false);
          setIsPaused(false);
          showToast('Audio playback stopped.');
        },
      });
    }
  };

  const handleStopReading = () => {
    stopSpeech();
    setIsReading(false);
    setIsPaused(false);
  };

  const handlePlayCardSnippet = (textToPlay: string, cardKey: string) => {
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
      setCustomBaseUrl(preset.baseUrl);
      setCustomModelInput(preset.defaultModel);
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

  const handleSaveAiSettings = () => {
    const isCustomOpenAi = activePreset.provider === 'openai-compatible';
    onUpdateSettings({
      aiProvider: activePreset.provider,
      aiBaseUrl: isCustomOpenAi ? (customBaseUrl.trim() || undefined) : undefined,
      customApiKey: customKeyInput.trim() || undefined,
      aiModel: customModelInput.trim() || activePreset.defaultModel,
      userLevel: targetLevel as any,
    });
    showToast(`AI Provider updated to ${activePreset.name}!`);
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
      showToast('Please enter or paste some text first.');
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
        includeGrammar: source === 'ai' && includeGrammar,
        aiOptions: {
          aiProvider: settings.aiProvider || 'gemini',
          aiBaseUrl: settings.aiBaseUrl || undefined,
          customApiKey: settings.customApiKey || undefined,
          model: settings.aiModel || 'gemini-2.5-flash',
        },
        signal: controller.signal,
        onProgress: setProgress,
      });

      if (result.cards.length === 0) {
        showToast(result.failedSections > 0
          ? 'Extraction failed. Check the AI settings or your connection.'
          : 'No suitable vocabulary could be extracted. Try a longer text or adjust level.');
        return;
      }

      setExtractedCards(result.cards);
      setStep('review');
      const notes = [
        result.stopped ? 'stopped early' : '',
        result.fallbackSections ? `${result.fallbackSections} section(s) used free dictionaries` : '',
        result.failedSections ? `${result.failedSections} section(s) failed` : '',
      ].filter(Boolean).join(', ');
      showToast(`Found ${result.cards.length} items in ${result.sections} section(s)${notes ? ` (${notes})` : ''}.`);
    } catch (error) {
      console.error('Extraction error:', error);
      showToast((error as Error).message || 'Failed to extract vocabulary.');
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
      showToast('Please select at least one word to save.');
      return;
    }

    const deckName = selectedDeckName.trim();
    if (!deckName) {
      showToast('Please choose or enter a deck name.');
      return;
    }

    setIsLoading(true);
    try {
      await onSaveExtractedCards(selectedCards, deckName);
      showToast(`Added ${selectedCards.length} cards to "${deckName}"! 🎉`);
    } catch (e) {
      showToast('Failed to save flashcards.');
    } finally {
      setIsLoading(false);
    }
  };

  const selectedCount = extractedCards.filter(c => c.selected).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-indigo-700 via-indigo-600 to-purple-700 rounded-2xl p-6 text-white shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-indigo-200 mb-1">
            <span>AI Linguistic Engine</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-white font-semibold">{settings.aiModel || 'gemini-2.5-flash'}</span>
            {settings.aiProvider === 'openai-compatible' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-300 font-medium">Open-Source</span>
              </>
            )}
          </div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">AI Reader & Vocabulary Extractor</h2>
          <p className="text-sm text-indigo-100 mt-1 max-w-xl leading-relaxed">
            Paste any English text to read aloud with natural speech, extract level-appropriate vocabulary, and save flashcards with Persian translations and mnemonics.
          </p>
        </div>
        <button
          onClick={() => setIsConfigOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-semibold transition backdrop-blur-sm shrink-0 shadow-sm hover:scale-[1.02] active:scale-95"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          <span>AI Model Settings</span>
        </button>
      </div>

      {step === 'input' && (
        <div className="space-y-6">
          {/* Main Input Box */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-4">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <label htmlFor="ai-text-input" className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2 text-base">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600 dark:text-indigo-400"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                <span>Enter English Text</span>
              </label>

              {/* TTS Read Aloud Control Bar */}
              <div className="flex items-center gap-2">
                {isReading && (
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs font-semibold text-indigo-700 dark:text-indigo-300 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping"></span>
                    <span>{isPaused ? 'Paused' : 'Reading Aloud...'}</span>
                  </div>
                )}
                
                <button
                  type="button"
                  onClick={handleToggleReadAloud}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm ${
                    isReading && !isPaused
                      ? 'bg-amber-500 hover:bg-amber-600 text-white'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                  }`}
                  title="Read the text aloud using Speech Synthesis"
                >
                  {isReading && !isPaused ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                      <span>Pause Audio</span>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
                      <span>{isPaused ? 'Resume Audio' : '🔊 Read Aloud (روخوانی صوتی)'}</span>
                    </>
                  )}
                </button>

                {isReading && (
                  <button
                    type="button"
                    onClick={handleStopReading}
                    className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-red-100 dark:hover:bg-red-900/40 text-slate-600 hover:text-red-600 transition"
                    title="Stop Audio"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                  </button>
                )}
              </div>
            </div>

            {/* Audio Options Subbar (Speed & Voice) */}
            <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 gap-3">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Voice Speed:</span>
                <div className="flex items-center gap-1">
                  {[0.75, 1.0, 1.25, 1.5].map(rate => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setReadingSpeed(rate)}
                      className={`px-2 py-0.5 rounded-md font-mono text-[11px] transition ${
                        readingSpeed === rate
                          ? 'bg-indigo-600 text-white font-bold'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>

              {voices.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Voice Accent:</span>
                  <select
                    value={selectedVoiceURI}
                    onChange={e => setSelectedVoiceURI(e.target.value)}
                    className="max-w-[200px] truncate p-1 text-[11px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                  >
                    {voices.map(v => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <textarea
              id="ai-text-input"
              rows={11}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="Paste English article, speech transcript, book excerpt, story, or paragraph here..."
              className="w-full p-4 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm leading-relaxed"
            />

            {textWordCount > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400" dir="rtl">
                {textWordCount} کلمه؛ در {sectionCount} بخش حداکثر {DEFAULT_CHUNK_WORDS} کلمه‌ای بررسی می‌شود.
              </p>
            )}

            {/* Extraction source */}
            <div className="flex flex-wrap items-center gap-3 text-xs" dir="rtl">
              <span className="font-bold text-slate-600 dark:text-slate-300">منبع استخراج:</span>
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-700 rounded-lg">
                <button
                  type="button"
                  onClick={() => handleSelectSource('ai')}
                  className={`px-3 py-1 rounded-md font-semibold ${source === 'ai' ? 'bg-white dark:bg-slate-600 shadow text-indigo-700 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-300'}`}
                >
                  هوش مصنوعی
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectSource('free')}
                  className={`px-3 py-1 rounded-md font-semibold ${source === 'free' ? 'bg-white dark:bg-slate-600 shadow text-indigo-700 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-300'}`}
                >
                  دیکشنری‌های رایگان (بدون هوش مصنوعی)
                </button>
              </div>
              {source === 'ai' ? (
                <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeGrammar}
                    onChange={e => setIncludeGrammar(e.target.checked)}
                    className="accent-indigo-600"
                  />
                  <span>ساختارهای دستوری هم پیدا شود</span>
                </label>
              ) : (
                <span className="text-slate-500 dark:text-slate-400">
                  واژه‌های سخت با بسامد کلمه پیدا می‌شوند؛ ساختار دستوری و نکته حفظ کردن فقط با هوش مصنوعی.
                </span>
              )}
            </div>

            {/* Target Level & Options Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
              {/* Target Level */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Target Proficiency Level
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {CEFR_LEVELS.map(lvl => (
                    <button
                      key={lvl.id}
                      type="button"
                      onClick={() => setTargetLevel(lvl.id)}
                      className={`px-2.5 py-2 text-xs font-semibold rounded-xl border transition text-center ${
                        targetLevel === lvl.id
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600'
                      }`}
                    >
                      {lvl.id}
                    </button>
                  ))}
                </div>
              </div>

              {/* Number of Words & Deck */}
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Items per {DEFAULT_CHUNK_WORDS}-word section
                    </label>
                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                      {wordCount} per section{sectionCount > 1 ? ` · up to ${wordCount * sectionCount} total` : ''}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="15"
                    step="1"
                    value={wordCount}
                    onChange={e => setWordCount(parseInt(e.target.value, 10))}
                    className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 px-1 mt-1 font-mono">
                    <span>2 (Quick)</span>
                    <span>6 (Standard)</span>
                    <span>15 (Deep)</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Target Deck
                  </label>
                  {!isCustomDeck ? (
                    <div className="flex gap-2">
                      <select
                        value={selectedDeckName}
                        onChange={e => setSelectedDeckName(e.target.value)}
                        className="flex-grow p-2 text-sm rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100"
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
                        className="px-3 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl hover:bg-indigo-100 transition"
                      >
                        + New Deck
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter new deck name..."
                        value={selectedDeckName}
                        onChange={e => setSelectedDeckName(e.target.value)}
                        className="flex-grow p-2 text-sm rounded-xl border border-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomDeck(false);
                          setSelectedDeckName(decks[0]?.name || 'Default Deck');
                        }}
                        className="px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {progress && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Section {Math.min(progress.done + 1, progress.total)} of {progress.total} · {progress.found} items found</span>
                  {progress.fallbackSections > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">{progress.fallbackSections} section(s) via free dictionaries</span>
                  )}
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                  <div
                    className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-700">
              {isLoading && (
                <button
                  type="button"
                  onClick={handleStopExtraction}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                onClick={onCancel}
                className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                Back to Decks
              </button>
              <button
                type="button"
                disabled={isLoading || !inputText.trim()}
                onClick={handleExtract}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold text-sm shadow-md transition transform active:scale-95 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Extracting Vocabulary...</span>
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                    <span>Extract {source === 'free' ? 'with Free Dictionaries' : 'with AI'} (Level {targetLevel})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-6">
          {/* Controls Bar */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-0.5">
                <span>Extracted Cards</span>
                <span aria-hidden="true">·</span>
                <span>{extractedCards.length} Words Found</span>
                <span aria-hidden="true">·</span>
                <span>Target: {targetLevel}</span>
              </div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">
                Review Extracted Vocabulary
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSelectAll(true)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 transition"
              >
                Select All
              </button>
              <button
                onClick={() => handleSelectAll(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 transition"
              >
                Deselect All
              </button>
            </div>
          </div>

          {/* Cards List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {extractedCards.map((card, idx) => (
              <div
                key={idx}
                className={`rounded-2xl p-5 border transition duration-200 shadow-sm relative ${
                  card.selected
                    ? 'bg-white dark:bg-slate-800 border-indigo-400 dark:border-indigo-600 ring-2 ring-indigo-500/20'
                    : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id={`card-check-${idx}`}
                      checked={!!card.selected}
                      onChange={() => toggleSelectCard(idx)}
                      className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">{card.front}</h4>
                        <button
                          type="button"
                          onClick={() => handlePlayCardSnippet(card.front, `card-${idx}`)}
                          className="p-1 rounded-full text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition"
                          title="Listen to pronunciation"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={playingCardAudioId === `card-${idx}` ? 'text-indigo-600 animate-pulse' : ''}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {card.kind && KIND_LABELS[card.kind] && (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${KIND_LABELS[card.kind].className}`}>
                            {KIND_LABELS[card.kind].label}
                          </span>
                        )}
                        {card.alreadyInDeck && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            قبلاً کارت دارد
                          </span>
                        )}
                        {card.pronunciation && <span className="font-mono text-indigo-600 dark:text-indigo-400">{card.pronunciation}</span>}
                        {card.partOfSpeech && (
                          <span className="text-slate-400 dark:text-slate-500">
                            ({card.partOfSpeech})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Persian Translation input / display */}
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-700/60 text-sm">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
                      ترجمه فارسی (Persian Translation)
                    </label>
                    <input
                      type="text"
                      dir="rtl"
                      value={card.back}
                      onChange={e => updateCardField(idx, 'back', e.target.value)}
                      className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-medium font-persian"
                    />
                  </div>

                  {card.definition && card.definition.length > 0 && (
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-0.5">
                        Definition:
                      </span>
                      <p className="text-xs text-slate-700 dark:text-slate-300 italic">
                        {card.definition[0]}
                      </p>
                    </div>
                  )}

                  {card.kind === 'grammar' && (card.grammarPattern || card.practicePrompt) && (
                    <div className="space-y-1">
                      {card.grammarPattern && (
                        <p className="text-xs font-mono text-rose-700 dark:text-rose-300">{card.grammarPattern}</p>
                      )}
                      {card.practicePrompt && (
                        <p dir="rtl" className="text-xs text-slate-600 dark:text-slate-300">✍️ {card.practicePrompt}</p>
                      )}
                    </div>
                  )}

                  {card.sourceSentence && (
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          From your text:
                        </span>
                        <button
                          type="button"
                          onClick={() => handlePlayCardSnippet(card.sourceSentence!, `src-${idx}`)}
                          className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg>
                          <span>Listen</span>
                        </button>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/50 p-2.5 rounded-xl font-sans leading-relaxed">
                        "{card.sourceSentence}"
                      </p>
                    </div>
                  )}

                  {card.exampleSentenceTarget && card.exampleSentenceTarget.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          Example:
                        </span>
                        <button
                          type="button"
                          onClick={() => handlePlayCardSnippet(card.exampleSentenceTarget![0], `ex-${idx}`)}
                          className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg>
                          <span>Listen</span>
                        </button>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 italic leading-relaxed">
                        "{card.exampleSentenceTarget[0]}"
                      </p>
                    </div>
                  )}

                  {card.collocations && card.collocations.length > 0 && (
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
                        Common expressions:
                      </span>
                      <ul className="space-y-1">
                        {card.collocations.map((c, ci) => (
                          <li key={ci} className="flex items-center gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => handlePlayCardSnippet(c.phrase, `col-${idx}-${ci}`)}
                              className="text-slate-400 hover:text-indigo-600"
                              title="Listen"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={playingCardAudioId === `col-${idx}-${ci}` ? 'text-indigo-600 animate-pulse' : ''}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg>
                            </button>
                            <span className="font-medium text-slate-800 dark:text-slate-200">{c.phrase}</span>
                            {c.meaning && <span dir="rtl" className="text-slate-500 dark:text-slate-400 font-persian">{c.meaning}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {card.notes && (
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 block mb-0.5">
                        💡 نکته و راهنمای حفظ (Mnemonic):
                      </span>
                      <p dir="rtl" className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-xl border border-amber-200/80 dark:border-amber-900/40 font-persian leading-relaxed">
                        {card.notes}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Sticky Bottom Actions */}
          <div className="sticky bottom-4 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <span>{selectedCount} of {extractedCards.length} cards selected</span>
              <span aria-hidden="true">·</span>
              <span className="text-xs text-slate-400">Destination: <strong className="text-slate-700 dark:text-slate-200">{selectedDeckName}</strong></span>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setStep('input')}
                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                ← Edit Text
              </button>
              <button
                type="button"
                disabled={isLoading || selectedCount === 0}
                onClick={handleSaveToDeck}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white font-bold text-sm shadow-md transition active:scale-95"
              >
                {isLoading ? 'Saving...' : `Save ${selectedCount} Cards to Deck ✨`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Settings Modal */}
      {isConfigOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 dark:border-slate-700 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-3">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path><path d="M12 12L2.1 12.5"></path><path d="M12 12l4.5 8"></path></svg>
                <span>AI Provider & Model Settings</span>
              </h3>
              <button
                onClick={() => setIsConfigOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-sm">
              {/* Provider Preset Picker */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  AI Provider / Service
                </label>
                <select
                  value={selectedPresetId}
                  onChange={e => handleSelectPreset(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm font-medium"
                >
                  {AI_PRESETS.map(preset => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Base URL (if openai-compatible) */}
              {activePreset.provider === 'openai-compatible' && (
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    API Base URL (OpenAI-Compatible)
                  </label>
                  <input
                    type="text"
                    value={customBaseUrl}
                    onChange={e => setCustomBaseUrl(e.target.value)}
                    placeholder="https://api.groq.com/openai/v1"
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-mono text-xs"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Endpoint should support <code className="font-mono">/chat/completions</code>.
                  </p>
                </div>
              )}

              {/* Model Choice / Input */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Model Identifier / Name
                </label>
                {activePreset.models.length > 0 ? (
                  <div className="space-y-2">
                    <select
                      value={customModelInput}
                      onChange={e => setCustomModelInput(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm font-medium"
                    >
                      {activePreset.models.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Or type a custom model name..."
                      value={customModelInput}
                      onChange={e => setCustomModelInput(e.target.value)}
                      className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono"
                    />
                  </div>
                ) : (
                  <input
                    type="text"
                    placeholder="e.g. llama-3.3-70b-versatile, deepseek-chat"
                    value={customModelInput}
                    onChange={e => setCustomModelInput(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-mono text-xs"
                  />
                )}
              </div>

              {/* API Key */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  API Key {selectedPresetId === 'ollama' ? '(Optional)' : ''}
                </label>
                <input
                  type="password"
                  placeholder={activePreset.keyPlaceholder}
                  value={customKeyInput}
                  onChange={e => setCustomKeyInput(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-mono text-xs"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {activePreset.keyHelp}
                </p>
              </div>

              {/* Test Connection Button & Result */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={isTestingKey}
                  onClick={handleTestKey}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium text-xs transition flex items-center gap-2"
                >
                  {isTestingKey ? 'Testing Connection...' : '⚡ Test Connection'}
                </button>

                {testResult && (
                  <div
                    className={`mt-2 p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
                      testResult.ok
                        ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                        : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                    }`}
                  >
                    <span>{testResult.ok ? '✓' : '✗'}</span>
                    <span>{testResult.message}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setIsConfigOpen(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAiSettings}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-md transition"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
