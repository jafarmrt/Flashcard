import test from 'node:test';
import assert from 'node:assert/strict';
import type { Chapter, Flashcard, Source, TextNote } from '../types';
import {
  DRIVE_NOTE_BY,
  bookAudioOverview,
  bookmarkCandidateWords,
  buildCardAudioScript,
  canSpeakPersianInDrive,
  displayDeckName,
  drivingBookmarksOf,
  nextBookPosition,
  prevBookPosition,
  resolveDriveStartPosition,
  withSavedAudioPosition,
} from '../services/drivingMode';
import { normalizeSpeechText, speechKey } from '../services/speechCache';
import { AI_FIRST_PIECE_WORDS, AI_PIECE_WORDS, piecesOf, sectionPiecesForVoice } from '../services/readAloud';
import { readerSection } from '../services/readerText';
import { mergeRow } from '../services/rowMerge';

const makeChapter = (overrides: Partial<Chapter> & Pick<Chapter, 'id' | 'order'>): Chapter => ({
  sourceId: 'src-1',
  title: `Chapter ${overrides.order}`,
  chunkCount: 3,
  wordCount: 800,
  completed: [],
  createdAt: '2026-11-26T08:00:00.000Z',
  updatedAt: '2026-11-26T08:00:00.000Z',
  ...overrides,
});

const makeCard = (overrides: Partial<Flashcard> = {}): Flashcard => ({
  id: 'card-1',
  deckId: 'default',
  front: 'canopy',
  back: 'سایبان درختان جنگل',
  definition: ['the upper layer of forest trees'],
  sourceSentence: 'Sunlight filtered softly through the dense forest canopy.',
  createdAt: '2026-11-26T08:00:00.000Z',
  repetition: 0,
  easinessFactor: 2.5,
  interval: 0,
  dueDate: '2026-11-26T08:00:00.000Z',
  ...overrides,
});

test('displayDeckName translates legacy default and imported deck labels', () => {
  assert.equal(displayDeckName('Default Deck'), 'کارت‌های دستی');
  assert.equal(displayDeckName('Imported Deck'), 'واردشده');
  assert.equal(displayDeckName('Animal Farm'), 'Animal Farm');
});

test('nextBookPosition and prevBookPosition cross section and chapter boundaries cleanly', () => {
  const chapters = [
    makeChapter({ id: 'ch-1', order: 1, chunkCount: 2 }),
    makeChapter({ id: 'ch-2', order: 2, chunkCount: 3 }),
    makeChapter({ id: 'ch-del', order: 3, chunkCount: 2, isDeleted: true }),
  ];

  const step1 = nextBookPosition('src-1', chapters, 'ch-1', 0);
  assert.equal(step1?.chapter.id, 'ch-1');
  assert.equal(step1?.chunk, 1);
  assert.equal(step1?.chapterChanged, false);

  const step2 = nextBookPosition('src-1', chapters, 'ch-1', 1);
  assert.equal(step2?.chapter.id, 'ch-2');
  assert.equal(step2?.chunk, 0);
  assert.equal(step2?.chapterChanged, true);

  const end = nextBookPosition('src-1', chapters, 'ch-2', 2);
  assert.equal(end, null);

  const backAcross = prevBookPosition('src-1', chapters, 'ch-2', 0);
  assert.equal(backAcross?.chapter.id, 'ch-1');
  assert.equal(backAcross?.chunk, 1);
  assert.equal(backAcross?.chapterChanged, true);
});

