import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertToCSV, parseCollocations, parseCSV, splitList } from '../services/csvService';
import { Deck, Flashcard } from '../types';

const deck: Deck = { id: 'd1', name: 'Book, one' };
const card = (extra: Partial<Flashcard>): Flashcard => ({
  id: 'c1', deckId: 'd1', front: 'cope', back: 'کنار آمدن', repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: '', createdAt: '', ...extra,
});

test('an export imports back with every field, including empty ones and Persian text', () => {
  const csv = '﻿' + convertToCSV([
    card({ notes: '', definition: ['deal with', 'manage'], sourceSentence: 'He said, "I can\'t cope."\nThen left.', kind: 'word',
      collocations: [{ phrase: 'cope with', meaning: 'از پس برآمدن' }, { phrase: 'cope well' }] }),
    card({ front: 'had + past participle', back: 'ماضی بعید', kind: 'grammar', grammarPattern: 'had + p.p.', practicePrompt: 'یک جمله بنویس' }),
  ], [deck]);
  const rows = parseCSV(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].front, 'cope');
  assert.equal(rows[0].deckName, 'Book, one');
  assert.equal(rows[0].notes, '');
  assert.equal(rows[0].sourceSentence, 'He said, "I can\'t cope."\nThen left.');
  assert.deepEqual(splitList(rows[0].definition), ['deal with', 'manage']);
  assert.deepEqual(parseCollocations(rows[0].collocations), [{ phrase: 'cope with', meaning: 'از پس برآمدن' }, { phrase: 'cope well' }]);
  assert.equal(rows[1].kind, 'grammar');
  assert.equal(rows[1].practicePrompt, 'یک جمله بنویس');
});

test('parseCSV reads older eight-column files and skips blank lines', () => {
  const rows = parseCSV('front,back,deckName,pronunciation,partOfSpeech,definition,exampleSentenceTarget,notes\r\nthrive,شکوفا شدن,Deck,,v.,,,\r\n\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].back, 'شکوفا شدن');
  assert.equal(rows[0].pronunciation, '');
  assert.equal(rows[0].partOfSpeech, 'v.');
  assert.deepEqual(splitList(rows[0].definition), []);
});
