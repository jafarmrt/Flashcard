import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Flashcard, SpeechAttempt } from '../types';
import {
  attemptKey, cleanEvaluation, dailyScores, focusSounds, itemProgress, newAttempt, pronunciationPrompt,
  PRONUNCIATION_SCHEMA, SOUND_IDS, speechSummary, weakCardIds, weakSounds,
} from '../services/speechPractice';
import { syncFingerprint } from '../services/syncState';
import { nextOutgoing, freshSyncState, LocalData } from '../services/syncClient';

let n = 0;
const at = (day: number, hour = 10) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();
const attempt = (over: Partial<SpeechAttempt> & { score: number }): SpeechAttempt => ({
  id: `a${++n}`, cardId: 'c1', target: 'think', kind: 'word', feedback: '', issues: [],
  createdAt: at(1), updatedAt: at(1), ...over,
});

test('the AI answer is cleaned: whole score in 0-100, known sound ids, short texts', () => {
  const e = cleanEvaluation({
    score: 132.6, feedback: '  خوب بود  ', heard: 'tink', correction: '',
    issues: [
      { sound: 'TH-VOICELESS', word: 'think', detail: 'th را مثل ت گفتی' },
      { sound: 'made-up', detail: 'چیزی دیگر' },
      { sound: 'nonsense' },
      null,
      ...Array.from({ length: 10 }, () => ({ sound: 'stress', detail: 'x' })),
    ],
  });
  assert.equal(e.score, 100);
  assert.equal(e.feedback, 'خوب بود');
  assert.equal(e.heard, 'tink');
  assert.equal('correction' in e, false, 'an empty correction is left out');
  assert.deepEqual(e.issues[0], { sound: 'th-voiceless', word: 'think', detail: 'th را مثل ت گفتی' });
  assert.equal(e.issues[1].sound, 'other', 'an unknown id becomes "other"');
  assert.equal(e.issues.length, 6, 'at most six problems');
  assert.equal(cleanEvaluation({ score: 'x' }).score, 0);
  assert.deepEqual(cleanEvaluation(null).issues, []);
  assert.equal(cleanEvaluation({ score: -5 }).score, 0);
});

test('the prompt asks for the fixed sound ids and names his usual weak sounds', () => {
  const p = pronunciationPrompt('I think so', 'sentence', ['th-voiceless', 'bogus', 'w']);
  assert.match(p, /the sentence "I think so"/);
  assert.match(p, /often has trouble with: th-voiceless, w\./);
  assert.ok(!p.includes('bogus'));
  assert.ok(!pronunciationPrompt('cat', 'word').includes('often has trouble'));
  assert.deepEqual((PRONUNCIATION_SCHEMA.properties.issues.items.properties.sound as any).enum, SOUND_IDS);
});

test('weak sounds count once per try, most frequent first, with the words they happened in', () => {
  const list = [
    attempt({ score: 40, createdAt: at(1), issues: [{ sound: 'th-voiceless', word: 'think', detail: '' }, { sound: 'th-voiceless', word: 'think', detail: '' }] }),
    attempt({ score: 50, target: 'three', cardId: 'c2', createdAt: at(2), issues: [{ sound: 'th-voiceless', detail: '' }, { sound: 'w', word: 'with', detail: '' }] }),
    attempt({ score: 90, createdAt: at(3), issues: [{ sound: 'other', detail: 'x' }] }),
    attempt({ score: 10, createdAt: at(3), isDeleted: true, issues: [{ sound: 'w', detail: '' }] }),
  ];
  const sounds = weakSounds(list);
  assert.deepEqual(sounds.map(s => [s.sound, s.count]), [['th-voiceless', 2], ['w', 1]]);
  assert.deepEqual(sounds[0].words, ['three', 'think'], 'the try\'s text when no word is named; latest first');
  assert.equal(sounds[0].share, 2 / 3);
  assert.deepEqual(focusSounds(list), ['th-voiceless'], 'only sounds missed in two tries or more');
  assert.deepEqual(weakSounds(list, 1), [], 'only the last try counts with a window of one');
});

test('progress: averages by day, recent against earlier, every item with its scores', () => {
  const list = [
    ...Array.from({ length: 10 }, (_, i) => attempt({ score: 50, createdAt: at(1, i) })),
    ...Array.from({ length: 10 }, (_, i) => attempt({ score: 70, cardId: 'c2', target: 'three', createdAt: at(2, i) })),
    attempt({ score: 30, cardId: 'c1', kind: 'sentence', target: 'I think so.', createdAt: at(3) }),
  ];
  const days = dailyScores(list);
  assert.equal(days.length, 3);
  assert.deepEqual(days.map(d => d.average), [50, 70, 30]);
  assert.equal(dailyScores(list, 2).length, 2, 'only the latest days');

  const s = speechSummary(list);
  assert.equal(s.total, 21);
  assert.equal(s.recentAverage, 66); // nine 70s and a 30
  assert.equal(s.previousAverage, 52); // one 70 and nine 50s
  assert.equal(s.change, 14);
  assert.equal(s.practisedItems, 3, 'a card read as a word and as its sentence counts twice');
  assert.equal(speechSummary(list.slice(0, 5)).change, null, 'no comparison before 20 tries');

  const items = itemProgress(list);
  assert.equal(items[0].kind, 'sentence', 'most recent first');
  const think = items.find(i => i.key === attemptKey({ cardId: 'c1', target: 'think', kind: 'word' }))!;
  assert.equal(think.scores.length, 10);
  assert.equal(think.best, 50);
});

test('weak cards are those whose latest try scored low, weakest first', () => {
  const list = [
    attempt({ score: 30, cardId: 'a', createdAt: at(1) }),
    attempt({ score: 90, cardId: 'a', createdAt: at(2) }), // improved: not weak any more
    attempt({ score: 60, cardId: 'b', createdAt: at(2) }),
    attempt({ score: 40, cardId: 'c', createdAt: at(3) }),
    attempt({ score: 20, cardId: undefined, target: 'free text', createdAt: at(3) }), // no card
  ];
  assert.deepEqual(weakCardIds(list), ['c', 'b']);
});

test('a new try keeps its card, kind and evaluation; tries are part of what syncs', () => {
  const a = newAttempt(' think ', 'word', { score: 70, feedback: 'ok', issues: [] }, 'c1', new Date(at(5)), 'x1');
  assert.deepEqual(a, { id: 'x1', cardId: 'c1', target: 'think', kind: 'word', score: 70, feedback: 'ok', issues: [], createdAt: at(5), updatedAt: at(5) });

  const base = { cards: [] as Flashcard[], decks: [], sources: [], chapters: [], occurrences: [], knownWords: [], profile: null, achievements: [] };
  assert.notEqual(syncFingerprint({ ...base, speechAttempts: [] }), syncFingerprint({ ...base, speechAttempts: [a] }), 'a new try starts a sync');

  const local: LocalData = { decks: [], cards: [], sources: [], chapters: [], occurrences: [], knownWords: [], speechAttempts: [a], logs: [], achievements: [] };
  const out = nextOutgoing(local, freshSyncState('jafar'));
  assert.deepEqual(out.changes.speechAttempts, [a]);
});
