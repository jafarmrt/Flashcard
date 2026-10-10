// File: /services/aiSpeech.ts
// Reading aloud with an AI voice: one piece of text becomes audio on the
// server (Gemini text-to-speech, server/speech.ts), the browser plays it.
// Only Gemini has voices here; its key (or the server's) is used.

import type { Settings } from '../types';
import { callProxy, ProxyError } from './apiService';
import { geminiAudioOptions } from './aiSettings';
import { logUsage } from './usageLog';

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

export const speechModel = (settings: Partial<Settings>) => settings.aiSpeechModel?.trim() || DEFAULT_SPEECH_MODEL;
export const speechVoice = (settings: Partial<Settings>) => settings.aiSpeechVoice?.trim() || DEFAULT_SPEECH_VOICE;

export const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const isWav = (b: Uint8Array) => b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46; // "RIFF"

// Raw 16-bit mono PCM with a WAV header in front, so an <audio> can play it.
export const wavFromPcm = (pcm: Uint8Array, sampleRate = 24000): Uint8Array => {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
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
export const audioBytes = (data: string, mimeType = '', sampleRate?: number): { bytes: Uint8Array; type: string } => {
  const raw = base64ToBytes(data);
  if (isWav(raw)) return { bytes: raw, type: 'audio/wav' };
  // Raw PCM, or "WAV" without its header: given one.
  if (/^audio\/(l16|pcm|x-pcm|raw|wav|x-wav|wave)/i.test(mimeType) || !mimeType) return { bytes: wavFromPcm(raw, sampleRate || 24000), type: 'audio/wav' };
  return { bytes: raw, type: mimeType };
};

export async function aiSpeech(text: string, settings: Partial<Settings>): Promise<Blob> {
  const model = speechModel(settings);
  try {
    const res = await callProxy('ai-speech', {
      text,
      model,
      voice: speechVoice(settings),
      customApiKey: geminiAudioOptions(settings as Settings).customApiKey,
    });
    if (!res?.data) throw new ProxyError('Gemini voice: no audio came back', 502);
    const { bytes, type } = audioBytes(res.data, res.mimeType, res.sampleRate);
    logUsage({ service: 'Gemini', task: 'speech', ok: true, model, chars: text.length });
    return new Blob([bytes as BlobPart], { type });
  } catch (error) {
    logUsage({ service: 'Gemini', task: 'speech', ok: false, model, status: error instanceof ProxyError ? error.status : undefined, error: (error as Error)?.message });
    throw error;
  }
}
