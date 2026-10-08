// File: /services/ttsService.ts
// Provides Web Speech API TTS capabilities for text reading, sentence playback, and pronunciation.

export interface SpeechOptions {
  lang?: string;
  rate?: number; // 0.5 to 2.0 (default 1.0)
  pitch?: number;
  voiceURI?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
  onBoundary?: (charIndex: number) => void;
}

let activeUtterance: SpeechSynthesisUtterance | null = null;

export const isSpeechSupported = (): boolean => {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
};

export const getAvailableVoices = (): SpeechSynthesisVoice[] => {
  if (!isSpeechSupported()) return [];
  const allVoices = window.speechSynthesis.getVoices();
  // Filter for English voices first or return all
  const englishVoices = allVoices.filter(v => v.lang.startsWith('en'));
  return englishVoices.length > 0 ? englishVoices : allVoices;
};

export const speakText = (text: string, options: SpeechOptions = {}): void => {
  if (!isSpeechSupported() || !text.trim()) return;

  stopSpeech();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = options.lang || 'en-US';
  utterance.rate = options.rate ?? 1.0;
  utterance.pitch = options.pitch ?? 1.0;

  if (options.voiceURI) {
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = voices.find(v => v.voiceURI === options.voiceURI);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
  }

  if (options.onStart) utterance.onstart = () => options.onStart?.();
  if (options.onEnd) utterance.onend = () => options.onEnd?.();
  if (options.onError) utterance.onerror = (e) => options.onError?.(e);
  if (options.onBoundary) {
    utterance.onboundary = (e) => {
      if (typeof e.charIndex === 'number') {
        options.onBoundary?.(e.charIndex);
      }
    };
  }

  activeUtterance = utterance;
  window.speechSynthesis.speak(utterance);
};

export const stopSpeech = (): void => {
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch (e) {
    console.warn('SpeechSynthesis cancel error:', e);
  }
  activeUtterance = null;
};

export const pauseSpeech = (): void => {
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.pause();
  } catch (e) {
    console.warn('SpeechSynthesis pause error:', e);
  }
};

export const resumeSpeech = (): void => {
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.resume();
  } catch (e) {
    console.warn('SpeechSynthesis resume error:', e);
  }
};
