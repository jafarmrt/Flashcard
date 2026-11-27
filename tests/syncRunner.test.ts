import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyErrorReason,
  pendingSyncSummary,
  prefetchChapterTexts,
  runAccountSync,
  type SyncRunnerDeps,
} from '../services/syncRunner';
import { freshSyncState, rowStamp, type LocalData, type SyncState } from '../services/syncClient';
import type { Chapter, ChapterText } from '../types';

const emptyLocal = (): LocalData => ({
  decks: [],
  cards: [],
  sources: [],
  chapters: [],
  occurrences: [],
  knownWords: [],
  speechAttempts: [],
  notes: [],
  practice: [],
  logs: [],
  achievements: [],
});

test('runAccountSync uploads pending chapters and runs multi-round sync until server has no more pages', async () => {
  let savedState: SyncState | undefined;
  const uploadedIds: string[] = [];
  const syncCalls: { since: number; changes: Record<string, any> }[] = [];

  const local: LocalData = {
    ...emptyLocal(),
    decks: [{ id: 'd1', name: 'Main', updatedAt: '2026-11-26T08:00:00.000Z' }],
    cards: [{
      id: 'c1', deckId: 'd1', front: 'harbor', back: 'بندر',
      createdAt: '2026-11-26T08:00:00.000Z', updatedAt: '2026-11-26T08:00:00.000Z',
      repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: '2026-11-26T08:00:00.000Z',
    }],
    chapters: [{
      id: 'ch1', sourceId: 's1', title: 'Ch 1', order: 0, chunkCount: 1, wordCount: 50,
      completed: [], createdAt: '2026-11-26T08:00:00.000Z', updatedAt: '2026-11-26T08:00:00.000Z',
    }],
    logs: [{ id: 3, uid: 'u3', cardId: 'c1', date: '2026-11-26', rating: 'GOOD' }],
  };
  const texts: ChapterText[] = [
    { id: 'ch1', sourceId: 's1', chunks: ['Hello world.'], editedAt: '2026-11-26T08:05:00.000Z', uploaded: false },
  ];

  const deps: SyncRunnerDeps = {
    readMetaSync: async () => savedState,
    writeMetaSync: async s => { savedState = s; },
    readLocal: async () => local,
    readChapters: async () => local.chapters,
    readChapterTexts: async () => texts,
    markChapterUploaded: async id => {
      uploadedIds.push(id);
      const item = texts.find(t => t.id === id);
      if (item) item.uploaded = true;
    },
    loadChapterText: async id => texts.find(t => t.id === id)!,
    callChapterPut: async () => ({ ok: true }),
    callSync: async payload => {
      syncCalls.push({ since: payload.since, changes: payload.changes });
      if (syncCalls.length === 1) {
        return { rev: 5, storeId: 'store-1', more: true, changes: { cards: [] } };
      }
      return { rev: 9, storeId: 'store-1', more: false, changes: {} };
    },
    applyRound: async ({ state }) => ({ state, maxBefore: 3, maxAfter: 3 }),
  };

  const result = await runAccountSync(deps, 'ali');
  assert.deepEqual(uploadedIds, ['ch1'], 'unuploaded live chapter text is uploaded first');
  assert.equal(result.rounds, 2, 'continues while server signals more: true');
  assert.equal(result.state.rev, 9);
  assert.equal(result.state.storeId, 'store-1');
  assert.equal(result.state.logCursor, 3);
  assert.equal(syncCalls[0].since, 0);
  assert.equal(syncCalls[0].changes.cards.length, 1);
  assert.equal(syncCalls[1].since, 5);
  assert.equal(syncCalls[1].changes.cards, undefined, 'already confirmed cards are not resent in round 2');
});

