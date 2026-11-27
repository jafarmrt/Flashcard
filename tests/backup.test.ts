import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupDue, BackupData, BackupError, chapterNeedsRemoteText, makeBackup, planRestore, readBackup } from '../services/backup';

const T = '2026-11-01T00:00:00.000Z';
const NOW = new Date('2026-11-21T10:00:00.000Z');
const empty = (): BackupData => ({ decks: [], cards: [], sources: [], chapters: [], occurrences: [], knownWords: [], speechAttempts: [], notes: [], practice: [], themeExercises: [], studyLessons: [], studyHistory: [], chapterTexts: [] });
const account = (): BackupData => ({
  ...empty(),
  decks: [{ id: 'd1', name: 'Book', updatedAt: T } as any],
  cards: [
    { id: 'c1', deckId: 'd1', front: 'abate', back: 'کاهش', createdAt: T, updatedAt: T, repetition: 2, easinessFactor: 2.5, interval: 9, dueDate: T, stability: 9 } as any,
    { id: 'c2', deckId: 'd1', front: 'gone', back: 'رفته', createdAt: T, updatedAt: T, repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: T, isDeleted: true } as any,
  ],
  sources: [{ id: 's1', kind: 'book', title: 'Book', deckId: 'd1', createdAt: T, updatedAt: T, position: { chapterId: 'ch1', chunk: 2 } } as any],
  chapters: [{ id: 'ch1', sourceId: 's1', title: 'One', order: 0, chunkCount: 3, wordCount: 900, completed: [0, 1], createdAt: T, updatedAt: T } as any],
  occurrences: [{ id: 'o1', cardId: 'c1', sourceId: 's1', chapterId: 'ch1', chunk: 0, sentence: 'It abated.', updatedAt: T } as any],
  notes: [{ id: 'n1', sourceId: 's1', chapterId: 'ch1', chunk: 0, from: 0, to: 1, quote: 'It', text: 'note', kind: 'note', updatedAt: T } as any],
  studyLessons: [{
    id: 'l1', day: '2026-11-02', durationMinutes: 30, titleFa: 'آموزش ۳۰ دقیقه‌ای', status: 'completed',
    currentStageIndex: 0, cardIds: ['c1'], words: [{ cardId: 'c1', front: 'abate', back: 'کاهش' }],
    stages: [{ id: 'review-1', kind: 'review', titleFa: 'مرور', subtitleFa: '', estimatedMinutes: 14, cardIds: ['c1'], targetCount: 1, completed: true }],
    reviewedCount: 1, quizRight: 0, quizTotal: 0, clozeRight: 0, clozeTotal: 0, hardCardIds: ['c1'], elapsedSeconds: 300,
    startedAt: T, createdAt: T, updatedAt: T,
  }],
  studyHistory: [{ id: 7, uid: 'u1', cardId: 'c1', date: '2026-11-02', rating: 'GOOD' }],
  chapterTexts: [{ id: 'ch1', sourceId: 's1', chunks: ['It abated.'], uploaded: true }],
});

test('a backup holds every live row, the review history and the chapter texts, and reads back', () => {
  const backup = makeBackup(account(), '7.13.0', NOW);
  assert.equal(backup.data.cards.length, 1, 'deleted rows are left out');
  assert.equal(backup.data.cards[0].stability, 9, 'with the schedule');
  assert.equal((backup.data.studyHistory[0] as any).id, undefined, 'without device-local ids');
  assert.equal((backup.data.chapterTexts[0] as any).uploaded, undefined);
  const back = readBackup(JSON.stringify(backup));
  assert.deepEqual(back.data, backup.data);
});

test('a file that is not a backup is refused with a reason', () => {
  assert.throws(() => readBackup('not json'), BackupError);
  assert.throws(() => readBackup('{"app":"other"}'), BackupError);
  assert.throws(() => readBackup(JSON.stringify({ app: 'lingua-cards', format: 99, data: {} })), /تازه‌تری/);
});

test('restoring into an empty browser brings everything back under the same ids', () => {
  const backup = makeBackup(account(), '7.13.0', NOW);
  const plan = planRestore(backup, empty(), () => 'new', NOW);
  assert.equal(plan.rows.cards[0].id, 'c1');
  assert.equal(plan.rows.cards[0].updatedAt, NOW.toISOString(), 'stamped so the next sync sends it');
  assert.equal(plan.counts.cards, 1);
  assert.equal(plan.counts.studyHistory, 1);
  assert.equal(plan.chapterTexts[0].uploaded, false);
});

