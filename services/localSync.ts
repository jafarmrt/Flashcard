// File: /services/localSync.ts
// The browser's side of the account sync: reading this device's synced rows
// from IndexedDB and writing a round of the server's changes into it. What
// to send and how a row from the server is taken are the rules of
// services/syncClient; the rounds are run by services/syncRunner;
// hooks/useAppLogic only starts a sync and shows the result.

import { db } from './localDBService';
import type { Flashcard, Settings } from '../types';
import { confirmReceived, type LocalData, SYNC_TABLES, type SyncTable, takeIncoming, withLocalAudio } from './syncClient';
import type { SyncRoundApplyArgs, SyncRunnerDeps } from './syncRunner';
import { newStudyLogs, profileStamp } from './syncState';
import { callProxy } from './apiService';

// The Dexie table behind each synced table.
export const SYNC_DB_TABLES: Record<SyncTable, any> = {
  decks: db.decks, cards: db.flashcards, sources: db.sources, chapters: db.chapters, occurrences: db.occurrences,
  knownWords: db.knownWords, speechAttempts: db.speechAttempts, notes: db.notes, practice: db.practice,
  themeExercises: db.themeExercises, studyLessons: db.studyLessons,
};

// This device's synced rows; `settings` are the ones that sync (no keys).
export const readLocalRows = async (settings?: Record<string, any>): Promise<LocalData> => ({
  decks: await db.decks.toArray(),
  cards: await db.flashcards.toArray(),
  sources: await db.sources.toArray(),
  chapters: await db.chapters.toArray(),
  occurrences: await db.occurrences.toArray(),
  knownWords: await db.knownWords.toArray(),
  speechAttempts: await db.speechAttempts.toArray(),
  notes: await db.notes.toArray(),
  practice: await db.practice.toArray(),
  themeExercises: await db.themeExercises.toArray(),
  studyLessons: await db.studyLessons.toArray(),
  logs: await db.studyHistory.toArray(),
  profile: await db.userProfile.get(1),
  achievements: await db.userAchievements.toArray(),
  settings,
});

// Writes one round of the server's changes in one transaction: rows by
// `takeIncoming` (a card keeps this device's own sound), new study logs,
// the profile unless it changed here meanwhile, achievements. Returns the
// sync state with what is now confirmed, and the largest log id before and
// after (syncRunner `nextLogCursor`).
export const applySyncRound = async ({ changes, before, profileBefore, state }: SyncRoundApplyArgs) => {
  let nextState = state;
  let maxBefore = 0;
  let maxAfter = 0;
  await (db as any).transaction('rw', [...SYNC_TABLES.map(t => SYNC_DB_TABLES[t]), db.studyHistory, db.userProfile, db.userAchievements], async () => {
    for (const table of SYNC_TABLES) {
      const incoming = changes[table];
      if (!Array.isArray(incoming) || incoming.length === 0) continue;
      const current = await SYNC_DB_TABLES[table].toArray();
      const taken = takeIncoming<any>(table, incoming, current, before[table], nextState.stamps[table] || {});
      let rows = taken.write;
      if (table === 'cards') {
        const byId = new Map<string, Flashcard>(current.map((c: Flashcard) => [c.id, c]));
        rows = rows.map((c: Flashcard) => withLocalAudio(c, byId.get(c.id)));
      }
      if (rows.length) await SYNC_DB_TABLES[table].bulkPut(rows);
      nextState = confirmReceived(nextState, table, taken.confirm);
    }
    const logs = await db.studyHistory.toArray();
    maxBefore = logs.reduce((m, l) => Math.max(m, l.id || 0), 0);
    const newLogs = newStudyLogs(logs, changes.studyHistory);
    if (newLogs.length) await db.studyHistory.bulkAdd(newLogs);
    maxAfter = newLogs.length ? (await db.studyHistory.toArray()).reduce((m, l) => Math.max(m, l.id || 0), 0) : maxBefore;
    if (changes.userProfile && profileStamp(await db.userProfile.get(1)) === profileBefore) {
      await db.userProfile.put(changes.userProfile);
      nextState = { ...nextState, profile: profileStamp(changes.userProfile) };
    }
    if (Array.isArray(changes.userAchievements) && changes.userAchievements.length) await db.userAchievements.bulkPut(changes.userAchievements);
  });
  return { state: nextState, maxBefore, maxAfter };
};

// What the app gives the sync: its settings, how to load a chapter's text,
// how to sync the keys, and how to take settings from another device
// (returns the settings' new stamp).
export interface DeviceSyncHooks {
  readSettings: () => Record<string, any> | undefined;
  loadChapterText: SyncRunnerDeps['loadChapterText'];
  syncKeys: () => Promise<void>;
  adoptSettings: (incoming: Partial<Settings>) => string | undefined;
}

// The dependencies of syncRunner `runAccountSync` on this device.
export const deviceSyncDeps = (hooks: DeviceSyncHooks): SyncRunnerDeps => ({
  readMetaSync: async () => (await db.meta.get('sync'))?.value,
  writeMetaSync: async state => { await db.meta.put({ key: 'sync', value: state }); },
  readLocal: () => readLocalRows(hooks.readSettings()),
  readChapters: () => db.chapters.toArray(),
  readChapterTexts: () => db.chapterTexts.toArray(),
  markChapterUploaded: async id => { await db.chapterTexts.update(id, { uploaded: true }); },
  loadChapterText: hooks.loadChapterText,
  syncKeys: hooks.syncKeys,
  callSync: payload => callProxy('sync', payload),
  callChapterPut: payload => callProxy('chapter-put', payload),
  applyRound: applySyncRound,
  adoptSettings: hooks.adoptSettings,
});