test('prefetchChapterTexts fetches missing and remotely edited chapters, and retries if textEditedAt advances', async () => {
  const chapters: Chapter[] = [
    { id: 'missing', sourceId: 's1', title: 'Missing', order: 0, chunkCount: 1, wordCount: 100, completed: [], createdAt: '', updatedAt: '' },
    { id: 'stale', sourceId: 's1', title: 'Edited', order: 1, chunkCount: 1, wordCount: 120, completed: [], createdAt: '', updatedAt: '', textEditedAt: '2026-11-26T12:00:00.000Z' },
    { id: 'fresh', sourceId: 's1', title: 'Fresh', order: 2, chunkCount: 1, wordCount: 90, completed: [], createdAt: '', updatedAt: '', textEditedAt: '2026-11-20T00:00:00.000Z' },
    { id: 'unup', sourceId: 's1', title: 'Not on server', order: 3, chunkCount: 1, wordCount: 80, completed: [], createdAt: '', updatedAt: '' },
  ];
  const texts: ChapterText[] = [
    { id: 'stale', sourceId: 's1', chunks: ['Old copy'], editedAt: '2026-11-20T00:00:00.000Z', uploaded: true },
    { id: 'fresh', sourceId: 's1', chunks: ['Current copy'], editedAt: '2026-11-20T00:00:00.000Z', uploaded: true },
  ];
  const requested: string[] = [];
  const noText = new Set<string>();

  const deps = {
    readChapters: async () => chapters,
    readChapterTexts: async () => texts,
    loadChapterText: async (id: string): Promise<ChapterText> => {
      requested.push(id);
      if (id === 'unup') throw new Error('404 Not Found');
      return { id, sourceId: 's1', chunks: ['Updated'], editedAt: '2026-11-26T12:00:00.000Z', uploaded: true };
    },
  };

  const count = await prefetchChapterTexts(deps, noText);
  assert.equal(count, 2);
  assert.deepEqual(requested, ['missing', 'stale', 'unup']);
  assert.equal(noText.has('unup|'), true, '404 chapter is remembered so it is not requested every sync');

  // If `unup` is later edited and uploaded from another device, its new textEditedAt key is tried again.
  chapters[3] = { ...chapters[3], textEditedAt: '2026-11-26T15:00:00.000Z' };
  const secondRequested: string[] = [];
  const countAfterEdit = await prefetchChapterTexts({
    ...deps,
    readChapterTexts: async () => [
      ...texts.filter(t => t.id !== 'stale'),
      { id: 'missing', sourceId: 's1', chunks: ['Updated'], uploaded: true },
      { id: 'stale', sourceId: 's1', chunks: ['Updated'], editedAt: '2026-11-26T12:00:00.000Z', uploaded: true },
    ],
    loadChapterText: async id => {
      secondRequested.push(id);
      return { id, sourceId: 's1', chunks: ['Now uploaded'], editedAt: '2026-11-26T15:00:00.000Z', uploaded: true };
    },
  }, noText);
  assert.equal(countAfterEdit, 1);
  assert.deepEqual(secondRequested, ['unup']);
});

test('pendingSyncSummary counts unsent rows, logs, unuploaded chapters, stale remote edits, and changed keys', () => {
  const saved = freshSyncState('ali');
  saved.rev = 14;
  saved.logCursor = 5;

  const local: LocalData = {
    ...emptyLocal(),
    decks: [{ id: 'd1', name: 'Main', updatedAt: '2026-11-20T00:00:00.000Z' }],
    cards: [{
      id: 'c1', deckId: 'd1', front: 'word', back: 'واژه',
      createdAt: '2026-11-26T00:00:00.000Z', updatedAt: '2026-11-26T00:00:00.000Z',
      repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: '2026-11-26T00:00:00.000Z',
    }],
    chapters: [
      { id: 'ch1', sourceId: 's1', title: 'One', order: 0, chunkCount: 1, wordCount: 50, completed: [], createdAt: '', updatedAt: '2026-11-20T00:00:00.000Z' },
      { id: 'ch2', sourceId: 's1', title: 'Two', order: 1, chunkCount: 1, wordCount: 50, completed: [], createdAt: '', updatedAt: '2026-11-20T00:00:00.000Z', textEditedAt: '2026-11-26T10:00:00.000Z' },
    ],
    logs: [
      { id: 5, uid: 'u5', cardId: 'c1', date: '2026-11-25', rating: 'GOOD' },
      { id: 6, uid: 'u6', cardId: 'c1', date: '2026-11-26', rating: 'AGAIN' },
    ],
  };
  saved.stamps.decks = { d1: rowStamp('decks', local.decks[0]) };
  local.chapters.forEach(c => { saved.stamps.chapters[c.id] = rowStamp('chapters', c); });

  const summary = pendingSyncSummary(
    local,
    saved,
    [
      { id: 'ch1', sourceId: 's1', chunks: ['A'], uploaded: false },
      { id: 'ch2', sourceId: 's1', chunks: ['Old B'], editedAt: '2026-11-21T00:00:00.000Z', uploaded: true },
    ],
    { keysChanged: ['ai:gemini', 'ai:openrouter'] },
  );

  assert.equal(summary.rev, 14);
  assert.equal(summary.byTable.decks, 0);
  assert.equal(summary.byTable.cards, 1);
  assert.equal(summary.unsentRows, 1);
  assert.equal(summary.unsentLogs, 1);
  assert.equal(summary.unuploadedChapters, 1);
  assert.equal(summary.missingOrStaleChapters, 1);
  assert.equal(summary.unsentKeys, 2);
  assert.equal(summary.totalPending, 5);
});

test('classifyErrorReason distinguishes network, region sanctions, auth, quota, and server errors in Persian', () => {
  assert.equal(classifyErrorReason('TypeError: Failed to fetch').category, 'offline');
  assert.equal(classifyErrorReason('anything', true).category, 'offline');
  assert.equal(classifyErrorReason('User location is not supported for the API use.').category, 'region');
  assert.equal(classifyErrorReason('Refused by region or sanctions policy').category, 'region');
  assert.equal(classifyErrorReason('401 Unauthorized: API key is wrong').category, 'auth');
  assert.equal(classifyErrorReason('429 Too Many Requests: quota exceeded').category, 'quota');
  assert.equal(classifyErrorReason('502 Bad Gateway').category, 'server');
});
