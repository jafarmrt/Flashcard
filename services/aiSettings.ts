// File: /services/aiSettings.ts
// One place that turns the saved settings into the options every AI call
// sends, so a Groq model name never reaches Gemini and the other way round.

import type { CardOrigin, Settings } from '../types';
import type { AiRequestOptions } from './geminiService';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'llama-3.3-70b-versatile';

export const defaultModelFor = (provider?: Settings['aiProvider']) =>
  provider === 'openai-compatible' ? DEFAULT_OPENAI_COMPATIBLE_MODEL : DEFAULT_GEMINI_MODEL;

// Models the providers have retired; a saved one is replaced by the default.
const RETIRED_MODELS = /^(gemini-1\.0|gemini-1\.5|gemini-pro$|mixtral-8x7b|gemma2-|gemma-7b|llama3-|llama-3\.1-70b|llama-3\.2-)/;

export const usableModel = (settings: Pick<Settings, 'aiProvider' | 'aiModel' | 'aiBaseUrl'>): string => {
  const model = settings.aiModel?.trim();
  if (!model || RETIRED_MODELS.test(model)) return defaultModelFor(settings.aiProvider);
  // A model left over from the other provider (a Gemini name sent to Groq, a
  // Llama name sent to Gemini) only fails, so use the provider's default.
  const looksGemini = /^(gemini|gemma)-/.test(model);
  const googleHost = (settings.aiBaseUrl || '').includes('googleapis.com');
  const mismatch = settings.aiProvider === 'openai-compatible' ? looksGemini && !googleHost : !looksGemini;
  return mismatch ? defaultModelFor(settings.aiProvider) : model;
};

export const aiRequestOptions = (settings: Settings): AiRequestOptions => ({
  aiProvider: settings.aiProvider || 'gemini',
  aiBaseUrl: settings.aiProvider === 'openai-compatible' ? settings.aiBaseUrl || undefined : undefined,
  customApiKey: settings.customApiKey || undefined,
  model: usableModel(settings),
});

// Audio (pronunciation checks) only works with Gemini. A key typed for
// another provider is never sent to Google.
export const geminiAudioOptions = (settings: Settings): AiRequestOptions => ({
  aiProvider: 'gemini',
  customApiKey: (settings.aiProvider || 'gemini') === 'gemini' ? settings.customApiKey || undefined : undefined,
  model: (settings.aiProvider || 'gemini') === 'gemini' ? usableModel(settings) : DEFAULT_GEMINI_MODEL,
});

// The provider's name as shown on a card ("Gemini", "Groq"…), from the
// options the request used.
export const providerName = (options?: AiRequestOptions): string => {
  if (!options || options.aiProvider !== 'openai-compatible') return 'Gemini';
  const url = (options.aiBaseUrl || 'https://api.groq.com/openai/v1').toLowerCase();
  if (url.includes('groq.com')) return 'Groq';
  if (url.includes('openrouter.ai')) return 'OpenRouter';
  if (url.includes('deepseek.com')) return 'DeepSeek';
  if (url.includes('googleapis.com')) return 'Gemini';
  if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes(':11434')) return 'Ollama';
  try {
    return new URL(url).hostname.replace(/^api\./, '');
  } catch {
    return 'AI';
  }
};

export const aiOrigin = (options?: AiRequestOptions, now: Date = new Date()): CardOrigin => ({
  by: 'ai',
  provider: providerName(options),
  ...(options?.model ? { model: options.model } : {}),
  at: now.toISOString(),
});

export const dictionaryOrigin = (now: Date = new Date()): CardOrigin => ({ by: 'dictionary', at: now.toISOString() });
