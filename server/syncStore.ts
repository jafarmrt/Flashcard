// The account's data on the server, and how a device's changes are merged in.
//
// Every row the server keeps carries `_rev`, a number that grows with each
// change. A device sends the rows it changed since its last sync plus the last
// rev it saw, and gets back only the rows changed after that rev. So a sync
// stays small however many cards and books the account holds; chapter texts
// are kept under their own keys and never travel with it.

import type { ChapterText, Settings } from '../types';
import { migrateTexts } from '../services/library.js';
import { newerSettings } from '../services/settingsSync.js';
import { studyLogKey } from '../services/syncState.js';

export const STORE_VERSION = 2;
export const ROW_TABLES = ['decks', 'cards', 'sources', 'chapters', 'occurrences', 'knownWords'] as const;
export type RowTable = (typeof ROW_TABLES)[number];

type Row = { id: string; updatedAt?: string; isDeleted?: boolean; _rev?: number; [key: string]: any };

export interface StoreData {
  version: typeof STORE_VERSION;
  storeId: string; // changes when the data starts over (a new database)
  rev: number;
  decks: Row[];
  cards: Row[];
  sources: Row[];
  chapters: Row[];
  occurrences: Row[];
  knownWords: Row[];
  studyHistory: any[];
  userProfile: any | null;
  userAchievements: any[];
  settings?: any;
}

// What a device sends, and what it gets back.
export interface SyncChanges {
  decks?: Row[];
  cards?: Row[];
  sources?: Row[];
  chapters?: Row[];
  occurrences?: Row[];
  knownWords?: Row[];
  studyHistory?: any[];
  userProfile?: any;
  userAchievements?: any[];
  settings?: Partial<Settings>;
}

// Sound data recorded or fetched on one device stays there: it would make
// every sync heavy. Cards keep links to dictionary sound files.
export const isLocalAudio = (src: unknown) => typeof src === 'string' && /^(data|blob):/i.test(src);
const withoutLocalAudio = (card: Row): Row => {
  if (!isLocalAudio(card.audioSrc)) return card;
  const { audioSrc: _audio, ...rest } = card;
  return rest as Row;
};

const emptyStore = (storeId: string): StoreData => ({
  version: STORE_VERSION, storeId, rev: 0,
  decks: [], cards: [], sources: [], chapters: [], occurrences: [], knownWords: [],
  studyHistory: [], userProfile: null, userAchievements: [],
});

// JSON with sorted keys and without `_rev`, to tell whether two versions of a
// row hold the same data.
export const canonical = (value: unknown): string => JSON.stringify(value, (key, v) => {
  if (key === '_rev') return undefined;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = v[k]; return o; }, {} as Record<string, unknown>);
  }
  return v;
});

// Data saved before revs existed (cards, decks and texts with their chunks in
// one record) becomes the current shape: texts move into the library and
// their chunks out of the record, sound data is dropped, and every row gets a
// rev of its own so the first download can come in pages.
export const upgradeStore = (data: any, newId: () => string): { store: StoreData; chapterTexts: ChapterText[] } => {
  if (data && data.version === STORE_VERSION) {
    // Tables added since the store was saved start empty.
    for (const table of ROW_TABLES) if (!Array.isArray(data[table])) data[table] = [];
    return { store: data as StoreData, chapterTexts: [] };
  }
  const old = data && typeof data === 'object' ? data : {};
  const store = emptyStore(newId());
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  store.decks = arr(old.decks);
  store.cards = arr(old.cards).map(withoutLocalAudio);
  const migrated = migrateTexts(arr(old.texts), store.decks as any, store.cards as any);
  store.sources = migrated.sources as Row[];
  store.chapters = migrated.chapters as Row[];
  store.occurrences = migrated.occurrences as Row[];
  store.studyHistory = arr(old.studyHistory).map((log: any) => { const { id: _deviceId, ...rest } = log || {}; return rest; });
  store.userProfile = old.userProfile || null;
  store.userAchievements = arr(old.userAchievements);
  store.settings = old.settings;
  const stamp = (item: any) => { item._rev = ++store.rev; };
  for (const table of ROW_TABLES) store[table].forEach(stamp);
  store.studyHistory.forEach(stamp);
  store.userAchievements.forEach(stamp);
  if (store.userProfile) stamp(store.userProfile);
  if (store.settings) stamp(store.settings);
  return { store, chapterTexts: migrated.chapterTexts };
};

