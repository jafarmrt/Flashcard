// File: /server/speech.ts
// Reading aloud with an AI voice: Gemini text-to-speech, or any speech model
// on OpenRouter (its /audio/speech, below). Gemini's newer TTS
// models are documented on the Interactions API; older ones answer on
// generateContent. Each is tried in turn when the first says the request is
// not one it knows (400/404). The audio comes back as base64: WAV, or raw
// 16-bit PCM that the browser wraps in a WAV header.

export const DEFAULT_SPEECH_MODEL = 'gemini-3.8-flash-tts';
export const DEFAULT_SPEECH_VOICE = 'Kore';
// About 120 words, 45 seconds of speech: 24 kHz 16-bit audio of that is
// about 2.2 MB, 2.9 MB as base64, under Vercel's 4.5 MB response limit.
// The reader sends at most 90 words a piece.
export const MAX_SPEECH_CHARS = 700;
const SPEECH_TIMEOUT_MS = 45_000;

type FetchLike = (url: string, init?: any) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  headers?: { get(name: string): string | null };
}>;

export interface SpeechAudio {
  data: string; // base64
  mimeType: string; // audio/wav, or audio/l16 / audio/pcm (raw 16-bit little-endian)
  sampleRate?: number;
}

export class SpeechError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Model and voice names are sent in a URL and a request: letters, digits,
// dots and dashes only.
export const cleanSpeechName = (value: unknown, fallback: string): string => {
  const s = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9._-]{1,64}$/.test(s) ? s : fallback;
};

const RATE = /rate=(\d+)/i;

// The first audio anywhere in an answer: { type: 'audio', data } on the
// Interactions API, { inlineData: { mimeType, data } } on generateContent.
export const findAudio = (node: unknown, depth = 0): SpeechAudio | null => {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  const o = node as Record<string, any>;
  const inline = o.inlineData || o.inline_data;
  if (inline && typeof inline.data === 'string' && inline.data) {
    const mimeType = String(inline.mimeType || inline.mime_type || 'audio/l16');
    const rate = RATE.exec(mimeType);
    return { data: inline.data, mimeType: mimeType.split(';')[0].trim(), ...(rate ? { sampleRate: Number(rate[1]) } : {}) };
  }
  if (o.type === 'audio' && typeof o.data === 'string' && o.data) {
    const mimeType = String(o.mime_type || o.mimeType || 'audio/wav');
    const rate = RATE.exec(mimeType);
    const sampleRate = Number(o.sample_rate || o.sampleRate) || (rate ? Number(rate[1]) : undefined);
    return { data: o.data, mimeType: mimeType.split(';')[0].trim(), ...(sampleRate ? { sampleRate } : {}) };
  }
  const children = Array.isArray(node) ? node : Object.values(o);
  // The last audio of a list is the answer (the Interactions API may list steps).
  const list = Array.isArray(node) ? [...children].reverse() : children;
  for (const child of list) {
    const found = findAudio(child, depth + 1);
    if (found) return found;
  }
  return null;
};

const reasonOf = (body: string): string => {
  try {
    const json = JSON.parse(body);
    return String(json?.error?.message || json?.message || body);
  } catch {
    return body;
  }
};

