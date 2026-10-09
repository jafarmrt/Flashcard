// File: /services/lookupCache.ts
// Dictionary lookups kept on this device: a word tapped once opens at once
// the next time, also offline. The server keeps its own copy for the other
// devices. How long each is kept: services/lookupLifetime.

import type { FreeEnrichment } from './freeExtractionService';
import { db } from './localDBService';
import { lookupKeepMs, lookupKey } from './lookupLifetime';

// No IndexedDB (tests, old browsers): nothing is kept.
const lookupsTable = () => (typeof indexedDB === 'undefined' ? null : db.lookups);

export async function cachedLookup(term: string, load: () => Promise<FreeEnrichment>): Promise<FreeEnrichment> {
  const key = lookupKey(term);
  const table = lookupsTable();
  if (table) {
    try {
      const row = await table.get(key);
      if (row && Date.now() < row.until) return row.value;
    } catch (e) {
      console.warn('Reading saved lookups failed:', e);
    }
  }
  const value = await load();
  const keepMs = lookupKeepMs(value);
  if (table && keepMs > 0) {
    table.put({ term: key, value, until: Date.now() + keepMs }).catch(e => console.warn('Saving a lookup failed:', e));
  }
  return value;
}
