// File: /services/senseCache.ts
// The AI's meaning of a term in its sentence, kept on this device: tapping
// the same word in the same sentence again (reopening a section, reading it
// a second time) answers at once and costs no AI request. Kept in the
// dictionary lookups' table under a key of its own.

import type { Sense } from './senseService';
import { db } from './localDBService';

const KEEP_MS = 90 * 24 * 60 * 60 * 1000;

// One answer per term, sentence and level: the level changes how the AI
// explains, the sentence which meaning it picks.
export const senseKey = (term: string, sentence: string, level: string): string =>
  `sense|${level}|${term.trim().toLowerCase().replace(/’/g, "'")}|${sentence.replace(/\s+/g, ' ').trim()}`;

const table = () => (typeof indexedDB === 'undefined' ? null : db.lookups);

export async function savedSense(key: string): Promise<Sense | null> {
  const t = table();
  if (!t) return null;
  try {
    const row = await t.get(key);
    return row && Date.now() < row.until ? (row.value as unknown as Sense) : null;
  } catch (e) {
    console.warn('Reading a saved meaning failed:', e);
    return null;
  }
}

export function keepSense(key: string, sense: Sense): void {
  const t = table();
  if (!t || !sense.back) return;
  t.put({ term: key, value: sense as never, until: Date.now() + KEEP_MS }).catch(e => console.warn('Saving a meaning failed:', e));
}
