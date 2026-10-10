import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLeechHelp, buildExtrasPrompt, buildLeechPrompt, extrasForCards, familyText, hasExtras, isLeech, lacksExtras,
  leechHelpFor, needsLeechHelp, parseExtras, parseExtrasReply, parseFamilyText, parseLeechHelp, parseSynonymsText,
  synonymsText, withExtras,
} from '../services/cardExtras';
import { buildExtractionPrompt, parseExtractedItems } from '../services/geminiService';
import { buildCardRefreshPrompt, parseCardRefresh, proposalChanges } from '../services/cardRefresh';
import { convertToCSV, parseCSV } from '../services/csvService';
import { mergeExtracted } from '../services/vocabMerge';
import type { Flashcard } from '../types';

const T0 = new Date('2026-10-10T10:00:00Z');

const card = (over: Partial<Flashcard> = {}): Flashcard => ({
  id: 'c1', deckId: 'd', front: 'decide', back: 'تصمیم گرفتن', repetition: 0, easinessFactor: 2.5, interval: 0,
  dueDate: T0.toISOString(), createdAt: T0.toISOString(), updatedAt: T0.toISOString(), ...over,
} as Flashcard);

const REPLY = {
  synonyms: [{ word: 'choose', note: 'انتخاب از میان چند چیز' }, { word: 'decide' }, 'determine'],
  commonMistake: 'نگو decide about it؛ بگو decide on it.',
  register: 'خنثی · پرکاربرد',
  wordFamily: [{ word: 'decision', partOfSpeech: 'n.', meaning: 'تصمیم' }, { word: 'Decide' }, { word: 'indecisive', partOfSpeech: 'adj.' }],
  wordRoot: 'none',
};

test('extras are read from a reply; the term itself and "none" are left out', () => {
  const extras = parseExtras(REPLY, 'decide');
  assert.deepEqual(extras.synonyms, [{ word: 'choose', note: 'انتخاب از میان چند چیز' }, { word: 'determine' }]);
  assert.deepEqual(extras.wordFamily, [{ word: 'decision', partOfSpeech: 'n.', meaning: 'تصمیم' }, { word: 'indecisive', partOfSpeech: 'adj.' }]);
  assert.equal(extras.commonMistake, 'نگو decide about it؛ بگو decide on it.');
  assert.equal(extras.register, 'خنثی · پرکاربرد');
  assert.equal(extras.wordRoot, undefined);
  assert.deepEqual(parseExtras(null), {});
  assert.equal(hasExtras({}), false);
  assert.equal(hasExtras({ register: 'رسمی' }), true);
});

test('synonyms and word family round-trip through their text form', () => {
  const synonyms = [{ word: 'large', note: 'رسمی‌تر' }, { word: 'huge' }];
  assert.equal(synonymsText(synonyms), 'large = رسمی‌تر\nhuge');
  assert.deepEqual(parseSynonymsText(synonymsText(synonyms)), synonyms);
  const family = [{ word: 'decision', partOfSpeech: 'n.', meaning: 'تصمیم' }, { word: 'decisive', meaning: 'قاطع' }, { word: 'decidedly' }];
  assert.equal(familyText(family), 'decision (n.) = تصمیم\ndecisive = قاطع\ndecidedly');
  assert.deepEqual(parseFamilyText(familyText(family)), family);
  assert.deepEqual(parseFamilyText('  \n'), []);
});

test('extraction asks for the extras and keeps them on every item but grammar', () => {
  const prompt = buildExtractionPrompt({ text: 'She decided to stay.', level: 'B2' } as any);
  assert.match(prompt, /"synonyms"/);
  assert.match(prompt, /"commonMistake"/);
  assert.match(prompt, /"wordFamily"/);
  const items = parseExtractedItems({ words: [
    { kind: 'word', front: 'decide', back: 'تصمیم گرفتن', ...REPLY },
    { kind: 'grammar', front: 'Past perfect', back: 'گذشتهٔ کامل', register: 'رسمی', synonyms: [{ word: 'x' }] },
  ] });
  assert.equal(items[0].register, 'خنثی · پرکاربرد');
  assert.equal(items[0].synonyms?.length, 2);
  assert.ok(items[0].extrasAt);
  assert.equal(items[1].register, undefined);
  assert.equal(items[1].synonyms, undefined);
});

test('merging the same term from two sections keeps the first extras and fills the gaps', () => {
  const [merged] = mergeExtracted([
    { front: 'decide', back: 'a', register: 'خنثی' },
    { front: 'Decide', back: 'b', register: 'رسمی', synonyms: [{ word: 'choose' }] },
  ]);
  assert.equal(merged.register, 'خنثی');
  assert.deepEqual(merged.synonyms, [{ word: 'choose' }]);
});

