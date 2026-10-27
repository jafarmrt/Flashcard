import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysAway, lastLines, makeRecap, parseRecap, recapPrompt } from '../services/recap';

test('days away: from the reading log, else from when the book last changed', () => {
  assert.equal(daysAway(['2026-10-20', '2026-10-24', '2026-10-27'], undefined, '2026-10-27'), 3);
  assert.equal(daysAway([], '2026-10-25T09:00:00Z', '2026-10-27'), 2);
  assert.equal(daysAway(['2026-10-27'], '2026-10-27T01:00:00Z', '2026-10-27'), null, 'read today');
});

test('without AI, the last lines read; with AI, a summary in English and Persian', async () => {
  const texts = ['It was cold. She stayed in.', 'Then the letter came. She opened it. It was from Tom.'];
  assert.equal(lastLines(texts), 'Then the letter came. She opened it. It was from Tom.');
  assert.deepEqual(await makeRecap('B', texts, false), { lastLines: 'Then the letter came. She opened it. It was from Tom.' });
  const send = async () => ({ text: '```json\n{"summary": "She got a letter from Tom.", "persian": "نامه‌ای از تام رسید."}\n```' });
  const r = await makeRecap('B', texts, true, undefined, send as any);
  assert.equal(r.summary, 'She got a letter from Tom.');
  assert.equal(r.persian, 'نامه‌ای از تام رسید.');
  assert.equal(r.by, 'ai');
  const broken = await makeRecap('B', texts, true, undefined, (async () => { throw new Error('quota'); }) as any);
  assert.equal(broken.summary, undefined);
  assert.ok(broken.lastLines);
  assert.deepEqual(parseRecap('no json'), {});
  assert.match(recapPrompt('Dune', 'x'), /do not tell what comes next/);
});