const failure = (status: number, body: string, service = 'Gemini voice'): SpeechError => {
  const hint = status === 401 || status === 403 ? 'the API key is wrong or not allowed'
    : status === 429 ? 'the free quota is used up for now'
    : status === 404 ? 'this voice model is not available'
    : '';
  const reason = reasonOf(body).replace(/\s+/g, ' ').trim().slice(0, 200);
  return new SpeechError(`${service} (${status}): ${[hint, reason].filter(Boolean).join(' - ') || 'request failed'}`, status);
};

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const viaInteractions = async (fetchImpl: FetchLike, apiKey: string, text: string, model: string, voice: string): Promise<SpeechAudio> => {
  const res = await fetchImpl(`${BASE}/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model,
      input: [{ type: 'user_input', content: [{ type: 'text', text }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] },
    }),
    signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
  });
  if (!res.ok) throw failure(res.status, await res.text());
  const audio = findAudio(await res.json());
  if (!audio) throw new SpeechError('Gemini voice: the answer had no audio', 502);
  return audio;
};

const viaGenerateContent = async (fetchImpl: FetchLike, apiKey: string, text: string, model: string, voice: string): Promise<SpeechAudio> => {
  const res = await fetchImpl(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
    signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
  });
  if (!res.ok) throw failure(res.status, await res.text());
  const audio = findAudio(await res.json());
  if (!audio) throw new SpeechError('Gemini voice: the answer had no audio', 502);
  return audio;
};

// A wrong request shape fails at once with 400 or 404; anything else (a
// wrong key, no quota, a timeout) fails the other way too.
const tryOther = (e: unknown) => e instanceof SpeechError && (e.status === 400 || e.status === 404);

export async function generateSpeech(apiKey: string, text: string, model: string, voice: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<SpeechAudio> {
  const legacy = /^gemini-(1|2)\./.test(model);
  const ways = legacy ? [viaGenerateContent, viaInteractions] : [viaInteractions, viaGenerateContent];
  try {
    return await ways[0](fetchImpl, apiKey, text, model, voice);
  } catch (first) {
    if (!tryOther(first)) throw first;
    try {
      return await ways[1](fetchImpl, apiKey, text, model, voice);
    } catch (second) {
      // The first answer usually says more (a model name it does not know).
      throw tryOther(second) ? first : second;
    }
  }
}

// --- OpenRouter ---

export const OPENROUTER_SPEECH_URL = 'https://openrouter.ai/api/v1/audio/speech';
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=speech';
// Cheap (well under a cent a section) and quick; any other is picked in Settings.
export const DEFAULT_OPENROUTER_SPEECH_MODEL = 'hexgrad/kokoro-82m';

// OpenRouter model and voice ids also have "/" and ":" ("fish-audio/s2.1-pro-free:free",
// "en-US-Harper:MAI-Voice-2"). They only go in a JSON body.
export const cleanOpenRouterName = (value: unknown, fallback: string): string => {
  const s = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9._:/-]{1,120}$/.test(s) ? s : fallback;
};

// MP3 first (a tenth of the size); a model that only makes PCM says 400,
// and is asked again for PCM (16-bit, 24 kHz unless it says otherwise).
// No voice: the model's own default.
export async function openRouterSpeech(apiKey: string, text: string, model: string, voice: string | undefined, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<SpeechAudio> {
  let first: SpeechError | null = null;
  for (const format of ['mp3', 'pcm'] as const) {
    const res = await fetchImpl(OPENROUTER_SPEECH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: text, ...(voice ? { voice } : {}), response_format: format }),
      signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const error = failure(res.status, await res.text(), 'OpenRouter voice');
      if (res.status === 400 && format === 'mp3') { first = error; continue; }
      throw first || error;
    }
    const type = (res.headers?.get('content-type') || (format === 'mp3' ? 'audio/mpeg' : 'audio/pcm')).toLowerCase();
    if (type.includes('json')) throw new SpeechError('OpenRouter voice: the answer had no audio', 502);
    const bytes = Buffer.from(res.arrayBuffer ? await res.arrayBuffer() : new ArrayBuffer(0));
    if (bytes.length === 0) throw new SpeechError('OpenRouter voice: the answer had no audio', 502);
    const rate = RATE.exec(type);
    return {
      data: bytes.toString('base64'),
      mimeType: format === 'pcm' && !type.startsWith('audio/') ? 'audio/pcm' : type.split(';')[0].trim(),
      ...(rate ? { sampleRate: Number(rate[1]) } : {}),
    };
  }
  throw first || new SpeechError('OpenRouter voice: request failed', 502);
}

export interface SpeechModel {
  id: string;
  name?: string;
  price?: number; // dollars per million (characters or tokens, as OpenRouter lists it)
  free?: boolean;
  voices?: string[];
}

const voiceId = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const id = o.id ?? o.voice_id ?? o.voice ?? o.name;
    return typeof id === 'string' ? id : '';
  }
  return '';
};

// OpenRouter's speech models, with their voices when it lists them.
export const speechModels = (data: any): SpeechModel[] =>
  (Array.isArray(data?.data) ? data.data : [])
    .filter((m: any) => m && typeof m.id === 'string' && m.id)
    .map((m: any) => {
      const price = Number(m.pricing?.prompt);
      const model: SpeechModel = { id: m.id };
      if (typeof m.name === 'string' && m.name && m.name !== m.id) model.name = m.name;
      if (Number.isFinite(price) && price >= 0) model.price = Math.round(price * 1_000_000 * 10_000) / 10_000;
      if (m.id.endsWith(':free') || price === 0) model.free = true;
      const voices = (Array.isArray(m.supported_voices) ? m.supported_voices : []).map(voiceId).filter(Boolean);
      if (voices.length) model.voices = [...new Set<string>(voices)].slice(0, 300);
      return model;
    });

export async function listOpenRouterSpeechModels(apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<SpeechModel[]> {
  const res = await fetchImpl(OPENROUTER_MODELS_URL, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw failure(res.status, await res.text(), 'OpenRouter');
  return speechModels(await res.json());
}
