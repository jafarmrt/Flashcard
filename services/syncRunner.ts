// File: /services/syncRunner.ts
// Orchestrates multi-round account sync, chapter text upload/prefetch, and
// diagnostic queue inspection outside hooks/useAppLogic.ts so the sync loop
// can be tested with fakes and inspected by the diagnostics screen.

import type { Chapter, ChapterText, Settings } from '../types';
import { chapterNeedsRemoteText } from './backup';
import {
  confirmSent, freshSyncState, isEmptyOutgoing, type LocalData, markAllSynced,
  nextLogCursor, nextOutgoing, rowStamp, SYNC_TABLES, type SyncState, type SyncTable, usableSyncState,
} from './syncClient';
import { cardStamp, deckStamp, profileStamp, stampMap } from './syncState';

export const PREFETCH_PER_SYNC = 8;
export const MAX_SYNC_ROUNDS = 40;

// A fetch that never reached the server (no connection, filtered network).
export const isNetworkError = (error: unknown): boolean =>
  error instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);

const stampOf = (table: SyncTable) => (table === 'decks' ? deckStamp : cardStamp) as (row: any) => string;

export interface SyncRoundApplyArgs {
  changes: Record<string, any>;
  before: Record<SyncTable, Map<string, string>>;
  profileBefore: string;
  state: SyncState;
}

export interface SyncRunnerDeps {
  readMetaSync: () => Promise<SyncState | undefined>;
  writeMetaSync: (state: SyncState) => Promise<void>;
  readLocal: () => Promise<LocalData>;
  readChapters: () => Promise<Chapter[]>;
  readChapterTexts: () => Promise<ChapterText[]>;
  markChapterUploaded: (id: string) => Promise<void>;
  loadChapterText: (id: string) => Promise<ChapterText>;
  syncKeys?: () => Promise<void>;
  callSync: (payload: { since: number; storeId?: string; changes: Record<string, any> }) => Promise<any>;
  callChapterPut: (payload: { id: string; sourceId: string; chunks: string[]; editedAt?: string }) => Promise<any>;
  applyRound: (args: SyncRoundApplyArgs) => Promise<{ state: SyncState; maxBefore: number; maxAfter: number }>;
  adoptSettings?: (incoming: Partial<Settings>) => string | undefined;
}

// Chapter texts of live chapters that the server does not have yet.
export const pendingChapterTexts = (texts: ChapterText[], chapters: Chapter[]): ChapterText[] => {
  const live = new Set(chapters.filter(c => !c.isDeleted).map(c => c.id));
  return texts.filter(t => !t.uploaded && live.has(t.id));
};

// Uploads the chapter texts not yet sent. The cap is high enough for a whole
// book: at 20 a sync, chapters 21 and on of a long book stayed on this
// device until some unrelated change started another sync, and were lost if
// another account then signed in here. A chapter the server refuses stays
// local and is retried on the next sync.
export const CHAPTER_UPLOADS_PER_SYNC = 200;
export const uploadChapterTexts = async (
  deps: Pick<SyncRunnerDeps, 'readChapters' | 'readChapterTexts' | 'callChapterPut' | 'markChapterUploaded'>,
  limit = CHAPTER_UPLOADS_PER_SYNC,
): Promise<number> => {
  const texts = (await deps.readChapterTexts()).filter(t => !t.uploaded);
  if (texts.length === 0) return 0;
  const pending = pendingChapterTexts(texts, await deps.readChapters());
  let uploaded = 0;
  for (const text of pending.slice(0, limit)) {
    try {
      await deps.callChapterPut({ id: text.id, sourceId: text.sourceId, chunks: text.chunks, ...(text.editedAt ? { editedAt: text.editedAt } : {}) });
      await deps.markChapterUploaded(text.id);
      uploaded++;
    } catch (error) {
      if (isNetworkError(error)) throw error;
      console.warn(`Uploading chapter ${text.id} failed:`, error);
    }
  }
  return uploaded;
};

