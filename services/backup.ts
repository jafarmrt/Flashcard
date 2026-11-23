// File: /services/backup.ts
// A full backup of the account in one JSON file, and putting it back.
//
// The CSV export holds the cards' content only: no schedule, no review
// history, books, notes or known words, and importing it made new cards. A
// deletion reaches every device and stays, so a wrong tap had no way back.
// This file holds everything the account syncs, plus the chapter texts.
//
// Restoring adds; it never deletes or overwrites. A row that is here and not
// deleted stays as it is. A row that is missing or deleted here comes back
// under a new id (references to it follow): a deleted row stays deleted
// wherever it is synced, so the old id could not come back.

import type { Chapter, ChapterText, Deck, Flashcard, KnownWord, Occurrence, PracticeAnswer, Source, SpeechAttempt, StudyLog, TextNote } from '../types';
import { SYNC_TABLES, type SyncTable } from './syncClient';
import { studyLogKey } from './syncState';

export const BACKUP_FORMAT = 1;

type Row = { id: string; isDeleted?: boolean; updatedAt?: string; [key: string]: any };

export interface BackupData {
  decks: Deck[];
  cards: Flashcard[];
  sources: Source[];
  chapters: Chapter[];
  occurrences: Occurrence[];
  knownWords: KnownWord[];
  speechAttempts: SpeechAttempt[];
  notes: TextNote[];
  practice: PracticeAnswer[];
  studyHistory: StudyLog[];
  chapterTexts: ChapterText[];
}

export interface Backup {
  app: 'lingua-cards';
  format: number;
  version: string; // the app's version that made it
  exportedAt: string;
  data: BackupData;
}

export class BackupError extends Error {}

// Rows deleted here are left out: the file is what the account holds now.
export const makeBackup = (local: BackupData, version: string, now: Date = new Date()): Backup => {
  const alive = <T extends Row>(rows: T[]) => rows.filter(r => !r.isDeleted);
  return {
    app: 'lingua-cards',
    format: BACKUP_FORMAT,
    version,
    exportedAt: now.toISOString(),
    data: {
      decks: alive(local.decks),
      cards: alive(local.cards).map(c => (typeof c.audioSrc === 'string' && c.audioSrc.startsWith('blob:') ? { ...c, audioSrc: undefined } : c)),
      sources: alive(local.sources),
      chapters: alive(local.chapters),
      occurrences: alive(local.occurrences),
      knownWords: alive(local.knownWords),
      speechAttempts: alive(local.speechAttempts),
      notes: alive(local.notes),
      practice: alive(local.practice || []),
      studyHistory: local.studyHistory.map(({ id: _deviceId, ...log }) => log),
      chapterTexts: local.chapterTexts.map(({ uploaded: _u, ...t }) => t),
    },
  };
};

const list = (v: unknown): any[] => (Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : []);

export const readBackup = (text: string): Backup => {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError('این فایل پشتیبان برنامه نیست (JSON خوانده نشد).');
  }
  if (!parsed || parsed.app !== 'lingua-cards' || typeof parsed.data !== 'object') throw new BackupError('این فایل پشتیبان Lingua Cards نیست.');
  if (Number(parsed.format) > BACKUP_FORMAT) throw new BackupError('این پشتیبان را نسخهٔ تازه‌تری از برنامه ساخته؛ اول برنامه را به‌روز کن.');
  const d = parsed.data;
  const rows = (v: unknown) => list(v).filter(r => typeof r.id === 'string' && r.id);
  return {
    app: 'lingua-cards',
    format: Number(parsed.format) || BACKUP_FORMAT,
    version: String(parsed.version || ''),
    exportedAt: String(parsed.exportedAt || ''),
    data: {
      decks: rows(d.decks), cards: rows(d.cards), sources: rows(d.sources), chapters: rows(d.chapters),
      occurrences: rows(d.occurrences), knownWords: rows(d.knownWords), speechAttempts: rows(d.speechAttempts), notes: rows(d.notes), practice: rows(d.practice),
      studyHistory: list(d.studyHistory).filter(l => typeof l.cardId === 'string' && typeof l.date === 'string'),
      chapterTexts: rows(d.chapterTexts).filter(t => Array.isArray(t.chunks)),
    },
  };
};

export interface RestorePlan {
  rows: Record<SyncTable, Row[]>;
  studyHistory: StudyLog[];
  chapterTexts: ChapterText[];
  counts: Record<SyncTable, number> & { studyHistory: number };
}