test('restoring keeps rows that are here; rows deleted here come back under new ids with their references', () => {
  const backup = makeBackup(account(), '7.13.0', NOW);
  const local = account();
  local.cards = local.cards.map(c => (c.id === 'c1' ? { ...c, isDeleted: true } : c));
  local.chapters = local.chapters.map(c => ({ ...c, isDeleted: true }));
  local.studyLessons = local.studyLessons.map(l => ({ ...l, isDeleted: true }));
  let n = 0;
  const plan = planRestore(backup, local, () => `x${++n}`, NOW);
  assert.equal(plan.rows.decks.length, 0, 'the deck is here and stays as it is');
  assert.equal(plan.rows.sources.length, 0);
  const card = plan.rows.cards[0];
  assert.notEqual(card.id, 'c1');
  assert.equal(card.deckId, 'd1', 'a reference to a row that stayed is kept');
  const chapter = plan.rows.chapters[0];
  assert.notEqual(chapter.id, 'ch1');
  assert.equal(plan.rows.occurrences.length, 1, 'the place the card was met, still here, now points to it');
  assert.equal(plan.rows.occurrences[0].id, 'o1');
  assert.equal(plan.rows.occurrences[0].cardId, card.id);
  assert.equal(plan.rows.occurrences[0].chapterId, chapter.id);
  assert.equal(plan.rows.studyLessons.length, 1);
  assert.deepEqual(plan.rows.studyLessons[0].cardIds, [card.id], 'studyLessons remap recreated card ids');
  assert.deepEqual(plan.rows.studyLessons[0].hardCardIds, [card.id]);
  assert.equal(plan.rows.studyLessons[0].words[0].cardId, card.id);
  assert.equal(plan.studyHistory[0].cardId, card.id, 'the history follows the card');
  assert.notEqual(plan.studyHistory[0].uid, 'u1');
  assert.equal(plan.chapterTexts[0].id, chapter.id, 'the text follows its chapter');
});

test('restoring twice adds nothing the second time', () => {
  const backup = makeBackup(account(), '7.13.0', NOW);
  const plan = planRestore(backup, account(), () => 'new', NOW);
  assert.deepEqual(Object.values(plan.counts).reduce((a, b) => a + b, 0), 0);
  assert.equal(plan.chapterTexts.length, 0);
});

test('chapterNeedsRemoteText spots missing or older edited chapter texts and ignores deleted or fresh ones', () => {
  const ch = { id: 'ch1', textEditedAt: '2026-11-10T00:00:00.000Z' };
  assert.equal(chapterNeedsRemoteText(ch, undefined), true, 'missing local copy');
  assert.equal(chapterNeedsRemoteText(ch, { editedAt: '2026-11-05T00:00:00.000Z' }), true, 'local copy predates remote edit');
  assert.equal(chapterNeedsRemoteText(ch, { editedAt: '2026-11-10T00:00:00.000Z' }), false, 'up to date');
  assert.equal(chapterNeedsRemoteText({ ...ch, isDeleted: true }, undefined), false, 'deleted chapter');
});

test('restoring a backup with a newer edited chapter text updates the text and edit stamp while keeping reading progress', () => {
  const newerAt = '2026-11-15T12:00:00.000Z';
  const fileData = account();
  fileData.chapters = [{ ...fileData.chapters[0], textEditedAt: newerAt, wordCount: 950 } as any];
  fileData.chapterTexts = [{ id: 'ch1', sourceId: 's1', chunks: ['It abated quickly.'], editedAt: newerAt, uploaded: true }];
  const backup = makeBackup(fileData, '7.21.0', NOW);

  const local = account();
  local.chapters = [{ ...local.chapters[0], completed: [0, 1, 2], textEditedAt: '2026-11-02T00:00:00.000Z' } as any];
  local.chapterTexts = [{ id: 'ch1', sourceId: 's1', chunks: ['It abated.'], editedAt: '2026-11-02T00:00:00.000Z', uploaded: true }];

  const plan = planRestore(backup, local, () => 'new', NOW);
  assert.equal(plan.chapterTexts.length, 1);
  assert.deepEqual(plan.chapterTexts[0].chunks, ['It abated quickly.']);
  assert.equal(plan.chapterTexts[0].editedAt, newerAt);
  assert.equal(plan.chapterTexts[0].uploaded, false);
  assert.equal(plan.rows.chapters.length, 1);
  assert.equal(plan.rows.chapters[0].textEditedAt, newerAt);
  assert.equal(plan.rows.chapters[0].wordCount, 950);
  assert.deepEqual(plan.rows.chapters[0].completed, [0, 1, 2], 'local reading progress stays intact');

  // Restoring again once the newer edit is already here does nothing.
  local.chapters = [plan.rows.chapters[0] as any];
  local.chapterTexts = [plan.chapterTexts[0]];
  const second = planRestore(backup, local, () => 'new', NOW);
  assert.equal(second.chapterTexts.length, 0);
  assert.equal(second.rows.chapters.length, 0);
});

test('a backup is asked for once there is something to lose, and again after a month', () => {
  assert.equal(backupDue(null, 5), false, 'a handful of cards: not yet');
  assert.equal(backupDue(null, 40), true, 'never backed up');
  assert.equal(backupDue(10, 40), false);
  assert.equal(backupDue(30, 40), true);
});
