// File: /services/keySync.ts
// The AI and dictionary keys follow the account: a key typed on one device
// works on every device signed in to the same account. They do not travel
// with the other settings (services/settingsSync); the server keeps them
// encrypted under their own record (server/keyVault).
//
// A key typed or removed on a device is marked as changed there until the
// server has it. The server takes changes in the order they reach it (so a
// device with a wrong clock cannot undo a newer key), and every device takes
// the server's copy of each key it has not changed itself. A removed key is
// kept on the server as an empty value, so the removal reaches every device.

import type { AiProviderId, Settings } from '../types';
import type { DictionaryKeyId } from './dictionaryCatalog';
import { AI_PROVIDERS, providerKey } from './aiSettings';

// "ai:groq", "dict:mw-learners"…
export type KeyId = `ai:${AiProviderId}` | `dict:${DictionaryKeyId}`;

const DICT_KEY_IDS: DictionaryKeyId[] = ['mw-learners', 'mw-collegiate', 'mymemory'];

export const KEY_IDS: KeyId[] = [
  ...AI_PROVIDERS.map(p => `ai:${p.id}` as KeyId),
  ...DICT_KEY_IDS.map(id => `dict:${id}` as KeyId),
];

export const MAX_KEY_LENGTH = 500;

// What a device sends for a key: its value ('' when removed) and whether it
// was changed here since the server last had it.
export interface SentKey { v: string; changed?: boolean }
export type SentKeys = Partial<Record<KeyId, SentKey>>;

// What the server keeps for a key: its value ('' once removed) and when the
// server took it.
export interface StoredKey { v: string; at: number }
export type StoredKeys = Partial<Record<KeyId, StoredKey>>;

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

// What this device sends: every key it has, and every key it removed since
// the server last heard from it.
export const localKeyEntries = (settings: Partial<Settings>): SentKeys => {
  const values = localKeyValues(settings);
  const changed = new Set(settings.keysChanged || []);
  const entries: SentKeys = {};
  for (const id of KEY_IDS) {
    const v = values[id] || '';
    if (v || changed.has(id)) entries[id] = changed.has(id) ? { v, changed: true } : { v };
  }
  return entries;
};

// The keys changed here after a settings change, or undefined when no key
// changed.
export const markKeyChanges = (before: Partial<Settings>, after: Partial<Settings>): KeyId[] | undefined => {
  const old = localKeyValues(before);
  const next = localKeyValues(after);
  const changed = KEY_IDS.filter(id => (old[id] || '') !== (next[id] || ''));
  if (changed.length === 0) return undefined;
  return Array.from(new Set([...(after.keysChanged || before.keysChanged || []), ...changed]));
};

// The settings change after the server answered `sent` with its keys, or null
// when nothing changes here. A key changed here while the request was out
// stays as typed and goes with the next sync.
export const applyServerKeys = (settings: Partial<Settings>, sent: SentKeys, server: StoredKeys | null | undefined): Partial<Settings> | null => {
  if (!server || typeof server !== 'object') return null;
  const values = localKeyValues(settings);
  const changedHere = new Set(settings.keysChanged || []);
  const aiKeys: Partial<Record<AiProviderId, string>> = {};
  for (const p of AI_PROVIDERS) if (values[`ai:${p.id}`]) aiKeys[p.id] = values[`ai:${p.id}`];
  const dictKeys: Partial<Record<DictionaryKeyId, string>> = { ...(settings.dictKeys || {}) };
  let changed = false;
  for (const id of KEY_IDS) {
    const local = values[id] || '';
    if (changedHere.has(id)) {
      // Sent as changed and not typed again since: the server has it now.
      if (sent[id]?.changed && sent[id]!.v === local) { changedHere.delete(id); changed = true; }
      continue;
    }
    const entry = server[id];
    if (!entry || typeof entry.v !== 'string' || entry.v === local) continue;
    changed = true;
    const [kind, name] = id.split(':') as ['ai' | 'dict', string];
    const target = (kind === 'ai' ? aiKeys : dictKeys) as Record<string, string>;
    if (entry.v) target[name] = entry.v; else delete target[name];
  }
  if (!changed) return null;
  // The key from before the list of services now lives in aiKeys, so a key
  // removed on another device does not come back from it.
  return { aiKeys, dictKeys, keysChanged: Array.from(changedHere), ...(settings.customApiKey !== undefined ? { customApiKey: undefined } : {}) };
};

// Keys as they arrived from a device: only known ids, and string values of a
// sane length.
export const cleanSentKeys = (value: unknown): SentKeys => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const entries: SentKeys = {};
  for (const id of KEY_IDS) {
    const e = raw[id] as Record<string, unknown> | undefined;
    if (!e || typeof e !== 'object' || typeof e.v !== 'string') continue;
    const v = e.v.trim();
    if (v.length > MAX_KEY_LENGTH) continue;
    entries[id] = e.changed === true ? { v, changed: true } : { v };
  }
  return entries;
};

// The server's record as it was read back: only known ids and well-formed keys.
export const cleanStoredKeys = (value: unknown): StoredKeys => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const entries: StoredKeys = {};
  for (const id of KEY_IDS) {
    const e = raw[id] as Record<string, unknown> | undefined;
    if (e && typeof e === 'object' && typeof e.v === 'string' && typeof e.at === 'number') entries[id] = { v: e.v, at: e.at };
  }
  return entries;
};

// The server's keys after a device's: a key changed on the device replaces
// the server's; one it did not change only fills a gap (a key typed before
// keys were kept with the account), so the first device to send it wins.
export const mergeKeyEntries = (stored: StoredKeys, incoming: SentKeys, now = Date.now()): { merged: StoredKeys; changed: boolean } => {
  const merged: StoredKeys = { ...stored };
  let changed = false;
  for (const id of KEY_IDS) {
    const next = incoming[id];
    if (!next) continue;
    const have = merged[id];
    if (have && (!next.changed || have.v === next.v)) continue;
    if (!have && !next.v) continue; // nothing to remove
    merged[id] = { v: next.v, at: Math.max(now, (have?.at || 0) + 1) };
    changed = true;
  }
  return { merged, changed };
};

// Settings without any key, for a device that signs out: the next account
// signed in here must not get this one's keys.
export const withoutKeys = (settings: Partial<Settings>): Partial<Settings> => {
  const copy = { ...settings };
  delete copy.aiKeys;
  delete copy.dictKeys;
  delete copy.customApiKey;
  delete copy.keysChanged;
  return copy;
};
