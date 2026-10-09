import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeEnrich, freeTranslate, lemmaCandidates, lookupCollocations, lookupFrequencies } from '../server/freeLookup';

type Routes = Record<string, unknown>;
// Fake fetch: the first route whose key is contained in the URL answers; anything else is a 404.
const fakeFetch = (routes: Routes, calls: string[] = []) => async (url: string) => {
  calls.push(url);
  const key = Object.keys(routes).find(k => url.includes(k));
  if (!key) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => routes[key] };
};

test('lemmaCandidates offers dictionary forms of inflected words', () => {
  assert.ok(lemmaCandidates('studies').includes('study'));
  assert.ok(lemmaCandidates('stopped').includes('stop'));
  assert.ok(lemmaCandidates('making').includes('make'));
  assert.deepEqual(lemmaCandidates('give up'), ['give up']);
  assert.ok(lemmaCandidates('carried out').includes('carry out'));
});

test('lookupFrequencies reads Datamuse f: tags and caches them', async () => {
  const calls: string[] = [];
  const f = fakeFetch({
    'sp=monastery&md=f': [{ word: 'monastery', tags: ['f:3.84'] }],
    'sp=xyzzy&md=f': [],
  }, calls);
  assert.deepEqual(await lookupFrequencies(['Monastery', 'xyzzy'], f), { monastery: 3.84, xyzzy: null });
  const before = calls.length;
  assert.deepEqual(await lookupFrequencies(['monastery'], f), { monastery: 3.84 });
  assert.equal(calls.length, before, 'second lookup is served from the cache');
});

test('lookupCollocations builds expressions from neighbouring words, skipping stop words', async () => {
  const f = fakeFetch({
    'rel_bgb=decision': [{ word: 'the' }, { word: 'final' }, { word: 'difficult' }, { word: 'tough' }, { word: 'informed' }],
    'rel_bga=decision': [{ word: 'to' }, { word: 'making' }, { word: 'makers' }],
  });
  assert.deepEqual((await lookupCollocations('decision', f)).map(c => c.phrase), [
    'final decision', 'difficult decision', 'tough decision', 'decision making', 'decision makers',
  ]);
  assert.deepEqual(await lookupCollocations('give up', f), []);
});

test('freeTranslate returns the MyMemory translation and ignores warnings', async () => {
  assert.equal(await freeTranslate('reluctant', fakeFetch({ mymemory: { responseStatus: 200, responseData: { translatedText: 'بی‌میل' } } })), 'بی‌میل');
  assert.equal(await freeTranslate('reluctant', fakeFetch({ mymemory: { responseStatus: 429, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } } })), '');
  assert.equal(await freeTranslate('reluctant', fakeFetch({})), '');
});

test('freeEnrich combines dictionary, translation and expressions, using the dictionary form', async () => {
  const f = fakeFetch({
    'entries/en/monastery': [{
      word: 'monastery',
      phonetic: '/ˈmɒn.ə.stri/',
      phonetics: [{ text: '/ˈmɒn.ə.stri/', audio: 'https://audio.example/monastery.mp3' }],
      meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A place where monks live.', example: 'They visited the monastery.' }] }],
    }],
    'rel_bgb=monastery': [{ word: 'buddhist' }],
    'rel_bga=monastery': [],
    mymemory: { responseStatus: 200, responseData: { translatedText: 'صومعه' } },
  });
  const e = await freeEnrich('monasteries', f);
  assert.equal(e.found, true);
  assert.equal(e.headword, 'monastery');
  assert.equal(e.translation, 'صومعه');
  assert.equal(e.audioUrl, 'https://audio.example/monastery.mp3');
  assert.deepEqual(e.definitions, ['A place where monks live.']);
  assert.deepEqual(e.collocations, [{ phrase: 'buddhist monastery' }]);
});

test('freeEnrich reports a phrase no dictionary knows as not found', async () => {
  const e = await freeEnrich('sat on', fakeFetch({}));
  assert.equal(e.found, false);
  assert.equal(e.partOfSpeech, 'phrase');
});

test('lemmaCandidates tries the "e" form before the bare stem', () => {
  assert.deepEqual(lemmaCandidates('noted').slice(1, 3), ['note', 'not']);
  assert.deepEqual(lemmaCandidates('hopes').slice(1, 3), ['hope', 'hop']);
  assert.deepEqual(lemmaCandidates('coding').slice(1, 3), ['code', 'cod']);
});

test('an inflected word is looked up under its base form before Datamuse is asked', async () => {
  const calls: string[] = [];
  const routes = fakeFetch({
    'sp=hoped&md=dp': [{ word: 'hoped', defs: ['v\tto want'], defHeadword: 'hope' }],
    'entries/en/hope': [{ word: 'hope', meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'To want something to happen.' }] }] }],
  }, calls);
  // The dictionary does not know "hoped" itself.
  const f = async (url: string) => (url.endsWith('entries/en/hoped') ? { ok: false, status: 404, json: async () => ({}) } : routes(url));
  const e = await freeEnrich('hoped', f);
  assert.equal(e.headword, 'hope');
  assert.deepEqual(e.definitions, ['To want something to happen.']);
  assert.ok(!calls.some(u => u.includes('sp=hoped&md=dp')), 'Datamuse is only the last resort');
});

test('Datamuse definitions carry the dictionary form of an inflected word', async () => {
  const f = fakeFetch({ 'sp=carried&md=dp': [{ word: 'carried', defs: ['v\tto move while holding'], defHeadword: 'carry' }] });
  const e = await freeEnrich('carried', f);
  assert.equal(e.headword, 'carry');
});
