import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstLines, lastLinesOf, nextReading, readingInvite, readOn } from '../services/readingInvite';
import type { Chapter, Source } from '../types';

const source = (extra: Partial<Source> = {}): Source => ({ id: 's', kind: 'book', title: 'Book', deckId: 'd', createdAt: '', updatedAt: '2026-11-20', ...extra } as Source);
const chapter = (id: string, order: number, completed: number[], chunkCount = 2): Chapter =>
  ({ id, sourceId: 's', title: `Chapter ${order}`, order, chunkCount, wordCount: 600, completed, createdAt: '', updatedAt: '' } as Chapter);

test('the first lines are whole sentences up to a length; a very long sentence is cut', () => {
  assert.equal(firstLines('One. Two three. Four five six seven.', 4), 'One. Two three.');
  assert.equal(firstLines('  A  short\n\ntext.  '), 'A short text.');
  const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ') + '.';
  assert.match(firstLines(long, 10), /^w0 w1 .* w9 …$/);
});

test('the last lines are the closing sentences', () => {
  assert.equal(lastLinesOf('First one here. Second one. The very last sentence.', 6), 'Second one. The very last sentence.');
});

test('the invitation: the next section, where we were, and minutes at the reader\'s pace', () => {
  const next = nextReading([source()], [chapter('c1', 1, [0])])!;
  assert.equal(next.chunk, 1);
  const invite = readingInvite(next, ['He lit the lamp. The wind rose.', 'A boat appeared. Nobody was expected.'])!;
  assert.equal(invite.section, 2);
  assert.equal(invite.sections, 2);
  assert.equal(invite.teaser, 'A boat appeared. Nobody was expected.');
  assert.equal(invite.before, 'He lit the lamp. The wind rose.');
  assert.equal(invite.chapterTitle, undefined, 'one chapter: the book\'s title is enough');
  assert.ok(invite.minutes >= 1);
});

test('the first section of a chapter looks back at the end of the chapter before', () => {
  const next = nextReading([source()], [chapter('c1', 1, [0, 1]), chapter('c2', 2, [])])!;
  assert.equal(next.chapter.id, 'c2');
  assert.equal(next.previous?.id, 'c1');
  const invite = readingInvite(next, ['Chapter two begins.', 'More.'], ['Old one.', 'Chapter one ends here.'])!;
  assert.equal(invite.before, 'Chapter one ends here.');
  assert.equal(invite.chapterTitle, 'Chapter 2');
  assert.equal(readingInvite(next, ['', 'x']), null, 'an emptied section has nothing to show');
});

test('a finished book invites to nothing; a day counts as read once a section was finished', () => {
  assert.equal(nextReading([source()], [chapter('c1', 1, [0, 1])]), null);
  assert.equal(readOn([source({ reading: { '2026-11-21': { ms: 1, words: 1, sections: 1 } } })], '2026-11-21'), true);
  assert.equal(readOn([source({ reading: { '2026-11-21': { ms: 60000, words: 90, sections: 0 } } })], '2026-11-21'), false);
});