// Prefetches chapters whose text has never been downloaded here OR whose text
// was edited more recently on another device (`chapter.textEditedAt` > local `editedAt`).
// `noTextOnServer` remembers `(chapterId|textEditedAt)` pairs that 404ed in this
// session so unuploaded chapters are not requested after every sync, while a
// later edit on another device still triggers a fresh fetch.
export const prefetchChapterTexts = async (
  deps: Pick<SyncRunnerDeps, 'readChapters' | 'readChapterTexts' | 'loadChapterText'>,
  noTextOnServer: Set<string>,
  limit = PREFETCH_PER_SYNC,
): Promise<number> => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
  const texts = await deps.readChapterTexts();
  const textById = new Map(texts.map(t => [t.id, t]));
  const chapters = await deps.readChapters();
  const wanted = chapters.filter(c => {
    const key = `${c.id}|${c.textEditedAt || ''}`;
    return !noTextOnServer.has(key) && chapterNeedsRemoteText(c, textById.get(c.id));
  }).slice(0, limit);

  let fetched = 0;
  for (const chapter of wanted) {
    const key = `${chapter.id}|${chapter.textEditedAt || ''}`;
    try {
      const loaded = await deps.loadChapterText(chapter.id);
      if (chapter.textEditedAt && (loaded.editedAt || '') < chapter.textEditedAt) {
        // Offline fallback returned the older local copy or server still had older text.
        noTextOnServer.add(key);
      } else {
        fetched++;
      }
    } catch (error) {
      if (isNetworkError(error)) break;
      noTextOnServer.add(key);
      console.warn(`Fetching the text of chapter ${chapter.id} failed:`, error);
    }
  }
  return fetched;
};

// Runs a complete multi-round sync for `user` (`pullOnly` marks existing local
// defaults as synced before pulling a newly signed-in account).
export const runAccountSync = async (
  deps: SyncRunnerDeps,
  user: string,
  options: { pullOnly?: boolean } = {},
): Promise<{ state: SyncState; rounds: number }> => {
  let state: SyncState = usableSyncState(await deps.readMetaSync(), user);
  if (options.pullOnly) state = markAllSynced(freshSyncState(user), await deps.readLocal());

  // A key sync failure (other than a network cut) does not hold back card sync.
  if (deps.syncKeys) {
    try {
      await deps.syncKeys();
    } catch (error) {
      if (isNetworkError(error)) throw error;
      console.warn('Syncing the keys failed:', error);
    }
  }

  await uploadChapterTexts(deps);

  let needPull = true;
  let rounds = 0;
  for (let round = 0; round < MAX_SYNC_ROUNDS; round++) {
    const local = await deps.readLocal();
    const out = nextOutgoing(local, state);
    if (isEmptyOutgoing(out) && !needPull) break;
    rounds++;

    const before = Object.fromEntries(
      SYNC_TABLES.map(t => [t, stampMap((local[t] || []) as any[], stampOf(t))]),
    ) as Record<SyncTable, Map<string, string>>;
    const profileBefore = profileStamp(local.profile);

    const response = await deps.callSync({ since: state.rev, storeId: state.storeId, changes: out.changes });
    const changes = response.changes || {};
    state = response.reset ? { ...freshSyncState(user), storeId: response.storeId } : confirmSent(state, out);

    const applied = await deps.applyRound({ changes, before, profileBefore, state });
    state = applied.state;

    if (changes.settings && deps.adoptSettings) {
      const currentUpdatedAt = deps.adoptSettings(changes.settings);
      if (currentUpdatedAt === changes.settings.updatedAt) {
        state = { ...state, settings: changes.settings.updatedAt };
      }
    }

    state = {
      ...state,
      rev: response.rev,
      storeId: response.storeId,
      logCursor: response.reset ? 0 : nextLogCursor(state, out, applied.maxBefore, applied.maxAfter),
    };
    await deps.writeMetaSync(state);
    needPull = !!response.more || !!response.reset;
  }

  return { state, rounds };
};

export interface PendingSyncSummary {
  rev: number;
  byTable: Record<SyncTable, number>;
  unsentRows: number;
  unsentLogs: number;
  unuploadedChapters: number;
  missingOrStaleChapters: number;
  unsentKeys: number;
  totalPending: number;
}