const time = (iso?: string) => new Date(iso || 0).getTime() || 0;

// One row from each side: the newer edit wins (the device on a tie), a row
// deleted anywhere stays deleted, and a section finished anywhere stays
// finished.
export const mergeRow = (table: RowTable, cloud: Row | undefined, client: Row): Row => {
  if (!cloud) return client;
  const winner = time(client.updatedAt) >= time(cloud.updatedAt) ? client : cloud;
  const merged: Row = { ...winner };
  if (cloud.isDeleted || client.isDeleted) merged.isDeleted = true;
  if (table === 'chapters') {
    const done = new Set<number>([...(cloud.completed || []), ...(client.completed || [])]);
    merged.completed = Array.from(done).sort((a, b) => a - b);
  }
  return merged;
};

// The profile: XP and level never go down, names come from the newer edit,
// and today's goals keep the larger progress.
export const mergeProfiles = (clientP: any, cloudP: any): any => {
  if (!clientP || !cloudP) return clientP || cloudP || null;
  const newer = time(clientP.profileLastUpdated) >= time(cloudP.profileLastUpdated) ? clientP : cloudP;
  let dailyGoals;
  const a = clientP.dailyGoals;
  const b = cloudP.dailyGoals;
  if (a && b) {
    if (a.date > b.date) dailyGoals = a;
    else if (b.date > a.date) dailyGoals = b;
    else {
      const goals = new Map<string, any>();
      (b.goals || []).forEach((g: any) => goals.set(g.id, { ...g }));
      (a.goals || []).forEach((g: any) => {
        const have = goals.get(g.id);
        if (!have) goals.set(g.id, { ...g });
        else if (g.progress > have.progress) { have.progress = g.progress; have.isComplete = g.isComplete; }
      });
      dailyGoals = { date: a.date, goals: Array.from(goals.values()), allCompleteAwarded: !!(a.allCompleteAwarded || b.allCompleteAwarded) };
    }
  } else {
    dailyGoals = a || b;
  }
  const { _rev: _ignored, ...base } = cloudP;
  return {
    ...base,
    id: clientP.id ?? cloudP.id,
    xp: Math.max(clientP.xp || 0, cloudP.xp || 0),
    level: Math.max(clientP.level || 1, cloudP.level || 1),
    lastStreakCheck: time(clientP.lastStreakCheck) > time(cloudP.lastStreakCheck) ? clientP.lastStreakCheck : cloudP.lastStreakCheck,
    firstName: newer.firstName,
    lastName: newer.lastName,
    bio: newer.bio,
    profileLastUpdated: newer.profileLastUpdated,
    dailyGoals: dailyGoals || undefined,
    streakFreezesEarned: Math.max(clientP.streakFreezesEarned || 0, cloudP.streakFreezesEarned || 0),
    frozenDates: Array.from(new Set([...(clientP.frozenDates || []), ...(cloudP.frozenDates || [])])).sort(),
  };
};

// Items whose stored version is exactly what the device sent: it has them
// already, so they are not sent back.
export interface Echo {
  rows: Set<string>; // `${table}:${id}`
  logs: Set<string>;
  achievements: Set<string>;
  profile: boolean;
  settings: boolean;
}

const strip = <T extends Record<string, any>>(item: T): T => {
  const { _rev: _ignored, ...rest } = item;
  return rest as T;
};

