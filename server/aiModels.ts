// File: /server/aiModels.ts
// The models a service offers, for the model picker in Settings, and the
// tokens each answer used, for the usage report. Both read the provider's
// own reply: Gemini's model list and usageMetadata, or the OpenAI-style
// /models list and usage that Groq, OpenRouter, DeepSeek and Ollama share.

export interface AiModel {
  id: string; // what goes in the request's "model"
  name?: string;
  context?: number; // tokens the model reads at most
  priceIn?: number; // dollars per million input tokens (OpenRouter only)
  priceOut?: number; // dollars per million output tokens
  free?: boolean;
}

export interface TokenUsage {
  input: number;
  output: number; // the answer, thinking included
  cost?: number; // dollars, when the service says (OpenRouter)
}

const MODELS_TIMEOUT_MS = 15_000;
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const perMillion = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined || n < 0 ? undefined : Math.round(n * 1_000_000 * 10_000) / 10_000;
};

// Gemini's list: only models that write text ("generateContent"), without
// the embedding, image and speech ones.
export const geminiModels = (data: any): AiModel[] =>
  (Array.isArray(data?.models) ? data.models : [])
    .filter((m: any) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m: any) => ({
      id: String(m.name || '').replace(/^models\//, ''),
      ...(m.displayName ? { name: String(m.displayName) } : {}),
      ...(num(m.inputTokenLimit) ? { context: num(m.inputTokenLimit) } : {}),
    }))
    .filter((m: AiModel) => /^(gemini|gemma)-/.test(m.id) && !/(embedding|aqa|imagen|veo|tts|image|live|transcribe)/i.test(m.id));

// An OpenAI-style list. OpenRouter adds names, prices and what each model
// writes; a model that only makes images or audio is left out.
export const openAiModels = (data: any): AiModel[] =>
  (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [])
    .filter((m: any) => m && typeof m.id === 'string' && m.id)
    .filter((m: any) => {
      const out = m.architecture?.output_modalities;
      return !Array.isArray(out) || out.includes('text');
    })
    .map((m: any) => {
      const priceIn = perMillion(m.pricing?.prompt);
      const priceOut = perMillion(m.pricing?.completion);
      const model: AiModel = { id: m.id };
      if (typeof m.name === 'string' && m.name && m.name !== m.id) model.name = m.name;
      const context = num(m.context_length) ?? num(m.context_window);
      if (context) model.context = context;
      if (priceIn !== undefined) model.priceIn = priceIn;
      if (priceOut !== undefined) model.priceOut = priceOut;
      if (m.id.endsWith(':free') || (priceIn === 0 && priceOut === 0)) model.free = true;
      return model;
    });

export async function listGeminiModels(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<AiModel[]> {
  const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
    headers: { 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
  });
  if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status });
  return geminiModels(await res.json());
}

export async function listOpenAiModels(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<AiModel[]> {
  const res = await fetchImpl(`${baseUrl}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
  });
  if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status });
  return openAiModels(await res.json());
}

// Tokens of one Gemini answer.
export const geminiUsage = (data: any): TokenUsage | undefined => {
  const u = data?.usageMetadata;
  if (!u) return undefined;
  const input = num(u.promptTokenCount) || 0;
  const output = (num(u.candidatesTokenCount) || 0) + (num(u.thoughtsTokenCount) || 0);
  return input || output ? { input, output } : undefined;
};

// Tokens of one OpenAI-style answer; OpenRouter also says what it cost.
export const openAiUsage = (data: any): TokenUsage | undefined => {
  const u = data?.usage;
  if (!u) return undefined;
  const input = num(u.prompt_tokens) || 0;
  const output = num(u.completion_tokens) || 0;
  const cost = num(u.cost);
  if (!input && !output) return undefined;
  return cost !== undefined ? { input, output, cost } : { input, output };
};
