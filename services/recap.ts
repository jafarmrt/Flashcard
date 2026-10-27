// File: /services/recap.ts
// "What happened so far": coming back to a book after a few days, a short
// reminder of the pages read last. With AI, a summary in simple English and
// Persian; without it (or when it fails), the last lines read, word for word.
// Kept on the device per place, so it is made once.

import { aiGenerate } from './aiClient';
import type { AiRequestOptions } from './geminiService';
import { splitSentences } from './textChunker';

// Days away before a reminder is offered.
export const RECAP_AFTER_DAYS = 2;
const MAX_TEXT_CHARS = 6000;

export interface Recap { summary?: string; persian?: string; lastLines: string; by?: 'ai' }

// The newest day before today with reading on the book's log, or (for books
// read before the log existed) the day the book last changed.
export const daysAway = (readingDays: string[], fallbackIso: string | undefined, today: string): number | null => {
  if (readingDays.includes(today)) return null; // read earlier today
  const before = readingDays.filter(d => d < today).sort();
  const last = before[before.length - 1] || fallbackIso?.slice(0, 10);
  if (!last || last >= today) return null;
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${last}T12:00:00Z`)) / 86_400_000);
};

// The last few sentences of what was read.
export const lastLines = (texts: string[], count = 3): string => {
  const sentences = splitSentences(texts.join('\n').replace(/\s+/g, ' ').trim());
  return sentences.slice(-count).join(' ').trim();
};

export const recapPrompt = (title: string, text: string) =>
  `A Persian speaker learning English is coming back to the book "${title}" after a few days. `
  + 'Remind them what happened in the pages below, which they read last time.\n'
  + 'Reply with JSON only: {"summary": "3-4 short sentences in simple English (B1), past tense, the main events and who is who", '
  + '"persian": "the same in natural Persian"}. Do not invent anything that is not in the text, and do not tell what comes next.\n\n'
  + text.slice(-MAX_TEXT_CHARS);

export const parseRecap = (raw: string): { summary?: string; persian?: string } => {
  const json = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').match(/\{[\s\S]*\}/)?.[0];
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    const s = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 1200) : undefined);
    return { summary: s(v.summary), persian: s(v.persian) };
  } catch {
    return {};
  }
};

export const makeRecap = async (title: string, texts: string[], useAi: boolean, options?: AiRequestOptions, send?: Parameters<typeof aiGenerate>[3]): Promise<Recap> => {
  const lines = lastLines(texts);
  if (!useAi) return { lastLines: lines };
  try {
    const reply = await aiGenerate(options, { contents: recapPrompt(title, texts.join('\n\n')), config: { responseMimeType: 'application/json' } }, 'other', send);
    const parsed = parseRecap(reply.text);
    return parsed.summary ? { ...parsed, lastLines: lines, by: 'ai' } : { lastLines: lines };
  } catch {
    return { lastLines: lines };
  }
};

const cacheKey = (chapterId: string, chunk: number) => `lc_recap:${chapterId}:${chunk}`;
export const savedRecap = (chapterId: string, chunk: number): Recap | null => {
  try { return JSON.parse(localStorage.getItem(cacheKey(chapterId, chunk)) || 'null'); } catch { return null; }
};
export const keepRecap = (chapterId: string, chunk: number, recap: Recap) => {
  try { localStorage.setItem(cacheKey(chapterId, chunk), JSON.stringify(recap)); } catch { /* full or private */ }
};
