import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glossesFor, shortMeaning } from '../services/gloss';
import { indexCards } from '../services/cardLookup';
import type { Flashcard } from '../types';

const card = (id: string, front: string, back: string, over: Partial<Flashcard> = {}): Flashcard => ({
  id, deckId: 'd', front, back, repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: 'x', createdAt: 'x', ...over,
} as Flashcard);

test('a gloss is the first short sense of the meaning', () => {
  assert.equal(shortMeaning('بی‌میل، اکراه‌دار (به کاری)'), 'بی‌میل');
  assert.equal(shortMeaning('(فعل) تصمیم گرفتن; قصد کردن'), 'تصمیم گرفتن');
  assert.equal(shortMeaning('یک معنی بسیار بسیار طولانی برای واژه'), 'یک معنی بسیار بسی…');
});

test('new cards get a gloss at their first place in the section; learned and known words do not', () => {
  const index = indexCards([
    card('1', 'reluctant', 'بی‌میل'),
    card('2', 'house', 'خانه', { stability: 40, difficulty: 5, repetition: 6, interval: 40 }),
    card('3', 'decide', 'تصمیم گرفتن', { stability: 5, difficulty: 5, repetition: 2, interval: 5 }),
  ]);
  const words = ['She', 'was', 'reluctant', 'to', 'decide', 'the', 'house', 'reluctant'].map((text, i) => ({ i, text }));
  const g = glossesFor(words, index, 'new', () => false);
  assert.equal(g[2], 'بی‌میل');
  assert.equal(g[7], undefined, 'once per section');
  assert.equal(g[4], undefined, 'stage 2 is past "new"');
  assert.equal(g[6], undefined);
  assert.equal(glossesFor(words, index, 'learning', () => false)[4], 'تصمیم گرفتن');
  assert.equal(glossesFor(words, index, 'new', w => w === 'reluctant')[2], undefined);
  assert.deepEqual(glossesFor(words, index, 'off', () => false).filter(Boolean), []);
});