// Merges a device's changes into the store, giving every item that changed a
// new rev.
export const applyChanges = (store: StoreData, changes: SyncChanges | undefined): Echo => {
  const echo: Echo = { rows: new Set(), logs: new Set(), achievements: new Set(), profile: false, settings: false };
  if (!changes || typeof changes !== 'object') return echo;

  for (const table of ROW_TABLES) {
    const incoming = changes[table];
    if (!Array.isArray(incoming) || incoming.length === 0) continue;
    const rows = store[table];
    const at = new Map<string, number>();
    rows.forEach((r, i) => at.set(r.id, i));
    for (const raw of incoming) {
      if (!raw || typeof raw.id !== 'string' || !raw.id) continue;
      const client = strip(table === 'cards' ? withoutLocalAudio(raw) : raw);
      const i = at.get(client.id);
      const cloud = i === undefined ? undefined : rows[i];
      const merged = mergeRow(table, cloud && strip(cloud), client);
      const same = cloud !== undefined && canonical(merged) === canonical(cloud);
      if (!same) {
        merged._rev = ++store.rev;
        if (i === undefined) { at.set(client.id, rows.length); rows.push(merged); } else rows[i] = merged;
      }
      if (canonical(merged) === canonical(client)) echo.rows.add(`${table}:${client.id}`);
    }
  }

  if (Array.isArray(changes.studyHistory) && changes.studyHistory.length > 0) {
    const have = new Set(store.studyHistory.map(studyLogKey));
    for (const log of changes.studyHistory) {
      if (!log || typeof log.cardId !== 'string') continue;
      const key = studyLogKey(log);
      echo.logs.add(key);
      if (have.has(key)) continue;
      have.add(key);
      const { id: _deviceId, ...rest } = log;
      store.studyHistory.push({ ...strip(rest), _rev: ++store.rev });
    }
  }

  if (Array.isArray(changes.userAchievements)) {
    const have = new Set(store.userAchievements.map(a => a.achievementId));
    for (const a of changes.userAchievements) {
      if (!a || typeof a.achievementId !== 'string') continue;
      echo.achievements.add(a.achievementId);
      if (have.has(a.achievementId)) continue;
      have.add(a.achievementId);
      store.userAchievements.push({ ...strip(a), _rev: ++store.rev });
    }
  }

  if (changes.userProfile && typeof changes.userProfile === 'object') {
    const client = strip(changes.userProfile);
    const merged = mergeProfiles(client, store.userProfile && strip(store.userProfile));
    if (!store.userProfile || canonical(merged) !== canonical(store.userProfile)) {
      store.userProfile = { ...merged, _rev: ++store.rev };
    }
    echo.profile = canonical(store.userProfile) === canonical(client);
  }

  if (changes.settings && typeof changes.settings === 'object') {
    const client = strip(changes.settings as Record<string, any>);
    const merged = newerSettings(client, store.settings && strip(store.settings));
    if (merged && (!store.settings || canonical(merged) !== canonical(store.settings))) {
      store.settings = { ...merged, _rev: ++store.rev };
    }
    echo.settings = !!store.settings && canonical(store.settings) === canonical(newerSettings(client, null));
  }

  return echo;
};

export interface ChangesPage {
  changes: SyncChanges;
  rev: number; // what the device sends as `since` next time
  more: boolean; // another page waits
}

// Everything changed after `since`, oldest first, at most `limit` items per
// page; items the device just sent itself are left out.
export const changesSince = (store: StoreData, since: number, echo: Echo | null, limit = 500): ChangesPage => {
  type Item = { rev: number; put: (c: SyncChanges) => void };
  const items: Item[] = [];
  for (const table of ROW_TABLES) {
    for (const row of store[table]) {
      if ((row._rev || 0) <= since || echo?.rows.has(`${table}:${row.id}`)) continue;
      items.push({ rev: row._rev || 0, put: c => { (c[table] ||= []).push(strip(row)); } });
    }
  }
  for (const log of store.studyHistory) {
    if ((log._rev || 0) <= since || echo?.logs.has(studyLogKey(log))) continue;
    items.push({ rev: log._rev || 0, put: c => { (c.studyHistory ||= []).push(strip(log)); } });
  }
  for (const a of store.userAchievements) {
    if ((a._rev || 0) <= since || echo?.achievements.has(a.achievementId)) continue;
    items.push({ rev: a._rev || 0, put: c => { (c.userAchievements ||= []).push(strip(a)); } });
  }
  const p = store.userProfile;
  if (p && (p._rev || 0) > since && !echo?.profile) items.push({ rev: p._rev || 0, put: c => { c.userProfile = strip(p); } });
  const s = store.settings;
  if (s && (s._rev || 0) > since && !echo?.settings) items.push({ rev: s._rev || 0, put: c => { c.settings = strip(s); } });

  items.sort((a, b) => a.rev - b.rev);
  const page = items.slice(0, Math.max(1, limit));
  const changes: SyncChanges = {};
  page.forEach(item => item.put(changes));
  const more = items.length > page.length;
  return { changes, rev: more ? page[page.length - 1].rev : store.rev, more };
};
