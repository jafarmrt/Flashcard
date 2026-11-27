// File: /services/aiSpeech.ts
// Reading aloud with an AI voice: one piece of text becomes audio on the
// server (server/speech.ts), the browser plays it. Gemini (its key, or the
// server's) or a speech model on OpenRouter (the OpenRouter key).

import type { Settings } from '../types';
import { callProxy, ProxyError } from './apiService';
import { geminiAudioOptions, providerKey } from './aiSettings';
import { logUsage } from './usageLog';
import {
  cachedSpeech,
  countCachedSpeechPieces,
  normalizeSpeechText,
  saveSpeech,
  speechKey,
} from './speechCache';

export const DEFAULT_SPEECH_MODEL = 'gemini-3.8-flash-tts';
export const DEFAULT_SPEECH_VOICE = 'Kore';
// Gemini's prebuilt voices, with how Google describes them.
export const AI_VOICES: { id: string; label: string }[] = [
  { id: 'Kore', label: 'محکم' },
  { id: 'Charon', label: 'آموزشی' },
  { id: 'Iapetus', label: 'شفاف' },
  { id: 'Erinome', label: 'شفاف، آرام' },
  { id: 'Achernar', label: 'نرم' },
  { id: 'Sulafat', label: 'گرم' },
  { id: 'Puck', label: 'سرزنده' },
  { id: 'Zephyr', label: 'روشن' },
  { id: 'Aoede', label: 'سبک' },
  { id: 'Orus', label: 'محکم، بم' },
];

export const DEFAULT_OPENROUTER_SPEECH_MODEL = 'hexgrad/kokoro-82m';

export type SpeechProvider = 'gemini' | 'openrouter';
export const speechProvider = (settings: Partial<Settings>): SpeechProvider =>
  settings.aiSpeechProvider === 'openrouter' ? 'openrouter' : 'gemini';
export const speechModel = (settings: Partial<Settings>) =>
  speechProvider(settings) === 'openrouter'
    ? settings.orSpeechModel?.trim() || DEFAULT_OPENROUTER_SPEECH_MODEL
    : settings.aiSpeechModel?.trim() || DEFAULT_SPEECH_MODEL;
// OpenRouter: '' is the model's own default voice.
export const speechVoice = (settings: Partial<Settings>) =>
  speechProvider(settings) === 'openrouter'
    ? settings.orSpeechVoice?.trim() || ''
    : settings.aiSpeechVoice?.trim() || DEFAULT_SPEECH_VOICE;
export const speechServiceName = (settings: Partial<Settings>) =>
  speechProvider(settings) === 'openrouter' ? 'OpenRouter' : 'Gemini';

export interface SpeechModel {
  id: string;
  name?: string;
  price?: number; // dollars per million, as OpenRouter lists it
  free?: boolean;
  voices?: string[];
}

export const listSpeechModels = async (settings: Partial<Settings>): Promise<SpeechModel[]> =>
  (await callProxy('list-speech-models', { customApiKey: providerKey(settings, 'openrouter') }))?.models || [];

export const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const isWav = (b: Uint8Array) =>
  b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46; // "RIFF"

// Raw 16-bit mono PCM with a WAV header in front, so an <audio> can play it.
export const wavFromPcm = (pcm: Uint8Array, sampleRate = 24000): Uint8Array => {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
};

// The audio the server sent, ready to play.
export const audioBytes = (
  data: string,
  mimeType = '',
  sampleRate?: number,
): { bytes: Uint8Array; type: string } => {
  const raw = base64ToBytes(data);
  if (isWav(raw)) return { bytes: raw, type: 'audio/wav' };
  // Raw PCM, or "WAV" without its header: given one.
  if (/^audio\/(l16|pcm|x-pcm|raw|wav|x-wav|wave)/i.test(mimeType) || !mimeType) {
    return { bytes: wavFromPcm(raw, sampleRate || 24000), type: 'audio/wav' };
  }
  return { bytes: raw, type: mimeType };
};

// Deduplicates concurrent synthesis calls for the exact same piece (e.g. when
// prefetching piece N+1 overlaps with advancing to piece N+1) so the user is
// never billed twice for the same sentence.
const inFlight = new Map<string, Promise<Blob>>();

export interface AiSpeechResult {
  blob: Blob;
  fromCache: boolean;
}

export async function aiSpeechWithMeta(
  text: string,
  settings: Partial<Settings>,
  fresh = false,
): Promise<AiSpeechResult> {
  const cleanText = normalizeSpeechText(text);
  const provider = speechProvider(settings);
  const service = speechServiceName(settings);
  const model = speechModel(settings);
  const voice = speechVoice(settings);
  const key = fresh ? null : await speechKey(provider, model, voice, cleanText).catch(() => null);

  if (key) {
    const kept = await cachedSpeech(key);
    if (kept) return { blob: kept, fromCache: true };
    const running = inFlight.get(key);
    if (running) {
      const blob = await running;
      return { blob, fromCache: true };
    }
  }

  const task = (async (): Promise<Blob> => {
    try {
      const res = await callProxy('ai-speech', {
        text: cleanText,
        provider,
        model,
        voice,
        customApiKey:
          provider === 'openrouter'
            ? providerKey(settings, 'openrouter')
            : geminiAudioOptions(settings as Settings).customApiKey,
      });
      if (!res?.data) throw new ProxyError(`${service} voice: no audio came back`, 502);
      const { bytes, type } = audioBytes(res.data, res.mimeType, res.sampleRate);
      logUsage({ service, task: 'speech', ok: true, model });
      if (key) await saveSpeech(key, bytes, type);
      return new Blob([bytes as BlobPart], { type });
    } catch (error) {
      logUsage({
        service,
        task: 'speech',
        ok: false,
        model,
        status: error instanceof ProxyError ? error.status : undefined,
        error: (error as Error)?.message,
      });
      throw error;
    } finally {
      if (key) inFlight.delete(key);
    }
  })();

  if (key) inFlight.set(key, task);
  const blob = await task;
  return { blob, fromCache: false };
}

// Audio made before for the same text, service, model and voice is played
// from this device (services/speechCache); `fresh` always asks the service
// (the sample in Settings, which checks the key).
export async function aiSpeech(
  text: string,
  settings: Partial<Settings>,
  fresh = false,
): Promise<Blob> {
  const { blob } = await aiSpeechWithMeta(text, settings, fresh);
  return blob;
}

export async function countCachedSpeechForSettings(
  texts: readonly string[],
  settings: Partial<Settings>,
): Promise<number> {
  return countCachedSpeechPieces(
    speechProvider(settings),
    speechModel(settings),
    speechVoice(settings),
    texts,
  );
}

// Pre-generates and saves AI audio for a list of piece texts (one section or an
// entire chapter) sequentially, skipping pieces already stored in speechCache.
export async function prefetchSpeechTexts(
  texts: readonly string[],
  settings: Partial<Settings>,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ saved: number; total: number }> {
  const clean = texts.map(normalizeSpeechText).filter(Boolean);
  let done = 0;
  onProgress?.(0, clean.length);
  for (const piece of clean) {
    if (signal?.aborted) break;
    await aiSpeechWithMeta(piece, settings, false);
    done++;
    onProgress?.(done, clean.length);
  }
  return { saved: done, total: clean.length };
}
