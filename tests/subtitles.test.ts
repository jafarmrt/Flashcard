import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSubtitles, isSubtitleText, subtitlesToText } from '../services/importers';

const SRT = `1
00:00:01,000 --> 00:00:03,200
<i>Where were you last night?</i>

2
00:00:03,400 --> 00:00:05,000
- At the harbor.
- Again?

3
00:00:05,100 --> 00:00:06,000
[DOOR CLOSES]

4
00:00:12,000 --> 00:00:14,500
{\\an8}♪ The next morning ♪
he went back.
`;

const VTT = `WEBVTT

00:01.000 --> 00:03.000
Hello there.

00:03.200 --> 00:05.000 align:start
How are you?
`;

test('subtitles read as a text: no numbers, times or tags, and a pause starts a paragraph', () => {
  assert.ok(isSubtitleText(SRT));
  assert.ok(!isSubtitleText('Just a text --> with an arrow.'));
  assert.equal(subtitlesToText(SRT), 'Where were you last night? At the harbor. Again?\n\nThe next morning he went back.');
});

test('WebVTT works too, and the file becomes one text to read', () => {
  assert.equal(subtitlesToText(VTT), 'Hello there. How are you?');
  const source = importSubtitles(VTT, 'Episode 1');
  assert.equal(source.title, 'Episode 1');
  assert.equal(source.chapters.length, 1);
  assert.throws(() => importSubtitles('1\n00:00:01,000 --> 00:00:02,000\n[MUSIC]\n', 'x'));
});