test('resolveDriveStartPosition prioritizes exact audioPosition over reading position and unread fallback', () => {
  const chapters = [
    makeChapter({ id: 'ch-1', order: 1, chunkCount: 2, completed: [0, 1] }),
    makeChapter({ id: 'ch-2', order: 2, chunkCount: 3, completed: [0] }),
    makeChapter({ id: 'ch-3', order: 3, chunkCount: 4, completed: [] }),
  ];

  const fromAudio = resolveDriveStartPosition(
    {
      id: 'src-1',
      position: { chapterId: 'ch-2', chunk: 1 },
      audioPosition: { chapterId: 'ch-3', chunk: 2, pieceIndex: 4, updatedAt: '2026-11-27T08:00:00.000Z' },
    },
    chapters,
  );
  assert.equal(fromAudio?.chapter.id, 'ch-3');
  assert.equal(fromAudio?.chunk, 2);
  assert.equal(fromAudio?.pieceIndex, 4);
  assert.equal(fromAudio?.sourceOfSpot, 'audio');

  const resumed = resolveDriveStartPosition(
    { id: 'src-1', position: { chapterId: 'ch-2', chunk: 2 } },
    chapters,
  );
  assert.equal(resumed?.chapter.id, 'ch-2');
  assert.equal(resumed?.chunk, 2);
  assert.equal(resumed?.pieceIndex, 0);
  assert.equal(resumed?.sourceOfSpot, 'reading');

  const unread = resolveDriveStartPosition({ id: 'src-1' }, chapters);
  assert.equal(unread?.chapter.id, 'ch-2');
  assert.equal(unread?.chunk, 1);
  assert.equal(unread?.pieceIndex, 0);
  assert.equal(unread?.sourceOfSpot, 'unread');
});

test('bookAudioOverview, withSavedAudioPosition, and mergeRow preserve audiobook chapter progress and listening spot', () => {
  const chapters = [
    makeChapter({ id: 'ch-2', order: 2, chunkCount: 3, completed: [0, 2] }),
    makeChapter({ id: 'ch-1', order: 1, chunkCount: 2, completed: [0, 1] }),
    makeChapter({ id: 'ch-del', order: 3, chunkCount: 2, isDeleted: true }),
  ];

  const overview = bookAudioOverview('src-1', chapters);
  assert.equal(overview.chapters.length, 2);
  assert.equal(overview.chapters[0].chapter.id, 'ch-1');
  assert.equal(overview.chapters[0].orderNumber, 1);
  assert.equal(overview.chapters[0].isComplete, true);
  assert.equal(overview.chapters[1].chapter.id, 'ch-2');
  assert.equal(overview.chapters[1].orderNumber, 2);
  assert.equal(overview.chapters[1].completedSections, 2);
  assert.equal(overview.totalSections, 5);
  assert.equal(overview.completedSections, 4);

  const src: Source = {
    id: 'src-1',
    deckId: 'deck-1',
    kind: 'book',
    title: '2001: A Space Odyssey',
    createdAt: '2026-11-26T08:00:00.000Z',
    updatedAt: '2026-11-26T08:00:00.000Z',
  };
  const updated = withSavedAudioPosition(src, 'ch-2', 1, 3, '2026-11-27T09:00:00.000Z');
  assert.ok(updated);
  assert.deepEqual(updated!.audioPosition, {
    chapterId: 'ch-2',
    chunk: 1,
    pieceIndex: 3,
    updatedAt: '2026-11-27T09:00:00.000Z',
  });
  assert.equal(withSavedAudioPosition(updated!, 'ch-2', 1, 3, '2026-11-27T09:05:00.000Z'), null);

  // If visual reading updates `src.updatedAt` later on another device, `mergeRow` still keeps the newer `audioPosition`.
  const cloudCopy: Source = {
    ...updated!,
    reading: { '2026-11-27': { ms: 120_000, words: 250, sections: 1 } },
  };
  const clientReadingOnly: Source = {
    ...src,
    position: { chapterId: 'ch-1', chunk: 0 },
    reading: { '2026-11-27': { ms: 180_000, words: 400, sections: 2 } },
    updatedAt: '2026-11-27T10:00:00.000Z',
  };
  const merged = mergeRow('sources', cloudCopy, clientReadingOnly) as Source;
  assert.deepEqual(merged.audioPosition, updated!.audioPosition);
  assert.equal(merged.reading?.['2026-11-27']?.ms, 180_000);
});

