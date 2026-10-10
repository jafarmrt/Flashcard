// File: /services/keySync.ts
// The AI and dictionary keys follow the account: a key typed on one device
// works on every device signed in to the same account. They do not travel
// with the other settings (services/settingsSync); the server keeps them
// encrypted under their own record (server/keyVault), and each key carries
// the time it was last changed, so the newest typing of each key wins and a
// key removed on one device is removed everywhere.

import type { AiProviderId, Settings } from '../types';
import type { DictionaryKeyId } from './dictionaryCatalog';
import { AI_PROVIDERS, providerKey } from './aiSettings';

// "ai:groq", "dict:mw-learners"…
export type KeyId = `ai:${AiProviderId}` | `dict:${DictionaryKeyId}`;

// A key's value ('' once removed) and when it was typed (ms since 1970; 0 for
// a key typed before keys were kept with the account).
export interface KeyEntry { v: string; at: number }
export type KeyEntries = Partial<Record<KeyId, KeyEntry>>;

const DICT_KEY_IDS: DictionaryKeyId[] = ['mw-learners', 'mw-collegiate', 'mymemory'];

export const KEY_IDS: KeyId[] = [
  ...AI_PROVIDERS.map(p => `ai:${p.id}` as KeyId),
  ...DICT_KEY_IDS.map(id => `dict:${id}` as KeyId),
];

export const MAX_KEY_LENGTH = 500;

// The keys as they are on this device now.
export const localKeyValues = (settings: Partial<Settings>): Partial<Record<KeyId, string>> => {
  const values: Partial<Record<KeyId, string>> = {};
  for (const p of AI_PROVIDERS) {
    const key = providerKey(settings, p.id);
    if (key) values[`ai:${p.id}`] = key;
  }
  for (const id of DICT_KEY_IDS) {
    const key = settings.dictKeys?.[id]?.trim();
    if (key) values[`dict:${id}`] = key;
  }
  return values;
};

// What this device sends: every key it has, and every key it removed (as
// '') since it last heard from the server.
export const localKeyEntries = (settings: Partial<Settings>): KeyEntries => {
  const values = localKeyValues(settings);
  const stamps = settings.keyStamps || {};
  const entries: KeyEntries = {};
  for (const id of KEY_IDS) {
    const v = values[id] || '';
    const at = Number(stamps[id]) || 0;
    if (v || at) entries[id] = { v, at };
  }
  return entries;
};

// The change times after a settings change: a key that is different now is
// stamped with the current time.
export const stampKeyChanges = (before: Partial<Settings>, after: Partial<Settings>, now = Date.now()): Settings['keyStamps'] | undefined => {
  const old = localKeyValues(before);
  const next = localKeyValues(after);
  const changed = KEY_IDS.filter(id => (old[id] || '') !== (next[id] || ''));
  if (changed.length === 0) return undefined;
  const stamps = { ...(after.keyStamps || before.keyStamps || {}) };
  for (const id of changed) stamps[id] = now;
  return stamps;
};

// The settings change that takes the server's keys, or null when this device
// already has them. A key changed here after the server's (typed while the
// request was out) is kept and goes up with the next sync.
export const applyServerKeys = (settings: Partial<Settings>, server: KeyEntries | null | undefined): Partial<Settings> | null => {
  if (!server || typeof server !== 'object') return null;
  const values = localKeyValues(settings);
  const stamps = { ...(settings.keyStamps || {}) };
  const aiKeys: Partial<Record<AiProviderId, string>> = {};
  for (const p of AI_PROVIDERS) if (values[`ai:${p.id}`]) aiKeys[p.id] = values[`ai:${p.id}`];
  const dictKeys: Partial<Record<DictionaryKeyId, string>> = { ...(settings.dictKeys || {}) };
  let changed = false;
  for (const id of KEY_IDS) {
    const entry = server[id];
    if (!entry || typeof entry.v !== 'string' || !Number.isFinite(entry.at)) continue;
    const localAt = Number(stamps[id]) || 0;
    if (entry.at < localAt) continue;
    if (entry.at !== localAt) { stamps[id] = entry.at; changed = true; }
    if ((values[id] || '') === entry.v) continue;
    changed = true;
    const [kind, name] = id.split(':') as ['ai' | 'dict', string];
    const target = (kind === 'ai' ? aiKeys : dictKeys) as Record<string, string>;
    if (entry.v) target[name] = entry.v; else delete target[name];
  }
  if (!changed) return null;
  // The key from before the list of services now lives in aiKeys, so a key
  // removed on another device does not come back from it.
  return { aiKeys, dictKeys, keyStamps: stamps, ...(settings.customApiKey !== undefined ? { customApiKey: undefined } : {}) };
};

// Keys as they arrived from a device: only known ids, string values of a
// sane length, and times no later than a day from now.
export const cleanKeyEntries = (value: unknown, now = Date.now()): KeyEntries => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const entries: KeyEntries = {};
  for (const id of KEY_IDS) {
    const e = raw[id] as Record<string, unknown> | undefined;
    if (!e || typeof e !== 'object' || typeof e.v !== 'string') continue;
    const v = e.v.trim();
    if (v.length > MAX_KEY_LENGTH) continue;
    const at = typeof e.at === 'number' && Number.isFinite(e.at) && e.at > 0 ? Math.min(e.at, now + 86_400_000) : 0;
    entries[id] = { v, at };
  }
  return entries;
};

// The server's keys after a device's: the later typing of each key wins; the
// server's copy wins a tie, so two devices with an old unstamped key agree on
// the one that reached the server first.
export const mergeKeyEntries = (stored: KeyEntries, incoming: KeyEntries): { merged: KeyEntries; changed: boolean } => {
  const merged: KeyEntries = { ...stored };
  let changed = false;
  for (const id of KEY_IDS) {
    const next = incoming[id];
    if (!next) continue;
    const have = merged[id];
    if (have && have.at >= next.at) continue;
    if (!have && !next.v) continue; // nothing to remove
    merged[id] = next;
    changed = true;
  }
  return { merged, changed };
};
