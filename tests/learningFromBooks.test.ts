import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookQuiz } from '../services/bookQuiz';
import { dueForecast, retention, vocabulary } from '../services/memoryStats';
import { calculateSrs } from '../services/srsService';
import type { CardPlace } from '../services/library';
import type { Flashcard, StudyLog } from '../types';

const NOW = new Date('2026-11-21T10:00:00');
const DAY = 86_400_000;
const card = (id: string, front: string, extra: Partial<Flashcard> = {}): Flashcard => ({
  id, deckId: 'd', front, back: `م ${front}`, createdAt: NOW.toISOString(), repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: NOW.toISOString(), ...extra,
});
const learning = (id: string, front: string) => calculateSrs(card(id, front), 'GOOD', new Date(NOW.getTime() - 5 * DAY));
const place = (sentence: string): CardPlace => ({ sourceId: 's', sourceTitle: 'Book', sentence });

test('the quiz asks words being learned in their book sentences, with three of your other words as choices', () => {
  const cards = [learning('a', 'harbor'), learning('b', 'pier'), learning('c', 'stripe'), learning('d', 'boat'), card('n', 'gull')];
  const places = new Map([['a', [place('He walked slowly to the harbor every morning.')]], ['n', [place('A gull cried above the water today.')]]]);
  const quiz = bookQuiz(cards, places, { count: 5, random: () => 0.3 });
  assert.equal(quiz.length, 1, 'only cards met in a book, and not new ones');
  const q = quiz[0];
  assert.equal(q.cardId, 'a');
  assert.equal(q.correctAnswer, 'harbor');
  assert.match(q.questionText, /to the _____ every/);
  assert.equal(q.options.length, 4);
  assert.ok(q.options.includes('harbor'));
  assert.ok(!q.options.includes('gull') || q.options.filter(o => o === 'gull').length === 1);
});

test('mixed quiz rotates across gap, word-to-meaning, audio and meaning while mapping Persian options back to English headwords', () => {
  const cards = [
    learning('a', 'harbor'),
    learning('b', 'pier'),
    learning('c', 'stripe'),
    learning('d', 'anchor'),
    learning('e', 'vessel'),
    learning('f', 'beacon'),
  ];
  const places = new Map([
    ['a', [place('He walked slowly to the harbor every morning.')]],
    ['b', [place('She waited quietly on the wooden pier at dusk.')]],
    ['c', [place('A narrow blue stripe ran along the hull.')]],
    ['d', [place('They dropped the heavy anchor near the bay.')]],
  ]);
  const quiz = bookQuiz(cards, places, { count: 6, mix: true, canSpeak: true, random: () => 0.25 });
  assert.equal(quiz.length, 6, 'includes cards with and without book sentences when mixed');
  const asks = new Set(quiz.map(q => q.ask));
  assert.ok(asks.size >= 3, 'rotates across multiple question styles');
  for (const q of quiz) {
    assert.equal(new Set(q.options).size, 4, 'four distinct choices');
    if (q.ask === 'word-to-meaning' || q.ask === 'audio') {
      assert.equal(q.correctAnswer, `م ${q.targetWord}`);
      for (const opt of q.options) {
        assert.ok(cards.some(c => c.front === q.optionWords[opt]), 'optionWords maps Persian meaning back to English word');
      }
    } else {
      assert.equal(q.correctAnswer, q.targetWord);
      assert.equal(q.optionWords[q.correctAnswer], q.targetWord);
    }
  }
});

test('a targeted quiz of "still hard" cards includes brand-new cards even without book sentences', () => {
  const cards = [card('n1', 'glimpse'), card('n2', 'murmur'), learning('b', 'pier'), learning('c', 'stripe'), learning('d', 'boat')];
  const quiz = bookQuiz(cards, new Map(), { only: new Set(['n1', 'n2']), count: 5, random: () => 0.4 });
  assert.equal(quiz.length, 2);
  assert.deepEqual(new Set(quiz.map(q => q.cardId)), new Set(['n1', 'n2']));
  assert.ok(quiz.every(q => q.ask === 'meaning'));
});

test('retention counts the first answer of each card a day, not a card seen for the first time', () => {
  const logs: StudyLog[] = [
    { cardId: 'a', date: '2026-11-01', rating: 'GOOD' }, // first ever: not counted
    { cardId: 'a', date: '2026-11-05', rating: 'AGAIN' },
    { cardId: 'a', date: '2026-11-05', rating: 'GOOD' }, // same day: not counted
    { cardId: 'a', date: '2026-11-10', rating: 'GOOD' },
    { cardId: 'b', date: '2026-11-20', rating: 'HARD' }, // first ever
    { cardId: 'c', date: '2026-09-01', rating: 'GOOD' },
    { cardId: 'c', date: '2026-09-10', rating: 'AGAIN' }, // older than 30 days
  ];
  assert.deepEqual(retention(logs, '2026-11-21'), { reviews: 2, remembered: 1, percent: 50 });
  assert.equal(retention([], '2026-11-21').percent, null);
});

test('the forecast puts every overdue card on today and the rest on their days', () => {
  const cards = [
    card('a', 'a', { dueDate: new Date(NOW.getTime() - 3 * DAY).toISOString() }),
    card('b', 'b', { dueDate: NOW.toISOString() }),
    card('c', 'c', { dueDate: new Date(NOW.getTime() + 2 * DAY).toISOString() }),
    card('d', 'd', { dueDate: new Date(NOW.getTime() + 20 * DAY).toISOString() }),
    card('e', 'e', { dueDate: NOW.toISOString(), isDeleted: true }),
  ];
  const f = dueForecast(cards, NOW);
  assert.equal(f.length, 7);
  assert.equal(f[0].count, 2);
  assert.equal(f[2].count, 1);
  assert.equal(f.reduce((n, d) => n + d.count, 0), 3);
});

test('the words you know are grown cards and the «بلدم» list, each once', () => {
  const grown = { ...card('g', 'Harbor'), stability: 30, difficulty: 5, repetition: 3, interval: 30, lastReviewed: NOW.toISOString() };
  const v = vocabulary([grown, learning('l', 'pier'), card('n', 'gull')], [
    { id: 'k1', term: 'harbor', createdAt: '', updatedAt: '' },
    { id: 'k2', term: 'the', createdAt: '', updatedAt: '' },
    { id: 'k3', term: 'gone', createdAt: '', updatedAt: '', isDeleted: true },
  ]);
  assert.deepEqual(v, { known: 2, fromCards: 1, fromList: 1, learning: 1 });
});
