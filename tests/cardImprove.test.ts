import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImprovePrompt, fieldsToAsk, improveBatch, improveCandidates, improveRequestCount, parseImproveReply,
} from '../services/cardImprove';
import { applyProposal } from '../services/cardRefresh';
import type { Flashcard } from '../types';

const T0 = new Date('2026-10-11T06:00:00Z');

const card = (over: Partial<Flashcard> = {}): Flashcard => ({
  id: 'c1', deckId: 'd', front: 'reluctant', back: 'بی‌میل', repetition: 0, easinessFactor: 2.5, interval: 0,
  dueDate: T0.toISOString(), createdAt: T0.toISOString(), updatedAt: T0.toISOString(), ...over,
} as Flashcard);

const origin = { by: 'ai' as const, provider: 'Gemini', at: T0.toISOString() };

test('only empty parts are asked unless filled ones are to be rewritten too', () => {
  const c = card({ notes: 'یادداشت', exampleSentenceTarget: [] });
  assert.deepEqual(fieldsToAsk(c, ['back', 'notes', 'exampleSentenceTarget'], 'empty'), ['exampleSentenceTarget']);
  assert.deepEqual(fieldsToAsk(c, ['back', 'notes'], 'all'), ['back', 'notes']);
});

test('grammar, deleted and already complete cards are left out', () => {
  const cards = [
    card({ id: 'a' }),
    card({ id: 'b', kind: 'grammar' }),
    card({ id: 'c', isDeleted: true }),
    card({ id: 'd', notes: 'x' }),
  ];
  assert.deepEqual(improveCandidates(cards, ['notes'], 'empty').map(c => c.id), ['a']);
  assert.deepEqual(improveCandidates(cards, ['notes'], 'all').map(c => c.id), ['a', 'd']);
  assert.deepEqual(improveCandidates(cards, [], 'all'), []);
});

test('the request count follows the batch size', () => {
  assert.equal(improveRequestCount(25, 'empty', ['notes']), 3);
  assert.equal(improveRequestCount(25, 'all', ['notes']), 5);
  assert.equal(improveRequestCount(25, 'all', ['back', 'notes', 'definition', 'exampleSentenceTarget', 'collocations', 'synonyms', 'register']), 7);
});

test('the prompt asks each card only for its own parts and shows current values when rewriting', () => {
  const cards = [card({ notes: 'یادداشت قدیمی', sourceSentence: 'He was reluctant.' }), card({ id: 'c2', front: 'decide', back: '' })];
  const empty = buildImprovePrompt(cards, ['back', 'notes', 'synonyms'], 'empty');
  assert.match(empty, /1\. term: "reluctant" \(Persian meaning on the card: "بی‌میل"\)\n   sentence: "He was reluctant\."\n   give: synonyms/);
  assert.match(empty, /2\. term: "decide"\n   give: translation, notes, synonyms/);
  assert.match(empty, /"synonyms": up to 3/);
  assert.doesNotMatch(empty, /"commonMistake"/);
  assert.doesNotMatch(empty, /now /);
  const all = buildImprovePrompt(cards, ['back', 'notes'], 'all');
  assert.match(all, /now translation: "بی‌میل"/);
  assert.match(all, /now notes: "یادداشت قدیمی"/);
  assert.match(all, /return it unchanged/);
});

test('the reply keeps only asked parts that differ from the card', () => {
  const cards = [card({ notes: 'همان' }), card({ id: 'c2', front: 'decide', back: '' })];
  const found = parseImproveReply({ cards: [
    { index: 2, translation: 'تصمیم گرفتن', notes: 'یادداشت', pronunciation: '/dɪˈsaɪd/' },
    { index: 1, translation: 'بی‌میل', notes: 'همان', synonyms: [{ word: 'unwilling' }] },
  ] }, cards, ['back', 'notes', 'synonyms'], 'empty', origin);
  // Card 1: only synonyms were empty; card 2: meaning and note.
  assert.deepEqual(found.map(f => [f.card.id, f.changes.map(c => c.field)]), [['c2', ['back', 'notes']], ['c1', ['synonyms']]]);
  assert.equal(found[0].proposal.pronunciation, undefined);
  assert.throws(() => parseImproveReply('x', cards, ['back'], 'empty', origin));
});

test('improving asks only the chosen service and the kept meaning records it', async () => {
  const asked: unknown[] = [];
  const found = await improveBatch([card()], ['back'], 'all', {
    aiProvider: 'gemini', model: 'gemini-2.5-flash', fallbacks: [{ aiProvider: 'openai-compatible', model: 'x' }],
  }, async fields => {
    asked.push(fields.model);
    return { text: '{"cards":[{"index":1,"translation":"بی‌رغبت"}]}' };
  });
  assert.deepEqual(asked, ['gemini-2.5-flash']);
  const next = applyProposal(card(), found[0].proposal, ['back']);
  assert.equal(next.back, 'بی‌رغبت');
  assert.equal(next.origin?.by, 'ai');
});
