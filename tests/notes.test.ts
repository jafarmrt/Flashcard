import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateNote, newNote, notesAtWords, notesInOrder, notesOfSection, savedTranslation } from '../services/notes';
import { readerSection } from '../services/readerText';
import { cleanEditedText } from '../services/library';
import { pageOfOffset, pageLayout } from '../components/reader/BookPages';

const T = new Date('2026-10-16T10:00:00Z');
const text = 'It was a cold day. She was reluctant to leave the house.\n\nNobody knew what had happened to the letters.';
const section = readerSection(text);
const note = (over: Partial<Parameters<typeof newNote>[0]> = {}, id = 'n1') =>
  newNote({ sourceId: 's', chapterId: 'c', chunk: 0, kind: 'comment', from: 7, to: 8, quote: 'reluctant to', text: ' my note ', ...over }, T, id);

test('a note keeps its passage and text, trimmed, from first to last word', () => {
  const n = note({ from: 8, to: 7, by: 'Gemini' });
  assert.deepEqual([n.from, n.to, n.text, n.by, n.createdAt], [7, 8, 'my note', 'Gemini', T.toISOString()]);
});

test('a note is found where it was made, or by its words after the text was edited', () => {
  assert.deepEqual(locateNote(section, note()), { from: 7, to: 8 });
  const edited = readerSection('A new first sentence here. It was a cold day. She was reluctant to leave the house.');
  assert.deepEqual(locateNote(edited, note()), { from: 12, to: 13 }, 'moved by the five words added before it');
  assert.equal(locateNote(readerSection('Nothing of it is left.'), note()), null, 'its words were cut out');
  const twice = readerSection('reluctant to go. reluctant to stay. reluctant to leave.');
  assert.deepEqual(locateNote(twice, { ...note(), from: 6, to: 7 }), { from: 6, to: 7 }, 'the same words: the nearest place');
});

test('the notes of a section, per word, and the translation kept for a passage', () => {
  const list = [
    note(),
    note({ kind: 'translation', from: 9, to: 19, quote: 'leave the house. Nobody knew what had happened to the letters', text: 'ترجمه' }, 'n2'),
    note({ chunk: 1 }, 'other-section'),
    { ...note({}, 'gone'), isDeleted: true },
  ];
  const placed = notesOfSection(section, list, 'c', 0);
  assert.deepEqual(placed.map(p => p.note.id), ['n1', 'n2']);
  const at = notesAtWords(section.words.length, placed);
  assert.deepEqual(at[7].map(n => n.id), ['n1']);
  assert.deepEqual(at[10].map(n => n.id), ['n2']);
  assert.deepEqual(at[0], []);
  assert.equal(savedTranslation(placed, { from: 9, to: 19 })?.text, 'ترجمه');
  assert.equal(savedTranslation(placed, { from: 7, to: 8 }), undefined, 'a comment is not a translation');
  const order = new Map([['c', 1], ['c0', 0]]);
  assert.deepEqual(notesInOrder([note({ chunk: 2 }, 'b'), note({ chapterId: 'c0' }, 'a'), note({ from: 1, to: 1, quote: 'was' }, 'c1')], order).map(n => n.id), ['a', 'c1', 'b']);
});

test('an edited section: one blank line between paragraphs, no stray spaces', () => {
  assert.equal(cleanEditedText('  First   line.\r\nstill first.  \r\n\r\n\r\n\r\n  Second.  \n\n   \n'), 'First line.\nstill first.\n\nSecond.');
  assert.equal(cleanEditedText('   \n\n  '), '', 'a section can be emptied');
});

test('pages: one page on a phone, two facing pages on a wide screen; a word a little before its column stays on its page', () => {
  assert.deepEqual(pageLayout(390, 700), { width: 390, height: 700, spread: 1, roomWidth: 390 });
  assert.equal(pageLayout(800, 700).width, 700, 'one page is no wider than a book page');
  assert.equal(pageLayout(1300, 700).spread, 2);
  assert.equal(pageOfOffset(0, 350), 0);
  assert.equal(pageOfOffset(412, 350), 1, 'two pixels before the second page (the word\'s own margin)');
  assert.equal(pageOfOffset(349, 350), 0);
  assert.equal(pageOfOffset(828, 350), 2);
});
