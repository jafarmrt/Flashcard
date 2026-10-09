// Free dictionary lookups kept on the server for 90 days, for every device:
// a word looked up once comes back at once, and the daily MyMemory quota is
// spent once per word, not once per tap. In Redis when cloud storage is set
// up (each key expires by itself), else in a file of its own next to the
// data file, written a few seconds after the last change.

import fs from 'fs';
import type { FreeEnrichment } from './freeLookup.js';

export const LOOKUP_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_FILE_ENTRIES = 20_000;
const WRITE_DELAY_MS = 5_000;

export interface LookupStore {
  get(key: string): Promise<FreeEnrichment | null>;
  set(key: string, value: FreeEnrichment): Promise<void>;
}

export const lookupCacheKey = (term: string) => `lookup:v1:${term.trim().toLowerCase().replace(/\s+/g, ' ')}`;

// Only a lookup that brought a translation is kept: one without (the
// translation quota ran out, the service failed) is tried again next time.
export const worthCaching = (value: FreeEnrichment | null | undefined) => !!value?.translation;

// The cache never fails a lookup: when it cannot be read or written, the
// dictionaries answer as if it were not there.
export async function cachedEnrich(term: string, store: LookupStore | null, load: () => Promise<FreeEnrichment>): Promise<FreeEnrichment> {
  const key = lookupCacheKey(term);
  if (store) {
    try {
      const hit = await store.get(key);
      if (hit) return hit;
    } catch (e) {
      console.warn('Reading the lookup cache failed:', (e as Error).message);
    }
  }
  const value = await load();
  if (store && worthCaching(value)) {
    try {
      await store.set(key, value);
    } catch (e) {
      console.warn('Saving to the lookup cache failed:', (e as Error).message);
    }
  }
  return value;
}

type Entry = { v: FreeEnrichment; at: number };

export function fileLookupStore(file: string, now: () => number = Date.now): LookupStore & { flush(): void } {
  let entries: Map<string, Entry> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const load = () => {
    if (entries) return entries;
    entries = new Map();
    try {
      if (fs.existsSync(file)) {
        const saved = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, Entry>;
        for (const [key, entry] of Object.entries(saved)) {
          if (entry && now() - entry.at < LOOKUP_TTL_MS) entries.set(key, entry);
        }
      }
    } catch (e) {
      console.warn(`The lookup cache ${file} could not be read; starting it again:`, (e as Error).message);
    }
    return entries;
  };

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!entries) return;
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(entries)), 'utf-8');
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean up */ }
      console.warn('Saving the lookup cache failed:', (e as Error).message);
    }
  };

  return {
    async get(key) {
      const entry = load().get(key);
      if (!entry) return null;
      if (now() - entry.at >= LOOKUP_TTL_MS) { load().delete(key); return null; }
      return entry.v;
    },
    async set(key, value) {
      const map = load();
      map.delete(key);
      map.set(key, { v: value, at: now() });
      // The oldest lookups go first when the file grows too large.
      while (map.size > MAX_FILE_ENTRIES) map.delete(map.keys().next().value!);
      if (!timer) {
        timer = setTimeout(flush, WRITE_DELAY_MS);
        timer.unref?.();
      }
    },
    flush,
  };
}
