import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Flashcard, SpeechAttempt } from '../types';
import {
  attemptKey, cleanEvaluation, compactAttempts, dailyScores, dueSchedules, focusIndexes, focusSounds, itemProgress, newAttempt,
  pickSpeechItems, practiceSentence, pronunciationPrompt, PRONUNCIATION_SCHEMA, scheduleFor, sentenceAround, sessionResults,
  SOUND_IDS, speechSummary, speechTokens, speechWords, weakCardIds, weakSounds, compareHeard, wordLikeness, withHeardCheck, listenerMissed,
} from '../services/speechPractice';
import type { Occurrence } from '../types';
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
  assert.throws(() => cleanEvaluation({ score: 'x' }), 'no score is no answer, not a zero');
  assert.throws(() => cleanEvaluation({}));
  assert.throws(() => cleanEvaluation(null));
  assert.equal(cleanEvaluation({ score: -5 }).score, 0);
  assert.equal(cleanEvaluation({ score: '72' }).score, 72);
  assert.deepEqual(cleanEvaluation({ score: 0 }).issues, []);
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
  assert.equal(speechSummary(list.slice(0, 11)).previousAverage, null, 'not one try passed off as the earlier ten');

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

test('old tries lose their long texts but keep score, sounds and words', () => {
  const list = Array.from({ length: 5 }, (_, i) => attempt({
    score: 40 + i, createdAt: at(1, i), heard: 'tink', correction: '/θɪŋk/', feedback: 'بلند',
    issues: [{ sound: 'th-voiceless', word: 'think', detail: 'توضیح' }],
  }));
  const out = compactAttempts(list, 3, new Date(at(9)));
  assert.deepEqual(out.map(a => a.score), [40, 41], 'only beyond the latest three');
  assert.deepEqual(out[0].issues, [{ sound: 'th-voiceless', word: 'think', detail: '' }]);
  assert.equal(out[0].feedback, '');
  assert.equal('heard' in out[0] || 'correction' in out[0], false);
  assert.equal(out[0].updatedAt, at(9), 'newer, so the short copy wins on every device');
  assert.deepEqual(compactAttempts([...out, ...list.slice(2)], 3), [], 'nothing twice');
  assert.equal(weakSounds([...out, ...list.slice(2)])[0].count, 5, 'still counted');
});

// --- Words in their sentence ---

const card = (over: Partial<Flashcard> = {}): Flashcard => ({
  id: 'c1', deckId: 'd', front: 'think', back: 'فکر کردن', repetition: 1, easinessFactor: 2.5, interval: 1,
  dueDate: at(30), createdAt: at(1), updatedAt: at(1), ...over,
} as Flashcard);
const occ = (over: Partial<Occurrence>): Occurrence => ({
  id: 'o', cardId: 'c1', sourceId: 's', chapterId: 'ch', chunk: 0, createdAt: at(1), updatedAt: at(1), ...over,
});

test('a sentence is cut into numbered words with the punctuation between them', () => {
  const tokens = speechTokens("“I don't think so,” she said.");
  assert.deepEqual(tokens.filter(t => t.i !== undefined).map(t => t.text), ['I', "don't", 'think', 'so', 'she', 'said']);
  assert.equal(tokens.map(t => t.text).join(''), "“I don't think so,” she said.", 'nothing is lost');
  assert.deepEqual(speechWords('well-known, 42 cats'), ['well-known', '42', 'cats']);
});

test("the card's term is found in its sentence in any form, phrases with a word between", () => {
  assert.deepEqual(focusIndexes('She thought about it.', 'think'), [1]);
  assert.deepEqual(focusIndexes('They took the cost into account.', 'take something into account'), [1, 4, 5]);
  assert.deepEqual(focusIndexes('He gave it up at last.', 'give up'), [1, 3]);
  assert.deepEqual(focusIndexes('They took the cost of the journey into account.', 'take something into account'), [1, 7, 8], 'a long object where the placeholder stood');
  assert.deepEqual(focusIndexes('He gave the old red book to me and then up we went.', 'give up'), [], 'no placeholder: no long gap');
  assert.deepEqual(focusIndexes('Nothing here.', 'think'), []);
});