test('speechKey normalizes whitespace and sectionPiecesForVoice shares exact AI piece boundaries', async () => {
  assert.equal(normalizeSpeechText('  Hello   world.\n\nNext   line! '), 'Hello world. Next line!');
  const keyA = await speechKey('openrouter', 'hexgrad/kokoro-82m', 'af_jessica', 'Hello   world.\nNext line!');
  const keyB = await speechKey('openrouter', 'hexgrad/kokoro-82m', 'af_jessica', '  Hello world. Next line!  ');
  assert.equal(keyA, keyB, 'whitespace differences produce identical speech cache keys');

  const sample = Array.from({ length: 12 }, (_, i) =>
    `Sentence number ${i + 1} explores the silent orbit around Jupiter with steady calm.`,
  ).join(' ');
  const section = readerSection(sample);
  const aiPieces = sectionPiecesForVoice(section, 'ai');
  const expectedAiPieces = piecesOf(section, AI_PIECE_WORDS, AI_FIRST_PIECE_WORDS);
  assert.deepEqual(aiPieces, expectedAiPieces);
  const devicePieces = sectionPiecesForVoice(section, 'device');
  assert.ok(devicePieces.length > aiPieces.length, 'AI mode groups sentences into 35/90-word chunks while device mode goes sentence by sentence');
});

test('canSpeakPersianInDrive prevents feeding Persian text to English-only voices', () => {
  assert.equal(canSpeakPersianInDrive('device', {}, false), false);
  assert.equal(canSpeakPersianInDrive('device', {}, true), true);
  assert.equal(canSpeakPersianInDrive('ai', { aiSpeechProvider: 'gemini' }, false), true);
  assert.equal(canSpeakPersianInDrive('ai', { aiSpeechProvider: 'openrouter' }, false), false);
});

test('buildCardAudioScript speaks Persian when supported and falls back to English definition otherwise', () => {
  const card = makeCard();

  const withFa = buildCardAudioScript(card, undefined, { pauseSeconds: 5, canSpeakPersian: true });
  assert.deepEqual(
    withFa.map(s => `${s.kind}:${s.phase}`),
    ['en:listen', 'en:listen', 'pause:think', 'fa:meaning', 'en:repeat'],
  );
  assert.equal(withFa[2].kind === 'pause' ? withFa[2].ms : 0, 5000);
  assert.equal(withFa[3].kind === 'fa' ? withFa[3].text : '', 'سایبان درختان جنگل');

  const withoutFa = buildCardAudioScript(card, undefined, { pauseSeconds: 3, canSpeakPersian: false });
  assert.deepEqual(
    withoutFa.map(s => `${s.kind}:${s.phase}`),
    ['en:listen', 'en:listen', 'pause:think', 'en-def:meaning', 'en:repeat'],
  );
  assert.equal(withoutFa[3].kind === 'en-def' ? withoutFa[3].text : '', 'the upper layer of forest trees');
});

test('drivingBookmarksOf and bookmarkCandidateWords filter drive notes and candidate words', () => {
  const notes: TextNote[] = [
    {
      id: 'n1',
      sourceId: 'src-1',
      chapterId: 'ch-1',
      chunk: 0,
      kind: 'comment',
      from: 0,
      to: 5,
      quote: 'Sunlight filtered through the dense canopy.',
      text: 'نشان رانندگی',
      by: DRIVE_NOTE_BY,
      createdAt: '2026-11-26T09:00:00.000Z',
      updatedAt: '2026-11-26T09:00:00.000Z',
    },
    {
      id: 'n2',
      sourceId: 'src-1',
      chapterId: 'ch-1',
      chunk: 0,
      kind: 'comment',
      from: 0,
      to: 3,
      quote: 'Regular reader comment',
      text: 'یادداشت معمولی',
      createdAt: '2026-11-26T10:00:00.000Z',
      updatedAt: '2026-11-26T10:00:00.000Z',
    },
  ];

  const driveNotes = drivingBookmarksOf(notes);
  assert.equal(driveNotes.length, 1);
  assert.equal(driveNotes[0].id, 'n1');

  const words = bookmarkCandidateWords(
    driveNotes[0].quote,
    [makeCard()],
    new Set(['sunlight']),
  );
  assert.deepEqual(
    words.map(w => ({ word: w.normalized, hasCard: Boolean(w.existingCard) })),
    [
      { word: 'filtered', hasCard: false },
      { word: 'dense', hasCard: false },
      { word: 'canopy', hasCard: true },
    ],
  );
});
