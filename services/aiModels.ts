// File: /services/aiModels.ts
// The models an AI service offers, read from the service with the key typed
// on this device, for the model picker. One list per service and key is kept
// while the app is open.

import type { AiRequestOptions } from './geminiService';
import { callProxy } from './apiService';
import { providerFields } from './aiClient';
import type { AiModel } from '../server/aiModels';

export type { AiModel };

const cache = new Map<string, Promise<AiModel[]>>();

export const listModels = (options: AiRequestOptions): Promise<AiModel[]> => {
  const { model: _model, ...fields } = providerFields(options);
  const key = JSON.stringify(fields);
  let list = cache.get(key);
  if (!list) {
    list = callProxy('list-models', fields).then((r: { models?: AiModel[] }) => (Array.isArray(r?.models) ? r.models : []));
    list.catch(() => cache.delete(key));
    cache.set(key, list);
  }
  return list;
};

// Models whose id or name holds every word of the search.
export const filterModels = (models: AiModel[], search: string, freeOnly = false): AiModel[] => {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter(m => (!freeOnly || m.free) && words.every(w => m.id.toLowerCase().includes(w) || (m.name || '').toLowerCase().includes(w)));
};

// "128K", "1M": how much text a model reads at once.
export const contextLabel = (tokens?: number): string => {
  if (!tokens) return '';
  if (tokens >= 1_000_000) return `${Math.round((tokens / 1_000_000) * 10) / 10}M`;
  return `${Math.round(tokens / 1000)}K`;
};

// "$0.30"; small prices keep their first significant digits.
export const dollars = (n: number): string => {
  if (n === 0) return '$0';
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n < 0.0001) return '<$0.0001';
  return `$${Number(n.toPrecision(2))}`;
};
