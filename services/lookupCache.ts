// File: /services/lookupCache.ts
// Dictionary lookups kept on this device for 90 days: a word tapped once
// opens at once the next time, also offline. The server keeps its own copy
// for the other devices.

import type { FreeEnrichment } from './freeExtractionService';
import { db } from './localDBService';

export const LOOKUP_FRESH_MS = 90 * 24 * 60 * 60 * 1000;

export const lookupKey = (term: string) => term.trim().toLowerCase().replace(/\s+/g, ' ');

// Same rule as the server: a lookup without a translation is tried again.
export const worthKeeping = (value: FreeEnrichment | null | undefined) => !!value?.translation;

// No IndexedDB (tests, old browsers): nothing is kept.
const lookupsTable = () => (typeof indexedDB === 'undefined' ? null : db.lookups);

export async function cachedLookup(term: string, load: () => Promise<FreeEnrichment>): Promise<FreeEnrichment> {
  const key = lookupKey(term);
  const table = lookupsTable();
  if (table) {
    try {
      const row = await table.get(key);
      if (row && Date.now() - row.at < LOOKUP_FRESH_MS) return row.value;
    } catch (e) {
      console.warn('Reading saved lookups failed:', e);
    }
  }
  const value = await load();
  if (table && worthKeeping(value)) {
    table.put({ term: key, value, at: Date.now() }).catch(e => console.warn('Saving a lookup failed:', e));
  }
  return value;
}
