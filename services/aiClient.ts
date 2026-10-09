// File: /services/aiClient.ts
// Every AI request goes through here. The services set up in the settings
// are tried in order: when one fails (its free quota is used up, its key is
// wrong, it is down), the next one is asked. Each try is noted for the usage
// page. The caller learns which service answered, for the card's origin.

import { callProxy, ProxyError } from './apiService';
import { providerName } from './aiSettings';
import type { AiRequestOptions } from './geminiService';
import { logUsage } from './usageLog';

// What a request was for, on the usage page.
export type AiTask = 'extract' | 'sense' | 'grammar' | 'practice' | 'check' | 'details' | 'quiz' | 'pronunciation' | 'other';

// A wrong key, a missing key or an unknown model fails the same way every
// time: no point asking that service again in the same run.
const PERMANENT_AI_STATUS = new Set([400, 401, 403, 404]);

// Every service in the chain failed. The message names each one's reason.
export class AiChainError extends ProxyError {
  permanent: boolean;
  constructor(message: string, status: number, permanent: boolean) {
    super(message, status);
    this.name = 'AiChainError';
    this.permanent = permanent;
  }
}

export const isPermanentAiError = (error: unknown): boolean =>
  error instanceof AiChainError ? error.permanent : error instanceof ProxyError && PERMANENT_AI_STATUS.has(error.status);

// The options to try, first to last, each without its own fallbacks.
export const chainOf = (options?: AiRequestOptions): AiRequestOptions[] => {
  const { fallbacks = [], ...first } = options || {};
  return [first, ...fallbacks.map(({ fallbacks: _nested, ...o }) => o)];
};

// The provider fields every proxy call sends.
export const providerFields = (options?: AiRequestOptions) => {
  const openAi = options?.aiProvider === 'openai-compatible';
  return {
    aiProvider: openAi ? 'openai-compatible' : 'gemini',
    aiBaseUrl: openAi ? options?.aiBaseUrl || undefined : undefined,
    model: options?.model || (openAi ? 'llama-3.3-70b-versatile' : 'gemini-2.5-flash'),
    customApiKey: options?.customApiKey || undefined,
  };
};

export interface AiRequestBody {
  contents: unknown;
  config?: Record<string, unknown>;
}

export interface AiReply {
  text: string;
  candidates?: unknown;
  used: AiRequestOptions; // the service that answered
}

type Send = (fields: Record<string, unknown>) => Promise<{ text?: string; candidates?: unknown }>;
const proxySend: Send = fields => callProxy('gemini-generate', fields);

export async function aiGenerate(options: AiRequestOptions | undefined, body: AiRequestBody, task: AiTask, send: Send = proxySend): Promise<AiReply> {
  const chain = chainOf(options);
  const failures: { service: string; error: ProxyError }[] = [];
  for (const attempt of chain) {
    const service = providerName(attempt);
    try {
      const response = await send({ ...providerFields(attempt), ...body });
      logUsage({ service, task, ok: true });
      return { text: response?.text || '', candidates: response?.candidates, used: attempt };
    } catch (error) {
      const message = (error as Error)?.message || 'request failed';
      logUsage({ service, task, ok: false, status: error instanceof ProxyError ? error.status : undefined, error: message });
      // No connection at all: the next service is not reachable either.
      if (!(error instanceof ProxyError)) throw error;
      failures.push({ service, error });
    }
  }
  if (failures.length === 1) throw failures[0].error;
  const last = failures[failures.length - 1].error;
  throw new AiChainError(
    failures.map(f => f.error.message).join(' | '),
    last.status,
    failures.every(f => PERMANENT_AI_STATUS.has(f.error.status)),
  );
}
