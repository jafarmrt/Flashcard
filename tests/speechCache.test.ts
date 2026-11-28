import { test } from 'node:test';
import assert from 'node:assert/strict';
import { piecesToDrop } from '../services/speechCache';

const MB = 1024 * 1024;

test('kept speech stays within its total size, the least recently played pieces going first', () => {
  const sizes = [
    { key: 'old', at: 1, len: 120 * MB },
    { key: 'mid', at: 2, len: 120 * MB },
    { key: 'new', at: 3, len: 120 * MB },
  ];
  assert.deepEqual(piecesToDrop(sizes, 5000, 300 * MB), ['old']);
  assert.deepEqual(piecesToDrop(sizes, 5000, 1000 * MB), [], 'nothing goes while within the limits');
});

test('kept speech stays within its number of pieces as well', () => {
  const sizes = Array.from({ length: 5 }, (_, i) => ({ key: `p${i}`, at: 10 - i, len: 1 }));
  assert.deepEqual(piecesToDrop(sizes, 3, 300 * MB), ['p4', 'p3']);
});