test('the sentence to practise: where the word was met in a book first, then the card, then its examples', () => {
  const c = card({ sourceSentence: 'I think so.', exampleSentenceTarget: ['Think before you speak.'] });
  const book = [occ({ sentence: 'He was thinking about the long winter ahead.', updatedAt: at(2) }), occ({ cardId: 'other', sentence: 'Not this one at all.' })];
  assert.equal(practiceSentence(c, book), 'He was thinking about the long winter ahead.');
  assert.equal(practiceSentence(c), 'I think so.');
  assert.equal(practiceSentence(card({ sourceSentence: 'Think!', exampleSentenceTarget: ['Think before you speak.'] })), 'Think before you speak.', 'too short is skipped');
  assert.equal(practiceSentence(card({ exampleSentenceTarget: ['A sentence without it here.'] })), 'A sentence without it here.', 'a sentence without the term only when nothing else');
  assert.equal(practiceSentence(card({ sourceSentence: '', exampleSentenceTarget: [] })), '');
});

test('a long sentence is cut around the word, at a comma where there is one', () => {
  const long = 'When the long and very cold winter finally came to the small village in the north, the old man began to think about the summer he had spent by the sea as a boy.';
  const cut = sentenceAround(long, 'think', 16);
  assert.ok(speechWords(cut).length <= 16, cut);
  assert.ok(cut.includes('think'));
  assert.ok(cut.startsWith('… the old man'), `starts after the comma: ${cut}`);
  assert.ok(cut.endsWith(' …'));
  assert.equal(sentenceAround('A short one to think about.', 'think'), 'A short one to think about.');
});

test('a sentence prompt numbers its words, names the learned phrase and asks for marks and parts', () => {
  const p = pronunciationPrompt('They took the cost into account.', 'sentence', [], 'take something into account');
  assert.match(p, /1 They \| 2 took \| 3 the \| 4 cost \| 5 into \| 6 account/);
  assert.match(p, /"took into account" \(words 2, 5, 6\)/);
  assert.match(p, /"marks"/);
  assert.match(p, /"parts"/);
  assert.match(p, /focusScore/);
  assert.doesNotMatch(pronunciationPrompt('think', 'word'), /marks/);
});

test('word marks are kept only for real words, once each, with known statuses and sounds', () => {
  const e = cleanEvaluation({
    score: 70, feedback: 'خوب', issues: [], tip: ' آرام‌تر ', focusScore: '64',
    parts: { accuracy: 80, fluency: 120, rhythm: 'x', completeness: null },
    marks: [
      { i: 2, status: 'WRONG', heard: 'tink', sound: 'th-voiceless' },
      { i: 2, status: 'unclear' }, // the same word again
      { i: 9, status: 'missed' }, // no such word
      { i: 1, status: 'great' }, // unknown status
      { i: 3, status: 'missed', sound: 'bogus' },
    ],
  }, 'I think so');
  assert.deepEqual(e.marks, [{ i: 1, status: 'wrong', heard: 'tink', sound: 'th-voiceless' }, { i: 2, status: 'missed' }]);
  assert.deepEqual(e.parts, { accuracy: 80, fluency: 100 });
  assert.equal(e.focusScore, 64);
  assert.equal(e.tip, 'آرام‌تر');
  assert.equal('marks' in cleanEvaluation({ score: 50, feedback: '', issues: [], marks: [{ i: 1, status: 'wrong' }] }), false, 'no text, no marks');
});

// --- When an item comes back ---

const tryOn = (day: number, score: number, over: Partial<SpeechAttempt> = {}) =>
  attempt({ score, createdAt: at(day), kind: 'sentence', target: 'I think so.', ...over });
