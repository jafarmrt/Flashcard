// File: /services/speechCache.ts
// AI read-aloud audio kept on this device, so a piece read once plays again
// without the internet and without spending quota or credit. Kept in its own
// small browser database (the service worker clears other caches when the
// app updates). Keyed by the text and the service, model and voice that made
// it; the oldest pieces go when there are too many.

import Dexie, { type Table } from 'dexie';

export const MAX_PIECES = 600; // about an hour and a half of reading

interface SpeechRow {
  key: string;
  audio: Blob;
  at: number; // when last played, for keeping the newest
}

class SpeechCacheDB extends Dexie {
  pieces!: Table<SpeechRow, string>;
  constructor() {
    super('LinguaSpeechCache');
    this.version(1).stores({ pieces: 'key, at' });
  }
}

let db: SpeechCacheDB | null = null;
const open = (): SpeechCacheDB | null => {
  if (typeof indexedDB === 'undefined') return null;
  if (!db) db = new SpeechCacheDB();
  return db;
};

export const speechKey = async (service: string, model: string, voice: string, text: string): Promise<string> => {
  const data = new TextEncoder().encode(`${service}\n${model}\n${voice}\n${text}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
};

export async function cachedSpeech(key: string): Promise<Blob | null> {
  const store = open();
  if (!store) return null;
  try {
    const row = await store.pieces.get(key);
    if (!row) return null;
    store.pieces.update(key, { at: Date.now() }).catch(() => undefined);
    return row.audio;
  } catch {
    return null;
  }
}

export async function saveSpeech(key: string, audio: Blob): Promise<void> {
  const store = open();
  if (!store) return;
  try {
    await store.pieces.put({ key, audio, at: Date.now() });
    const extra = (await store.pieces.count()) - MAX_PIECES;
    if (extra > 0) await store.pieces.orderBy('at').limit(extra).delete();
  } catch {
    // Storage full or blocked: the piece is made again next time.
  }
}

export async function speechCacheSize(): Promise<{ pieces: number; bytes: number }> {
  const store = open();
  if (!store) return { pieces: 0, bytes: 0 };
  try {
    let bytes = 0;
    let pieces = 0;
    await store.pieces.each(row => { pieces++; bytes += row.audio.size; });
    return { pieces, bytes };
  } catch {
    return { pieces: 0, bytes: 0 };
  }
}

export async function clearSpeechCache(): Promise<void> {
  await open()?.pieces.clear();
}
