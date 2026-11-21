import { test } from 'node:test';
import assert from 'node:assert/strict';
import { senseKey } from '../services/senseCache';

test('a kept AI meaning is found again for the same term, sentence and level only', () => {
  const s = 'He  watched the boats.';
  assert.equal(senseKey('Watched', s, 'B2'), senseKey(' watched', 'He watched the boats. ', 'B2'), 'case and spacing do not matter');
  assert.equal(senseKey('don’t', s, 'B2'), senseKey("don't", s, 'B2'), 'curly and straight apostrophes are one');
  assert.notEqual(senseKey('watched', s, 'B2'), senseKey('watched', 'She watched TV.', 'B2'), 'another sentence may mean another sense');
  assert.notEqual(senseKey('watched', s, 'B2'), senseKey('watched', s, 'A2'), 'another level is explained differently');
});
