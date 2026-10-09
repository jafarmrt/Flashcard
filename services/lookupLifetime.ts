// File: /services/lookupLifetime.ts
// How long a free dictionary lookup is kept, on the device and on the server.
// A full answer (the dictionary knew the word, with a translation and common
// expressions) is kept for 90 days. A partial one may come from a service
// that failed or timed out for a moment, so it is kept for a day and then
// asked again. One without a translation is not kept.

export const LOOKUP_KEEP_MS = 90 * 24 * 60 * 60 * 1000;
export const PARTIAL_LOOKUP_KEEP_MS = 24 * 60 * 60 * 1000;

type Lookup = { found?: boolean; translation?: string; collocations?: unknown[] };

export const lookupKeepMs = (value: Lookup | null | undefined): number => {
  if (!value?.translation) return 0;
  return value.found && (value.collocations?.length || 0) > 0 ? LOOKUP_KEEP_MS : PARTIAL_LOOKUP_KEEP_MS;
};

export const lookupKey = (term: string) => term.trim().toLowerCase().replace(/\s+/g, ' ');