// Inspects local tables against the saved SyncState so the diagnostics screen
// can report exact unsent row counts without mutating sync state.
export const pendingSyncSummary = (
  local: LocalData,
  saved: SyncState | undefined,
  chapterTexts: ChapterText[],
  settings?: Partial<Settings>,
): PendingSyncSummary => {
  const byTable = Object.fromEntries(SYNC_TABLES.map(t => [t, 0])) as Record<SyncTable, number>;
  let unsentRows = 0;
  for (const table of SYNC_TABLES) {
    const rows = (local[table] || []) as { id: string; updatedAt?: string; isDeleted?: boolean }[];
    const known = saved?.stamps?.[table] || {};
    const count = saved?.stamps
      ? rows.filter(r => known[r.id] !== rowStamp(table, r)).length
      : rows.filter(r => !r.isDeleted).length;
    byTable[table] = count;
    unsentRows += count;
  }
  const cursor = saved?.logCursor || 0;
  const unsentLogs = local.logs.filter(l => (l.id || 0) > cursor).length;

  const liveChapters = local.chapters.filter(c => !c.isDeleted);
  const liveIds = new Set(liveChapters.map(c => c.id));
  const textById = new Map(chapterTexts.map(t => [t.id, t]));
  const unuploadedChapters = chapterTexts.filter(t => !t.uploaded && liveIds.has(t.id)).length;
  const missingOrStaleChapters = liveChapters.filter(c => chapterNeedsRemoteText(c, textById.get(c.id))).length;
  const unsentKeys = (settings?.keysChanged || []).length;

  return {
    rev: saved?.rev || 0,
    byTable,
    unsentRows,
    unsentLogs,
    unuploadedChapters,
    missingOrStaleChapters,
    unsentKeys,
    totalPending: unsentRows + unsentLogs + unuploadedChapters + unsentKeys,
  };
};

export type ErrorCategory = 'offline' | 'region' | 'auth' | 'quota' | 'server';

export interface ClassifiedError {
  category: ErrorCategory;
  label: string;
  advice: string;
}

// Turns raw proxy / network error strings into plain Persian guidance.
export const classifyErrorReason = (message: string, offline = false): ClassifiedError => {
  const text = (message || '').trim();
  if (offline || /failed to fetch|networkerror|load failed|timed out|timeout|پاسخ نداد|اینترنت|\b408\b/i.test(text)) {
    return {
      category: 'offline',
      label: 'قطعی یا کندی شبکه',
      advice: 'درخواست به سرور نرسید یا در راه ماند. داده‌هایت روی همین دستگاه امن است و با وصل شدن اینترنت همگام می‌شود.',
    };
  }
  if (/region or sanctions|location is not supported|security policy|unsupported.?(country|region)|not available in your (country|region)/i.test(text)) {
    return {
      category: 'region',
      label: 'تحریم یا محدودیت منطقه‌ای سرویس',
      advice: 'سرویس مقصد نشانی سرور را به خاطر منطقه رد کرده است (کلید سالم است). از سرور خارج از ایران (مثل Vercel) یا سرویس جایگزین در تنظیمات استفاده کن.',
    };
  }
  if (/auth_required|sign in again|api key is wrong|no api key|\b401\b|\b403\b|کلید/i.test(text)) {
    return {
      category: 'auth',
      label: 'کلید نامعتبر یا پایان نشست',
      advice: 'کلید API را در تنظیمات بررسی کن یا اگر نشست حسابت تمام شده دوباره وارد شو.',
    };
  }
  if (/quota|rate.?limit|too many|\b429\b|سهمیه/i.test(text)) {
    return {
      category: 'quota',
      label: 'اتمام سهمیهٔ موقت سرویس',
      advice: 'سهمیهٔ رایگان این سرویس فعلاً پر شده است. برنامه خودکار سراغ سرویس بعدی در فهرست تنظیمات می‌رود.',
    };
  }
  return {
    category: 'server',
    label: 'خطای سرویس یا سرور',
    advice: 'سرویس بیرونی یا سرور پاسخ معتبری نداد. چند لحظه بعد دوباره امتحان کن.',
  };
};
