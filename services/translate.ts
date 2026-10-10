// File: /services/translate.ts
// A paragraph or a sentence of the reader in Persian, when the reader asks:
// by the AI services (in the settings' order) when the reader uses AI, else
// by the free translation. When the AI fails, the free translation is used,
// sentence by sentence, as it takes at most about 450 characters a request.

import { aiGenerate } from './aiClient';
import { providerName } from './aiSettings';
import { freeTranslate } from './freeExtractionService';
import type { AiRequestOptions } from './geminiService';
import { splitSentences } from './textChunker';

export interface Translation {
  text: string;
  by: 'ai' | 'free';
  service?: string; // the AI service that translated
  aiError?: string; // why the AI was not used, when it failed
}

const FREE_LIMIT = 440;

// Sentences joined into requests the free translation takes.
export const freeBatches = (text: string, limit = FREE_LIMIT): string[] => {
  const out: string[] = [];
  let current = '';
  for (const sentence of splitSentences(text.replace(/\s+/g, ' ').trim())) {
    // A sentence longer than the limit is cut at a space.
    let rest = sentence.trim();
    while (rest.length > limit) {
      const cut = rest.lastIndexOf(' ', limit);
      const at = cut > limit / 2 ? cut : limit;
      if (current) { out.push(current); current = ''; }
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (!rest) continue;
    if (current && current.length + 1 + rest.length > limit) { out.push(current); current = ''; }
    current = current ? `${current} ${rest}` : rest;
  }
  if (current) out.push(current);
  return out;
};

const translateFree = async (text: string): Promise<string> => {
  const parts: string[] = [];
  for (const batch of freeBatches(text)) {
    const t = await freeTranslate(batch);
    if (!t) return ''; // the daily quota is used up: half a paragraph would mislead
    parts.push(t);
  }
  return parts.join(' ');
};

// What a model wrote besides the translation: its thinking, quotes, a label.
export const cleanAiTranslation = (raw: string): string =>
  raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```[a-z]*\s*|\s*```$/g, '')
    .replace(/^\s*(?:ترجمه|translation)\s*[:：]\s*/i, '')
    .trim()
    .replace(/^["«“](.*)["»”]$/s, '$1')
    .trim();

export const translationPrompt = (text: string) =>
  'Translate this English text into natural, fluent Persian (Farsi) for an Iranian learner of English. '
  + 'Keep the meaning and tone; do not summarise or explain. Reply with the Persian translation only.\n\n'
  + text;

export async function translateText(text: string, useAi: boolean, options?: AiRequestOptions): Promise<Translation> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return { text: '', by: 'free' };
  let aiError: string | undefined;
  if (useAi) {
    try {
      const reply = await aiGenerate(options, { contents: translationPrompt(clean) }, 'translate');
      const out = cleanAiTranslation(reply.text);
      if (out) return { text: out, by: 'ai', service: providerName(reply.used) };
      aiError = 'empty answer';
    } catch (error) {
      aiError = (error as Error)?.message || 'request failed';
    }
  }
  return { text: await translateFree(clean), by: 'free', ...(aiError ? { aiError } : {}) };
}
