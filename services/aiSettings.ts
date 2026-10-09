// File: /services/aiSettings.ts
// One place that turns the saved settings into the options every AI call
// sends, so a Groq model name never reaches Gemini and the other way round.

import type { Settings } from '../types';
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
