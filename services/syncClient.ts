// File: /services/syncClient.ts
// What this browser sends at each sync, and what it remembers between syncs.
//
// The browser remembers, for every row, the version the server is known to
// have (its stamp). A sync sends only rows whose stamp changed since, in
// batches small enough for Vercel's request limit, plus the last server rev it
// saw; the server answers with what other devices changed after that rev.

import type { Chapter, Deck, Flashcard, Occurrence, Source, StudyLog, UserAchievement, UserProfile } from '../types';
import { cardStamp, deckStamp, profileStamp } from './syncState.js';

export const SYNC_TABLES = ['decks', 'cards', 'sources', 'chapters', 'occurrences'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

type Stamped = { id: string; updatedAt?: string; isDeleted?: boolean };

export interface SyncState {
  user: string;
  storeId?: string;
  rev: number;
  stamps: Record<SyncTable, Record<string, string>>;
  profile?: string;
  settings?: string;
  achievements?: string;
  logCursor: number; // study logs with a larger local id are not sent yet
  fullAt: number; // when every row was last sent (ms)
}

// Once a week every row is sent again, so anything a failed sync left behind
// reaches the server in the end.
export const FULL_PUSH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
export const ROWS_PER_REQUEST = 300;
export const LOGS_PER_REQUEST = 2000;

export const freshSyncState = (user: string, now = Date.now()): SyncState => ({
  user,
  rev: 0,
  stamps: { decks: {}, cards: {}, sources: {}, chapters: {}, occurrences: {} },
  logCursor: 0,
  fullAt: now,
});

// The state to sync with: a new one for another account, and a forgotten
// one (everything is sent) when the weekly full send is due.
export const usableSyncState = (saved: SyncState | undefined, user: string, now = Date.now()): SyncState => {
  if (!saved || saved.user !== user || !saved.stamps) return freshSyncState(user, now);
  if (now - (saved.fullAt || 0) > FULL_PUSH_EVERY_MS) {
    return { ...freshSyncState(user, now), storeId: saved.storeId, rev: saved.rev };
  }
  return saved;
};

// A device signing in for the first time takes the account as it is: what
// it holds now (a fresh profile, the default deck) counts as already sent.
export const markAllSynced = (state: SyncState, local: LocalData): SyncState => {
  const stamps = { ...state.stamps };
  for (const table of SYNC_TABLES) {
    stamps[table] = Object.fromEntries((local[table] as Stamped[]).map(r => [r.id, rowStamp(table, r)]));
  }
  return {
    ...state,
    stamps,
    profile: profileStamp(local.profile),
    settings: local.settings?.updatedAt,
    achievements: achievementsStamp(local.achievements),
    logCursor: local.logs.reduce((max, l) => Math.max(max, l.id || 0), 0),
  };
};

export const rowStamp = (table: SyncTable, row: Stamped): string =>
  table === 'decks' ? deckStamp(row as Deck) : cardStamp(row as Flashcard);

export const achievementsStamp = (list: UserAchievement[]) => list.map(a => a.achievementId).sort().join(',');

export interface LocalData {
  decks: Deck[];
  cards: Flashcard[];
  sources: Source[];
  chapters: Chapter[];
  occurrences: Occurrence[];
  logs: StudyLog[];
  profile?: UserProfile | null;
  achievements: UserAchievement[];
  settings?: Record<string, any>; // already without device-only secrets
}

// Sound recorded or downloaded into a card stays on this device.
const isLocalAudio = (src?: string) => !!src && /^(data|blob):/i.test(src);
export const outgoingCard = (card: Flashcard): Flashcard => {
  if (!isLocalAudio(card.audioSrc)) return card;
  const { audioSrc: _audio, ...rest } = card;
  return rest as Flashcard;
};

// A card coming back from the server keeps this device's own sound.
export const withLocalAudio = (incoming: Flashcard, local: Flashcard | undefined): Flashcard =>
  !incoming.audioSrc && local && isLocalAudio(local.audioSrc) ? { ...incoming, audioSrc: local.audioSrc } : incoming;

export interface Outgoing {
  changes: Record<string, any>;
  sent: Record<SyncTable, Record<string, string>>; // stamps of the rows in `changes`
  profile?: string;
  settings?: string;
  achievements?: string;
  lastLogId?: number; // the largest local id among the logs sent
  remaining: number; // rows and logs left for later requests
}

// The next request: rows changed since the server last confirmed them, up to
// the batch limits.
export const nextOutgoing = (local: LocalData, state: SyncState): Outgoing => {
  const changes: Record<string, any> = {};
  const sent = { decks: {}, cards: {}, sources: {}, chapters: {}, occurrences: {} } as Outgoing['sent'];
  let room = ROWS_PER_REQUEST;
  let remaining = 0;
  for (const table of SYNC_TABLES) {
    const rows = local[table] as Stamped[];
    const known = state.stamps[table] || {};
    for (const row of rows) {
      const stamp = rowStamp(table, row);
      if (known[row.id] === stamp) continue;
      if (room <= 0) { remaining++; continue; }
      room--;
      (changes[table] ||= []).push(table === 'cards' ? outgoingCard(row as Flashcard) : row);
      sent[table][row.id] = stamp;
    }
  }

  const out: Outgoing = { changes, sent, remaining };
  const pendingLogs = local.logs.filter(l => (l.id || 0) > state.logCursor).sort((a, b) => (a.id || 0) - (b.id || 0));
  if (pendingLogs.length > 0) {
    const batch = pendingLogs.slice(0, LOGS_PER_REQUEST);
    changes.studyHistory = batch.map(({ id: _localId, ...log }) => log);
    out.lastLogId = batch[batch.length - 1].id;
    out.remaining += pendingLogs.length - batch.length;
  }
  const p = profileStamp(local.profile);
  if (local.profile && p !== state.profile) { changes.userProfile = local.profile; out.profile = p; }
  const s = local.settings?.updatedAt;
  if (s && s !== state.settings) { changes.settings = local.settings; out.settings = s; }
  const a = achievementsStamp(local.achievements);
  if (local.achievements.length > 0 && a !== state.achievements) { changes.userAchievements = local.achievements; out.achievements = a; }
  return out;
};

export const isEmptyOutgoing = (out: Outgoing) => Object.keys(out.changes).length === 0;

// After the server took a request: the rows sent are what it now has.
export const confirmSent = (state: SyncState, out: Outgoing): SyncState => {
  const stamps = { ...state.stamps };
  for (const table of SYNC_TABLES) {
    if (Object.keys(out.sent[table]).length) stamps[table] = { ...stamps[table], ...out.sent[table] };
  }
  return {
    ...state,
    stamps,
    profile: out.profile ?? state.profile,
    settings: out.settings ?? state.settings,
    achievements: out.achievements ?? state.achievements,
  };
};

// Rows taken from the server are what it has too.
export const confirmReceived = (state: SyncState, table: SyncTable, rows: Stamped[]): SyncState => {
  if (rows.length === 0) return state;
  const next = { ...state.stamps[table] };
  for (const row of rows) next[row.id] = rowStamp(table, row);
  return { ...state, stamps: { ...state.stamps, [table]: next } };
};

// Where the log cursor moves after a request. Logs taken from the server get
// local ids after the ones sent; they need not go back, unless a review was
// saved here while the request was out (its id lies between).
export const nextLogCursor = (state: SyncState, out: Outgoing, maxIdBeforeAdding: number, maxIdAfterAdding: number): number => {
  if (out.lastLogId === undefined) return maxIdBeforeAdding <= state.logCursor ? Math.max(state.logCursor, maxIdAfterAdding) : state.logCursor;
  return maxIdBeforeAdding === out.lastLogId ? maxIdAfterAdding : out.lastLogId;
};
