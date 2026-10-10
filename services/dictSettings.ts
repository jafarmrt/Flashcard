// File: /services/dictSettings.ts
// The saved settings turned into what every dictionary request carries: the
// dictionaries switched on, in the user's order, and the keys typed on this
// device (they stay here, like the AI keys, and are not synced).
//
// Lookups happen in many places (the reader, the card editor, bulk add,
// extraction), so the app hands the current settings over once
// (applyDictionarySettings) instead of every caller passing them along.

import type { DictionaryEntrySetting, Settings } from '../types';
import {
  DEFAULT_DICTIONARY_ORDER, DICTIONARIES, DictionaryId, DictionaryKeyId, DictionaryRequest, dictionaryInfo, dictionarySignature,
} from './dictionaryCatalog';

// Every dictionary, in the order it is tried. Ones added to the app after the
// list was saved come last, switched on or off as they are by default.
export const dictionaryList = (settings: Partial<Settings>): DictionaryEntrySetting[] => {
  const saved = (settings.dictionaries || []).filter((d, i, all) =>
    DICTIONARIES.some(info => info.id === d?.id) && all.findIndex(x => x.id === d.id) === i);
  const list = saved.length > 0
    ? saved.map(d => ({ id: d.id, enabled: !!d.enabled }))
    : DICTIONARIES.map(d => ({ id: d.id, enabled: d.enabledByDefault }));
  for (const info of DICTIONARIES) if (!list.some(d => d.id === info.id)) list.push({ id: info.id, enabled: info.enabledByDefault });
  return list;
};

export const dictionaryKey = (settings: Partial<Settings>, id: DictionaryKeyId): string | undefined =>
  settings.dictKeys?.[id]?.trim() || undefined;

// A switched-on keyed dictionary without a key on this device: the server
// may still have one of its own, so it is only a note, not a reason to skip.
export const dictionaryNote = (settings: Partial<Settings>, entry: DictionaryEntrySetting): string | null =>
  dictionaryInfo(entry.id).needsKey && !dictionaryKey(settings, entry.id as DictionaryKeyId) ? 'کلید ندارد؛ اگر سرور کلید داشته باشد از آن استفاده می‌شود' : null;

export const dictionaryRequest = (settings: Partial<Settings>): DictionaryRequest => {
  const order = dictionaryList(settings).filter(d => d.enabled).map(d => d.id);
  const keys: DictionaryRequest['keys'] = {};
  for (const id of ['mw-learners', 'mw-collegiate', 'mymemory'] as DictionaryKeyId[]) {
    const key = dictionaryKey(settings, id);
    if (key) keys[id] = key;
  }
  return { order, keys };
};

let active: DictionaryRequest = { order: DEFAULT_DICTIONARY_ORDER, keys: {} };

// Called by the app whenever the settings change.
export const applyDictionarySettings = (settings: Partial<Settings>) => {
  active = dictionaryRequest(settings);
};

export const activeDictionaryRequest = (): DictionaryRequest => active;

// Saved lookups on this device are kept per choice of dictionaries.
export const activeDictionarySignature = (): string =>
  dictionarySignature(active.order || [], id => !!active.keys?.[id as DictionaryKeyId]);

export type { DictionaryId };
