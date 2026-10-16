// File: /services/audioWav.ts
// A recording made ready for the AI that listens to it. Browsers record
// WebM/Opus (Chrome, Firefox) or MP4 (Safari); Gemini takes those, but most
// audio models on OpenRouter only take WAV or MP3. So the recording is
// turned into 16 kHz mono WAV, which every one of them takes: 30 seconds is
// under 1 MB, well inside the server's request limit.

export const WAV_RATE = 16_000;

// 16-bit PCM WAV of mono samples (-1..1).
export const encodeWav = (samples: Float32Array, sampleRate = WAV_RATE): Uint8Array => {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // size of this part
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
};

// How loud the recording is and how much of it is voice: 20 ms frames above
// the background (the quietest fifth) count as voiced.
export interface SpeechLevel { seconds: number; peak: number; voicedSeconds: number }

const FRAME_S = 0.02;

export const speechLevel = (samples: Float32Array, sampleRate = WAV_RATE): SpeechLevel => {
  const frame = Math.max(1, Math.round(sampleRate * FRAME_S));
  const rms: number[] = [];
  let peak = 0;
  for (let at = 0; at < samples.length; at += frame) {
    let sum = 0;
    const end = Math.min(samples.length, at + frame);
    for (let k = at; k < end; k++) {
      const v = Math.abs(samples[k]);
      if (v > peak) peak = v;
      sum += v * v;
    }
    rms.push(Math.sqrt(sum / (end - at)));
  }
  const floor = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.2)] || 0;
  // Mostly relative to the room's own noise, so a quiet but clear voice (a
  // phone held at arm's length) still counts.
  const voiced = rms.filter(r => r > Math.max(0.002, floor * 3)).length;
  return { seconds: samples.length / sampleRate, peak, voicedSeconds: voiced * FRAME_S };
};

// Enough voice for a listener to judge: a word takes a fifth of a second.
export const hasSpeech = (level: SpeechLevel): boolean => level.peak >= 0.005 && level.voicedSeconds >= 0.2;

// A quiet recording (a phone held far away) is made louder, up to ten times,
// so the listener hears it; a loud one is left as it is.
export const louder = (samples: Float32Array): Float32Array => {
  let peak = 0;
  for (let k = 0; k < samples.length; k++) peak = Math.max(peak, Math.abs(samples[k]));
  if (peak === 0 || peak >= 0.5) return samples;
  const gain = Math.min(0.9 / peak, 10);
  return samples.map(v => v * gain);
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const blobBase64 = async (blob: Blob): Promise<string> => toBase64(new Uint8Array(await blob.arrayBuffer()));

// The recording as base64 WAV, made louder when quiet, with how much voice
// it holds; when this browser cannot decode it, as it was recorded (Gemini
// still takes that) and without a level.
export const recordingForAi = async (blob: Blob): Promise<{ data: string; mimeType: string; level?: SpeechLevel }> => {
  try {
    const Ctx: typeof AudioContext | undefined = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx || typeof OfflineAudioContext === 'undefined') throw new Error('no Web Audio');
    const ctx = new Ctx();
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    } finally {
      ctx.close().catch(() => undefined);
    }
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * WAV_RATE)), WAV_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination); // two channels are mixed into one
    source.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    return { data: toBase64(encodeWav(louder(samples))), mimeType: 'audio/wav', level: speechLevel(samples) };
  } catch (e) {
    console.warn('The recording could not be turned into WAV; sent as recorded:', e);
    // Gemini wants the bare type: "audio/webm", not "audio/webm;codecs=opus".
    return { data: await blobBase64(blob), mimeType: blob.type.split(';')[0] || 'audio/webm' };
  }
};
