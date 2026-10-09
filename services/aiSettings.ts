// File: /services/aiSettings.ts
// One place that turns the saved settings into the options every AI call
// sends, so a Groq model name never reaches Gemini and the other way round.
// Several services can be set up, each with its own key; they are tried in
// the order the user chose (services/aiClient), the free dictionaries last.

import type { AiProviderId, AiProviderSetting, CardOrigin, Settings } from '../types';
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

export interface ProviderInfo {
  id: AiProviderId;
  name: string;
  baseUrl?: string;
  defaultModel: string;
  needsKey: boolean; // Gemini can use the server's key; Ollama runs without one
  keyUrl?: string; // where a free key is made
}

export const AI_PROVIDERS: ProviderInfo[] = [
  { id: 'gemini', name: 'Gemini', defaultModel: DEFAULT_GEMINI_MODEL, needsKey: false, keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: DEFAULT_OPENAI_COMPATIBLE_MODEL, needsKey: true, keyUrl: 'https://console.groq.com/keys' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'deepseek/deepseek-chat', needsKey: true, keyUrl: 'https://openrouter.ai/keys' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', needsKey: true, keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.3', needsKey: false },
  { id: 'custom', name: 'سرویس دیگر', defaultModel: '', needsKey: false },
];

export const providerInfo = (id: AiProviderId): ProviderInfo => AI_PROVIDERS.find(p => p.id === id) || AI_PROVIDERS[0];

// The one service the settings named before there was a list of them.
const legacyId = (settings: Partial<Settings>): AiProviderId => {
  if (settings.aiProvider !== 'openai-compatible') return 'gemini';
  const url = (settings.aiBaseUrl || 'https://api.groq.com/openai/v1').toLowerCase();
  if (url.includes('groq.com')) return 'groq';
  if (url.includes('openrouter.ai')) return 'openrouter';
  if (url.includes('deepseek.com')) return 'deepseek';
  if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes(':11434')) return 'ollama';
  return 'custom';
};

// Every service, in the order they are tried. Settings from before the list
// become: the service chosen then, first; Gemini (the server's key) after it,
// switched off after a local or self-hosted service, whose texts never went
// to Google before.
export const providerList = (settings: Partial<Settings>): AiProviderSetting[] => {
  const saved = (settings.aiProviders || []).filter((p, i, all) => AI_PROVIDERS.some(info => info.id === p?.id) && all.findIndex(q => q.id === p.id) === i);
  let list: AiProviderSetting[];
  if (saved.length > 0) {
    list = saved.map(p => ({ ...p }));
  } else {
    const id = legacyId(settings);
    const ownUrl = (id === 'custom' || id === 'ollama') && settings.aiBaseUrl;
    list = [{ id, enabled: true, ...(settings.aiModel ? { model: settings.aiModel } : {}), ...(ownUrl ? { baseUrl: settings.aiBaseUrl } : {}) }];
    if (id !== 'gemini') list.push({ id: 'gemini', enabled: id !== 'ollama' && id !== 'custom' });
  }
  for (const info of AI_PROVIDERS) if (!list.some(p => p.id === info.id)) list.push({ id: info.id, enabled: false });
  return list;
};

// A service's key on this device. The key typed before the list belongs to
// the service chosen then.
export const providerKey = (settings: Partial<Settings>, id: AiProviderId): string | undefined =>
  settings.aiKeys?.[id]?.trim() || (id === legacyId(settings) ? settings.customApiKey?.trim() : undefined) || undefined;

export const providerOptions = (settings: Partial<Settings>, entry: AiProviderSetting): AiRequestOptions => {
  const info = providerInfo(entry.id);
  const openAi = entry.id !== 'gemini';
  const baseUrl = openAi ? entry.baseUrl?.trim() || info.baseUrl : undefined;
  return {
    aiProvider: openAi ? 'openai-compatible' : 'gemini',
    aiBaseUrl: baseUrl,
    customApiKey: providerKey(settings, entry.id),
    model: usableModel({ aiProvider: openAi ? 'openai-compatible' : 'gemini', aiModel: entry.model || info.defaultModel, aiBaseUrl: baseUrl }),
  };
};

// Why a switched-on service is skipped, or null when it can be used.
export const providerProblem = (settings: Partial<Settings>, entry: AiProviderSetting): string | null => {
  const info = providerInfo(entry.id);
  if (info.needsKey && !providerKey(settings, entry.id)) return 'کلید ندارد';
  if (entry.id === 'custom' && !entry.baseUrl?.trim()) return 'نشانی ندارد';
  if (entry.id === 'custom' && !entry.model?.trim()) return 'نام مدل ندارد';
  return null;
};

// The services to try, in order. With none usable, Gemini with the server's
// key, as before there was a list.
export const aiChain = (settings: Partial<Settings>): AiRequestOptions[] => {
  const chain = providerList(settings)
    .filter(entry => entry.enabled && !providerProblem(settings, entry))
    .map(entry => providerOptions(settings, entry));
  return chain.length > 0 ? chain : [providerOptions(settings, { id: 'gemini', enabled: true })];
};

export const aiRequestOptions = (settings: Settings): AiRequestOptions => {
  const [first, ...rest] = aiChain(settings);
  return rest.length > 0 ? { ...first, fallbacks: rest } : first;
};

// The settings change that puts one service first, with its key and model.
export const withPrimaryProvider = (settings: Partial<Settings>, entry: AiProviderSetting, key?: string): Partial<Settings> => {
  const list = providerList(settings).filter(p => p.id !== entry.id);
  const keys = { ...(settings.aiKeys || {}) };
  for (const info of AI_PROVIDERS) {
    const have = providerKey(settings, info.id);
    if (have && !keys[info.id]) keys[info.id] = have;
  }
  if (key !== undefined) {
    if (key.trim()) keys[entry.id] = key.trim();
    else delete keys[entry.id];
  }
  return {
    aiProviders: [{ ...entry, enabled: true }, ...list],
    aiKeys: keys,
    aiProvider: undefined, aiBaseUrl: undefined, aiModel: undefined, customApiKey: undefined,
  };
};

// Audio (pronunciation checks) only works with Gemini. A key typed for
// another provider is never sent to Google.
export const geminiAudioOptions = (settings: Settings): AiRequestOptions => {
  const gemini = providerList(settings).find(p => p.id === 'gemini');
  return {
    aiProvider: 'gemini',
    customApiKey: providerKey(settings, 'gemini'),
    model: usableModel({ aiProvider: 'gemini', aiModel: gemini?.model }),
  };
};

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
export const rulesOrigin = (now: Date = new Date()): CardOrigin => ({ by: 'rules', at: now.toISOString() });
