// File: /services/speechCache.ts
// AI read-aloud audio kept on this device, so a piece read once plays again
// without the internet and without spending quota or credit. Kept in its own
// small browser database (the service worker clears other caches when the
// app updates). Keyed by normalized text and the service, model and voice that
// made it; stored as ArrayBuffer + mimeType for universal IndexedDB support.

import Dexie, { type Table } from 'dexie';

export const MAX_PIECES = 5000; // ~15+ hours of book & vocabulary audio

interface SpeechRow {
  key: string;
  bytes?: ArrayBuffer;
  mimeType?: string;
  audio?: Blob; // legacy v1 rows
  byteLength?: number;
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

export const normalizeSpeechText = (text: string): string =>
  text.replace(/\s+/g, ' ').trim();

export const speechKey = async (
  service: string,
  model: string,
  voice: string,
  text: string,
): Promise<string> => {
  const cleanText = normalizeSpeechText(text);
  const data = new TextEncoder().encode(`${service}\n${model}\n${voice}\n${cleanText}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
};

const rowToBlob = (row: SpeechRow): Blob | null => {
  if (row.bytes && row.bytes.byteLength > 0) {
    return new Blob([row.bytes], { type: row.mimeType || 'audio/wav' });
  }
  if (row.audio && row.audio.size > 0) {
    return row.audio;
  }
  return null;
};

export async function cachedSpeech(key: string): Promise<Blob | null> {
  const store = open();
  if (!store) return null;
  try {
    const row = await store.pieces.get(key);
    if (!row) return null;
    const blob = rowToBlob(row);
    if (!blob) return null;
    store.pieces.update(key, { at: Date.now() }).catch(() => undefined);
    return blob;
  } catch {
    return null;
  }
}

export async function hasCachedSpeech(key: string): Promise<boolean> {
  const store = open();
  if (!store) return false;
  try {
    const row = await store.pieces.get(key);
    if (!row) return false;
    return Boolean((row.bytes && row.bytes.byteLength > 0) || (row.audio && row.audio.size > 0));
  } catch {
    return false;
  }
}

export async function countCachedSpeechPieces(
  service: string,
  model: string,
  voice: string,
  texts: readonly string[],
): Promise<number> {
  const store = open();
  if (!store || texts.length === 0) return 0;
  try {
    const clean = texts.map(normalizeSpeechText).filter(Boolean);
    if (clean.length === 0) return 0;
    const keys = await Promise.all(clean.map(t => speechKey(service, model, voice, t)));
    const rows = await store.pieces.bulkGet(keys);
    let count = 0;
    for (const row of rows) {
      if (row && ((row.bytes && row.bytes.byteLength > 0) || (row.audio && row.audio.size > 0))) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export async function saveSpeech(
  key: string,
  audioOrBytes: Blob | Uint8Array,
  mimeType = 'audio/wav',
): Promise<void> {
  const store = open();
  if (!store) return;
  try {
    let buffer: ArrayBuffer;
    let type = mimeType;
    if (audioOrBytes instanceof Uint8Array) {
      buffer = audioOrBytes.buffer.slice(
        audioOrBytes.byteOffset,
        audioOrBytes.byteOffset + audioOrBytes.byteLength,
      ) as ArrayBuffer;
    } else {
      type = audioOrBytes.type || mimeType;
      buffer = await audioOrBytes.arrayBuffer();
    }
    if (buffer.byteLength === 0) return;
    await store.pieces.put({
      key,
      bytes: buffer,
      mimeType: type,
      byteLength: buffer.byteLength,
      at: Date.now(),
    });
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
    await store.pieces.each(row => {
      const len = row.byteLength ?? row.bytes?.byteLength ?? row.audio?.size ?? 0;
      if (len > 0) {
        pieces++;
        bytes += len;
      }
    });
    return { pieces, bytes };
  } catch {
    return { pieces: 0, bytes: 0 };
  }
}

export async function clearSpeechCache(): Promise<void> {
  await open()?.pieces.clear();
}