// What putting `backup` back adds to `local`. `newId` makes ids for rows that
// come back; `now` stamps them so the next sync sends them.
export const planRestore = (backup: Backup, local: BackupData, newId: () => string, now: Date = new Date()): RestorePlan => {
  const stamp = now.toISOString();
  const remap: Record<SyncTable, Map<string, string>> = Object.fromEntries(SYNC_TABLES.map(t => [t, new Map()])) as any;
  const taken: Record<SyncTable, Row[]> = Object.fromEntries(SYNC_TABLES.map(t => [t, []])) as any;

  // Which rows come back, and under which id.
  for (const table of SYNC_TABLES) {
    const here = new Map((local[table] as Row[]).map(r => [r.id, r]));
    for (const row of backup.data[table] as Row[]) {
      if (row.isDeleted) continue;
      const mine = here.get(row.id);
      if (mine && !mine.isDeleted) continue;
      const id = mine ? newId() : row.id;
      if (id !== row.id) remap[table].set(row.id, id);
      taken[table].push({ ...row, id });
    }
  }
  const to = (table: SyncTable, id: string | undefined) => (id ? remap[table].get(id) || id : id);

  // A row that is here and stays, but points to a row that came back under a
  // new id (the place a deleted card was met in a book), is pointed to the
  // new id; it would point to the deleted row otherwise.
  const moved = (r: Row) => [['deckId', 'decks'], ['cardId', 'cards'], ['sourceId', 'sources'], ['chapterId', 'chapters']]
    .some(([field, table]) => typeof r[field] === 'string' && remap[table as SyncTable].has(r[field]));
  for (const table of SYNC_TABLES) {
    const inFile = new Map((backup.data[table] as Row[]).map(r => [r.id, r]));
    for (const mine of local[table] as Row[]) {
      if (mine.isDeleted || !inFile.has(mine.id) || taken[table].some(r => r.id === mine.id)) continue;
      if (moved(mine)) taken[table].push({ ...mine });
    }
  }

  // References follow the rows that moved.
  const rows = {} as Record<SyncTable, Row[]>;
  for (const table of SYNC_TABLES) {
    rows[table] = taken[table].map(r => {
      const out: Row = { ...r, updatedAt: stamp };
      if ('deckId' in r) out.deckId = to('decks', r.deckId);
      if ('cardId' in r && r.cardId) out.cardId = to('cards', r.cardId);
      if ('sourceId' in r) out.sourceId = to('sources', r.sourceId);
      if ('chapterId' in r) out.chapterId = to('chapters', r.chapterId);
      if (table === 'sources' && r.position?.chapterId) out.position = { ...r.position, chapterId: to('chapters', r.position.chapterId) };
      return out;
    });
  }

  const haveLogs = new Set(local.studyHistory.map(studyLogKey));
  const studyHistory: StudyLog[] = [];
  for (const log of backup.data.studyHistory) {
    const cardId = to('cards', log.cardId)!;
    const moved = cardId !== log.cardId;
    const next: StudyLog = { ...log, cardId, ...(moved ? { uid: newId() } : {}) };
    delete next.id;
    if (!moved && haveLogs.has(studyLogKey(log))) continue;
    studyHistory.push(next);
  }

  const haveTexts = new Set(local.chapterTexts.map(t => t.id));
  const chapterTexts: ChapterText[] = [];
  for (const text of backup.data.chapterTexts) {
    const id = to('chapters', text.id)!;
    if (id === text.id && haveTexts.has(id)) continue;
    chapterTexts.push({ ...text, id, sourceId: to('sources', text.sourceId)!, uploaded: false });
  }

  const counts = Object.fromEntries(SYNC_TABLES.map(t => [t, rows[t].length])) as RestorePlan['counts'];
  counts.studyHistory = studyHistory.length;
  return { rows, studyHistory, chapterTexts, counts };
};

// --- A quiet reminder ---
//
// The account lives in the browser and on the server (on Vercel: an Upstash
// Redis database on its free plan, which nobody backs up for you). A backup
// file once a month is the copy that survives both. This device remembers
// when the last one was made.

const LAST_BACKUP_KEY = 'lc_last_backup';
export const BACKUP_EVERY_DAYS = 30;
const WORTH_BACKING_UP = 20; // cards

export const markBackupMade = (now: Date = new Date()): void => {
  try { localStorage.setItem(LAST_BACKUP_KEY, now.toISOString()); } catch { /* private mode */ }
};

// Whole days since the last backup made on this device; null when none was.
export const daysSinceBackup = (now: Date = new Date()): number | null => {
  try {
    const at = Date.parse(localStorage.getItem(LAST_BACKUP_KEY) || '');
    return Number.isFinite(at) ? Math.max(0, Math.floor((now.getTime() - at) / 86_400_000)) : null;
  } catch {
    return null;
  }
};

export const backupDue = (days: number | null, cardCount: number): boolean =>
  cardCount >= WORTH_BACKING_UP && (days === null || days >= BACKUP_EVERY_DAYS);