test('filling older cards: the batch prompt, the reply and what the card keeps', async () => {
  const cards = [card(), card({ id: 'c2', front: 'reluctant', back: 'بی‌میل', sourceSentence: 'He was reluctant to go.' })];
  const prompt = buildExtrasPrompt(cards);
  assert.match(prompt, /1\. term: "decide"/);
  assert.match(prompt, /sentence: "He was reluctant to go\."/);

  // Out of order and one missing: matched by index.
  const parsed = parseExtrasReply({ cards: [{ index: 2, register: 'رسمی' }] }, cards);
  assert.equal(parsed[0], null);
  assert.equal(parsed[1]?.register, 'رسمی');
  assert.throws(() => parseExtrasReply('nope', cards));

  const { extras, origin } = await extrasForCards(cards, { aiProvider: 'gemini', model: 'gemini-2.5-flash' }, async () => ({
    text: JSON.stringify({ cards: [{ index: 1, ...REPLY }, { index: 2, register: 'رسمی' }] }),
  }));
  assert.equal(extras[0]?.synonyms?.[0].word, 'choose');
  assert.equal(origin.by, 'ai');

  // What the user typed stays; the asked time is set even when nothing came.
  const typed = card({ register: 'نوشتهٔ خودم' });
  const next = withExtras(typed, extras[0], T0);
  assert.equal(next.register, 'نوشتهٔ خودم');
  assert.equal(next.commonMistake, REPLY.commonMistake);
  assert.equal(next.extrasAt, T0.toISOString());
  assert.equal(withExtras(card(), null, T0).extrasAt, T0.toISOString());
  assert.equal(lacksExtras(withExtras(card(), null, T0)), false);
});

test('only cards never asked and with nothing in them still lack extras', () => {
  assert.equal(lacksExtras(card()), true);
  assert.equal(lacksExtras(card({ kind: 'grammar' })), false);
  assert.equal(lacksExtras(card({ isDeleted: true })), false);
  assert.equal(lacksExtras(card({ synonyms: [{ word: 'choose' }] })), false);
  assert.equal(lacksExtras(card({ extrasAt: T0.toISOString() })), false);
});

test('refilling a card asks for the extras too and shows them as changes', () => {
  assert.match(buildCardRefreshPrompt({ front: 'decide', back: '' }), /"commonMistake"/);
  assert.doesNotMatch(buildCardRefreshPrompt({ front: 'Past perfect', back: '', kind: 'grammar' }), /"commonMistake"/);
  const proposal = { ...parseCardRefresh({ translation: 'تصمیم گرفتن', ...REPLY }, { kind: 'word', front: 'decide' }), origin: { by: 'ai' as const } };
  assert.equal(proposal.register, 'خنثی · پرکاربرد');
  const fields = proposalChanges({ front: 'decide', back: 'تصمیم گرفتن' }, proposal).map(c => c.field);
  assert.deepEqual(fields, ['commonMistake', 'register', 'synonyms', 'wordFamily']);
});

test('the extras go out in a CSV and come back', () => {
  const csv = convertToCSV([card({ synonyms: [{ word: 'choose', note: 'انتخاب' }], wordFamily: [{ word: 'decision', partOfSpeech: 'n.', meaning: 'تصمیم' }], register: 'خنثی', commonMistake: 'decide on', wordRoot: 'de-' })], [{ id: 'd', name: 'D' }]);
  const [row] = parseCSV(csv);
  assert.equal(row.synonyms, 'choose = انتخاب');
  assert.equal(row.wordFamily, 'decision (n.) = تصمیم');
  assert.equal(row.register, 'خنثی');
  assert.deepEqual(parseFamilyText(row.wordFamily, ';'), [{ word: 'decision', partOfSpeech: 'n.', meaning: 'تصمیم' }]);
});

// --- Stubborn cards ---

test('a card forgotten four times is stubborn; help is offered again after two more lapses', () => {
  assert.equal(isLeech(card({ lapses: 3 })), false);
  assert.equal(isLeech(card({ lapses: 4 })), true);
  assert.equal(needsLeechHelp(card({ lapses: 4 })), true);
  assert.equal(needsLeechHelp(card({ lapses: 5, leechHelpLapses: 4 })), false);
  assert.equal(needsLeechHelp(card({ lapses: 6, leechHelpLapses: 4 })), true);
  assert.equal(needsLeechHelp(card({ lapses: 9, isDeleted: true })), false);
});

test('a fresh memory aid: the prompt avoids the old one and the kept aid goes on top', async () => {
  const stubborn = card({ lapses: 5, notes: 'از de + cide', exampleSentenceTarget: ['I decided to go.', 'Decide now.', 'Third.'] });
  const prompt = buildLeechPrompt(stubborn);
  assert.match(prompt, /forgotten 5 times/);
  assert.match(prompt, /do NOT repeat it\): "از de \+ cide"/);
  assert.throws(() => parseLeechHelp({}));

  const help = await leechHelpFor(stubborn, { aiProvider: 'gemini' }, async () => ({
    text: '{"why":"با decline قاطی می‌شود","mnemonic":"دی‌ساید: کنار گذاشتن بقیه","example":"We decided on the blue car.","exampleMeaning":"ماشین آبی را انتخاب کردیم."}',
  }));
  const kept = applyLeechHelp(stubborn, help, T0);
  assert.equal(kept.notes, 'دی‌ساید: کنار گذاشتن بقیه\nبا decline قاطی می‌شود\n\nاز de + cide');
  assert.deepEqual(kept.exampleSentenceTarget, ['We decided on the blue car.', 'I decided to go.', 'Decide now.']);
  assert.equal(kept.leechHelpLapses, 5);

  // Declined: nothing changes but it is not offered again for now.
  const declined = applyLeechHelp(stubborn, null, T0);
  assert.equal(declined.notes, stubborn.notes);
  assert.equal(needsLeechHelp(declined), false);
});
