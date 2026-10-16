// File: /server/aiRequests.ts
// The app asks every AI in Gemini's shape ({ contents, config }). These turn
// that into the request of an OpenAI-compatible service (Groq, OpenRouter,
// DeepSeek, Ollama…) or of Anthropic's Messages API (Claude), and read their
// answers back. Pure functions, so they are tested without a network.

import type { TokenUsage } from './aiModels.js';

type Part = { text?: string; inlineData?: { mimeType?: string; data?: string } };

const partsOf = (contents: unknown): Part[] => {
  if (typeof contents === 'string') return [{ text: contents }];
  if (Array.isArray(contents)) return contents.flatMap((c: any) => (c && typeof c === 'object' && Array.isArray(c.parts) ? c.parts : [c]));
  if (contents && typeof contents === 'object' && Array.isArray((contents as any).parts)) return (contents as any).parts;
  return [{ text: JSON.stringify(contents) }];
};

// The text of a request, its parts joined by lines.
export const requestText = (contents: unknown): string =>
  partsOf(contents).map(p => (typeof p?.text === 'string' ? p.text : '')).filter(Boolean).join('\n');

// Recordings sent with a request (pronunciation practice), in the format
// names OpenAI-style audio input uses.
const AUDIO_FORMATS: Record<string, string> = {
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac',
};
export const requestAudio = (contents: unknown): { data: string; format: string }[] =>
  partsOf(contents)
    .filter(p => typeof p?.inlineData?.data === 'string' && /^audio\//i.test(p.inlineData.mimeType || ''))
    .map(p => {
      const mime = (p.inlineData!.mimeType || '').toLowerCase().split(';')[0];
      return { data: p.inlineData!.data!, format: AUDIO_FORMATS[mime] || mime.replace(/^audio\//, '') };
    });

// A system instruction as text: Gemini's { parts: [{ text }] } or a string.
export const systemText = (instruction: unknown): string => {
  if (typeof instruction === 'string') return instruction;
  if (instruction && typeof instruction === 'object') return requestText(instruction);
  return '';
};

const wantsJson = (config: any) => config?.responseMimeType === 'application/json' || !!config?.responseSchema;

// Said in words where the service has no JSON mode of its own.
const jsonInstruction = (config: any): string =>
  wantsJson(config)
    ? `Reply with one JSON object only: no text before or after it and no code fences.${config?.responseSchema ? ` Its shape (Gemini schema notation): ${JSON.stringify(config.responseSchema)}` : ''}`
    : '';

export const openAiRequestBody = (payload: any, host: string): Record<string, any> => {
  const { model, contents, config } = payload || {};
  const audio = requestAudio(contents);
  // A model that hears audio does not always take a JSON mode as well; the
  // instruction is then given in words.
  const system = [systemText(config?.systemInstruction), audio.length ? jsonInstruction(config) : ''].filter(Boolean).join('\n\n');
  const text = requestText(contents);
  const userContent = audio.length
    ? [{ type: 'text', text }, ...audio.map(a => ({ type: 'input_audio', input_audio: { data: a.data, format: a.format } }))]
    : text;
  const body: Record<string, any> = {
    model: model || 'llama-3.3-70b-versatile',
    messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: userContent }],
    temperature: 0.3,
  };
  if (wantsJson(config) && !audio.length) body.response_format = { type: 'json_object' };
  // OpenRouter says what each answer cost when asked.
  if (/(^|\.)openrouter\.ai$/.test(host)) body.usage = { include: true };
  return body;
};

// --- Anthropic (Claude) ---

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1';
export const ANTHROPIC_VERSION = '2023-06-01';
const MAX_OUTPUT_TOKENS = 8192;

export const anthropicHeaders = (apiKey: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': ANTHROPIC_VERSION,
});

export class AiRequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const anthropicRequestBody = (payload: any): Record<string, any> => {
  const { model, contents, config } = payload || {};
  if (requestAudio(contents).length) throw new AiRequestError('Claude cannot listen to audio; pronunciation practice uses Gemini or an OpenRouter audio model.');
  const system = [systemText(config?.systemInstruction), jsonInstruction(config)].filter(Boolean).join('\n\n');
  const maxTokens = Number(config?.maxOutputTokens);
  const temperature = Number(config?.temperature);
  return {
    model: model || 'claude-haiku-4-5',
    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.min(maxTokens, 32_000) : MAX_OUTPUT_TOKENS,
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: requestText(contents) || ' ' }],
    temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(1, temperature)) : 0.3,
  };
};

// Claude's answer in the shape every handler returns.
export const anthropicReply = (data: any, asked: string): { text: string; model: string; usage?: TokenUsage } => {
  const text = (Array.isArray(data?.content) ? data.content : [])
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('');
  const input = Number(data?.usage?.input_tokens) || 0;
  const output = Number(data?.usage?.output_tokens) || 0;
  return { text, model: typeof data?.model === 'string' ? data.model : asked, ...(input || output ? { usage: { input, output } } : {}) };
};