const local = (day: number) => new Date(2026, 9, day, 12); // noon local time, like the day strings

test('an item is judged by its first try of each day: weak comes back tomorrow, good ones later and later', () => {
  const key = 'c1|sentence';
  const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}`;
  let s = scheduleFor(key, [tryOn(1, 40), tryOn(1, 90, { createdAt: at(1, 11) })]);
  assert.equal(s.stage, 'learning');
  assert.equal(s.dueDay, day(3), 'a weak start that ended well: two days');
  s = scheduleFor(key, [tryOn(1, 40), tryOn(1, 55, { createdAt: at(1, 11) })]);
  assert.equal(s.dueDay, day(2), 'still weak: the next day');
  s = scheduleFor(key, [tryOn(1, 40), tryOn(2, 85)]);
  assert.deepEqual([s.stage, s.goodDays, s.dueDay], ['reviewing', 1, day(5)]);
  s = scheduleFor(key, [tryOn(1, 40), tryOn(2, 85), tryOn(5, 90)]);
  assert.deepEqual([s.goodDays, s.dueDay], [2, day(12)]);
  s = scheduleFor(key, [tryOn(1, 40), tryOn(2, 85), tryOn(5, 90), tryOn(12, 88)]);
  assert.deepEqual([s.stage, s.dueDay], ['settled', day(28)]);
  s = scheduleFor(key, [tryOn(2, 85), tryOn(5, 90), tryOn(12, 50)]);
  assert.deepEqual([s.stage, s.goodDays, s.dueDay], ['learning', 0, day(13)], 'a bad day starts over');
});

test('due items come weakest first; a session takes them, then a couple of new ones', () => {
  const list = [
    tryOn(1, 70, { cardId: 'a' }), tryOn(1, 40, { cardId: 'b' }), tryOn(1, 95, { cardId: 'c' }),
    tryOn(1, 30, { cardId: 'gone' }),
  ];
  assert.deepEqual(dueSchedules(list, '2026-10-02').map(s => s.cardId), ['gone', 'b', 'a']);
  const cards = ['a', 'b', 'c', 'n1', 'n2', 'n3'].map(id => card({ id, sourceSentence: 'I think so.' }));
  const items = pickSpeechItems({ cards, attempts: list, kind: 'sentence', choice: 'plan', size: 4, now: local(2), random: () => 0 });
  assert.deepEqual(items.slice(0, 2).map(i => i.card.id), ['b', 'a'], 'due ones first; a deleted card is left out; c is not due');
  assert.ok(items.slice(2).every(i => i.card.id.startsWith('n')), 'then new ones');
  assert.equal(items.length, 4);
  assert.equal(items[0].target, 'I think so.');
  assert.equal(items[0].focus, 'think');
  const crowded = pickSpeechItems({ cards, attempts: list, kind: 'sentence', choice: 'plan', size: 2, now: local(2), random: () => 0 });
  assert.equal(crowded.filter(i => i.card.id.startsWith('n')).length, 2, 'new ones keep their two places');
  assert.deepEqual(pickSpeechItems({ cards, attempts: list, kind: 'sentence', choice: 'weak', now: local(2) }).map(i => i.card.id), ['b', 'a']);
  assert.deepEqual(pickSpeechItems({ cards: [card({ id: 'w' })], attempts: [], kind: 'word', choice: 'plan' }).map(i => [i.target, i.focus]), [['think', undefined]]);
});

test('a session ends with each item: first and last score, when it comes back', () => {
  const tried = [tryOn(3, 45, { cardId: 'a', focus: 'think' }), tryOn(3, 82, { cardId: 'a', focus: 'think', createdAt: at(3, 11) })];
  const [r] = sessionResults(tried, tried);
  assert.deepEqual([r.first, r.last, r.tries, r.focus, r.dueDay], [45, 82, 2, 'think', '2026-10-05']);
});

test('old tries keep their word marks without what was heard', () => {
  const list = Array.from({ length: 3 }, (_, i) => attempt({ score: 50, createdAt: at(1, i), kind: 'sentence', tip: 'x', marks: [{ i: 1, status: 'wrong', heard: 'tink', sound: 'th-voiceless' }] }));
  const [old] = compactAttempts(list, 2, new Date(at(9)));
  assert.deepEqual(old.marks, [{ i: 1, status: 'wrong', sound: 'th-voiceless' }]);
  assert.equal('tip' in old, false);
});

// --- What was heard, against the text ---

test('what was heard is lined up with the text: left out, said as another word, nearly, added', () => {
  const { words, added } = compareHeard('I think the weather will change soon.', 'I tink weather will change very soon');
  assert.deepEqual(words.map(w => w.status), ['ok', 'close', 'missed', 'ok', 'ok', 'ok', 'ok']);
  assert.equal(words[1].heard, 'tink');
  assert.equal(added, 1);
  assert.deepEqual(compareHeard('He was reluctant.', 'He was happy').words.map(w => w.status), ['ok', 'ok', 'wrong']);
  assert.ok(wordLikeness("don't", 'dont') === 1);
});

test('a kind AI is checked: missed words are marked, completeness counted, the score held near it', () => {
  const target = 'I think the weather will change soon.';
  const kind = { score: 92, feedback: '', issues: [], heard: 'I think weather', parts: { accuracy: 90, completeness: 100 }, marks: [{ i: 1, status: 'unclear' as const }] };
  const checked = withHeardCheck(kind, target, 'sentence');
  assert.deepEqual(checked.marks!.map(m => [m.i, m.status]), [[1, 'unclear'], [2, 'missed'], [4, 'missed'], [5, 'missed'], [6, 'missed']]);
  assert.equal(checked.parts!.completeness, 43, 'four of seven words left out');
  assert.equal(checked.parts!.accuracy, 90);
  assert.equal(checked.score, 58, 'held to completeness + 15');
  const all = withHeardCheck({ ...kind, heard: 'I think the weather will change soon' }, target, 'sentence');
  assert.equal(all.score, 92, 'nothing missed: the AI score stands');
  const silent = { ...kind, heard: '' };
  assert.equal(withHeardCheck(silent, target, 'sentence'), silent, 'nothing heard: left to the AI');
  assert.equal(withHeardCheck({ score: 85, feedback: '', issues: [], heard: 'banana' }, 'think', 'word').score, 30, 'another word altogether');
  assert.equal(withHeardCheck({ score: 70, feedback: '', issues: [], heard: 'tink' }, 'think', 'word').score, 70, 'a near miss keeps its score');
});

test('the prompt asks for what was said word for word, not corrected', () => {
  assert.match(pronunciationPrompt('I think so.', 'sentence'), /Do NOT correct it to match the text/);
  assert.match(pronunciationPrompt('think', 'word'), /Do NOT correct it/);
});

test('a listener that did not really hear is told apart from a learner who said it wrong', () => {
  assert.equal(listenerMissed({ heard: 'leaked audio', score: 40 }, 'reluctant'), true, 'writes about the recording');
  assert.equal(listenerMissed({ heard: '[inaudible]', score: 10 }, 'think'), true);
  assert.equal(listenerMissed({ heard: 'background noise', score: 5 }, 'I think so.'), true);
  assert.equal(listenerMissed({ heard: '', score: 0 }, 'think'), true, 'heard nothing');
  assert.equal(listenerMissed({ heard: '', score: 70 }, 'think'), false, 'an answer without a transcript still counts');
  assert.equal(listenerMissed({ heard: 'tink', score: 40 }, 'think'), false, 'a real mistake is kept');
  assert.equal(listenerMissed({ heard: 'he was happy', score: 20 }, 'He was reluctant.'), false, 'another word is a real mistake');
  assert.equal(listenerMissed({ heard: 'turn the music down', score: 80 }, 'Turn the music down.'), false, 'unless the text has the word');
});
