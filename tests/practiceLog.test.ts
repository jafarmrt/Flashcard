import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookQuiz } from '../services/bookQuiz';
import { mistakeSummary, newPracticeAnswer } from '../services/practiceLog';
import { buildWhyPrompt, explainChoice } from '../services/quizExplain';
import { calculateSrs } from '../services/srsService';
import type { CardPlace } from '../services/library';
import type { Flashcard, PracticeAnswer } from '../types';

const NOW = new Date('2026-11-23T10:00:00');
const card = (id: string, front: string, back = `معنی ${front}`): Flashcard => ({
  id, deckId: 'd', front, back, createdAt: NOW.toISOString(), repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: NOW.toISOString(),
});
const learning = (id: string, front: string) => calculateSrs(card(id, front), 'GOOD', new Date(NOW.getTime() - 5 * 86_400_000));
const place = (sentence: string): CardPlace => ({ sourceId: 's', sourceTitle: 'Book', sentence });
const answer = (cardId: string, right: boolean, day: string, chose?: string, n = 0): PracticeAnswer =>
  ({ ...newPracticeAnswer({ cardId, kind: 'quiz', right, chose }, new Date(`${day}T10:00:0${n}`), `${cardId}-${day}-${n}`) });

test('a word that stands in the sentence is never one of the choices; every choice carries its meaning', () => {
  const cards = [learning('t', 'telescope'), learning('c', 'curiosity'), learning('d', 'deliberate'), learning('s', 'surveyor'), learning('h', 'harbor')];
  const places = new Map([['t', [place('The keeper watched it through his telescope with mounting curiosity.')]]]);
  for (let seed = 0; seed < 20; seed++) {
    let n = seed;
    const [q] = bookQuiz(cards, places, { random: () => ((n = (n * 9301 + 49297) % 233280) / 233280) });
    assert.equal(q.correctAnswer, 'telescope');
    assert.ok(!q.options.includes('curiosity'), 'curiosity is in the sentence');
    assert.equal(q.options.length, 4);
    assert.equal(q.hint, 'معنی telescope');
    for (const o of q.options) assert.equal(q.meanings[o], `معنی ${o}`);
  }
});

test('a quiz of chosen cards asks a card without a book sentence from its meaning, new cards too', () => {
  const cards = [card('a', 'abate'), learning('b', 'pier'), learning('c', 'tide'), learning('d', 'gull')];
  const quiz = bookQuiz(cards, new Map(), { only: new Set(['a']), count: 5 });
  assert.equal(quiz.length, 1);
  assert.equal(quiz[0].ask, 'meaning');
  assert.equal(quiz[0].questionText, 'معنی abate');
  assert.equal(quiz[0].sourceSentence, '');
  assert.equal(bookQuiz(cards, new Map()).length, 0, 'the usual quiz needs book sentences');
  assert.equal(bookQuiz(cards.slice(0, 3), new Map(), { only: new Set(['a']) }).length, 0, 'fewer than four words: no quiz');
});

test('the mistakes: words answered wrong, what they were taken for, until two right answers in a row', () => {
  const cards = [card('a', 'affect', 'اثر گذاشتن'), card('e', 'effect', 'اثر'), card('p', 'pier'), card('x', 'gone')];
  cards[3].isDeleted = true;
  const log = [
    answer('a', false, '2026-11-20', 'effect'),
    answer('a', false, '2026-11-21', 'effect'),
    answer('a', true, '2026-11-22'),
    answer('p', false, '2026-11-10', 'tide'),
    answer('p', true, '2026-11-11'),
    answer('p', true, '2026-11-12'),
    answer('e', true, '2026-11-22'),
    answer('x', false, '2026-11-22', 'pier'),
    answer('a', false, '2026-01-01', 'pier'), // outside the window
  ];
  const s = mistakeSummary(log, cards, '2026-11-23');
  assert.deepEqual(s.words.map(w => w.card.front), ['affect'], 'pier was answered right twice since; the deleted card is left out');
  assert.equal(s.words[0].wrong, 2);
  assert.equal(s.words[0].total, 3);
  assert.deepEqual(s.words[0].takenFor, ['effect']);
  assert.deepEqual(s.confusions.map(c => [c.card.front, c.chose, c.choseBack, c.count]), [['affect', 'effect', 'اثر', 2]]);
  assert.equal(s.answers, 7);
  assert.equal(s.right, 4);
  assert.equal(mistakeSummary([], cards).answers, 0);
});

test('a practice answer keeps what was picked only when it was wrong', () => {
  const right = newPracticeAnswer({ cardId: 'a', kind: 'quiz', right: true, chose: 'x' }, NOW, 'id1');
  assert.equal(right.chose, undefined);
  assert.equal(right.day, '2026-11-23');
  const heard = newPracticeAnswer({ cardId: 'a', kind: 'listening', right: false, score: 61.6 }, NOW, 'id2');
  assert.equal(heard.score, 62);
});

test('«چرا؟» asks the AI about this sentence and these two words, and returns its line', async () => {
  const q = { questionText: 'He watched it through his _____.', correct: 'telescope', correctBack: 'تلسکوپ', chosen: 'deliberate', chosenBack: 'سنجیده' };
  const prompt = buildWhyPrompt(q);
  assert.match(prompt, /through his _____/);
  assert.match(prompt, /"telescope" \(their card says: تلسکوپ\)/);
  assert.match(prompt, /"deliberate" \(their card says: سنجیده\)/);
  const text = await explainChoice(q, undefined, async () => ({ text: '  telescope اسم است؛\n deliberate صفت.  ' }));
  assert.equal(text, 'telescope اسم است؛ deliberate صفت.');
  await assert.rejects(explainChoice(q, undefined, async () => ({ text: ' ' })));
});
