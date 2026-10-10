import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readerSection } from '../services/readerText';
import { pieceAt, piecesOf, ReadAloudPlayer, type AudioLike, type PlayerDeps, type PlayerState } from '../services/readAloud';
import { audioBytes, wavFromPcm } from '../services/aiSpeech';
import { cleanAiTranslation, freeBatches } from '../services/translate';
import { cleanSpeechName, findAudio, generateSpeech, SpeechError } from '../server/speech';

const TEXT = 'The rain stopped. We walked to the old bridge and waited.\n\nThen the boat came. It was late.';

test('pieces: one sentence each for the device voice, grouped by paragraph for the AI voice', () => {
  const section = readerSection(TEXT);
  const device = piecesOf(section);
  assert.deepEqual(device.map(p => p.text), ['The rain stopped.', 'We walked to the old bridge and waited.', 'Then the boat came.', 'It was late.']);
  assert.deepEqual(device.map(p => p.paragraph), [0, 0, 1, 1]);
  const ai = piecesOf(section, 90);
  assert.deepEqual(ai.map(p => p.text), ['The rain stopped. We walked to the old bridge and waited.', 'Then the boat came. It was late.']);
  // A short first piece starts sooner.
  const firstShort = piecesOf(section, 90, 3);
  assert.equal(firstShort[0].text, 'The rain stopped.');
  assert.equal(firstShort[1].text, 'We walked to the old bridge and waited.');
  // Word ranges cover the words of each piece.
  assert.equal(section.words[ai[1].from].text, 'Then');
  assert.equal(section.words[ai[1].to].text, 'late');
  assert.equal(pieceAt(device, ai[1].from), 2);
});

// A player whose voices are fakes: speaking and audio end when the test says.
const harness = (opts: { failAi?: boolean } = {}) => {
  const log: string[] = [];
  const states: PlayerState[] = [];
  let speaking: { text: string; end: () => void; error: () => void } | null = null;
  const synth: { text: string; resolve: (url: string) => void; reject: (e: Error) => void }[] = [];
  const audio: AudioLike & { ended: () => void } = {
    src: '', playbackRate: 1, paused: true,
    play() { this.paused = false; log.push(`play ${this.src}`); return Promise.resolve(); },
    pause() { this.paused = true; log.push('pause'); },
    onended: null, onerror: null,
    ended() { this.paused = true; this.onended?.(); },
  };
  const deps: PlayerDeps = {
    speak: (text, end, error) => { speaking = { text, end, error }; log.push(`say ${text}`); },
    stopSpeaking: () => { const s = speaking; speaking = null; s?.error(); }, // like a cancel: the utterance errors
    synthesize: text => new Promise((resolve, reject) => {
      if (opts.failAi) { reject(new Error('quota')); return; }
      synth.push({ text, resolve, reject });
    }),
    revoke: () => undefined,
    newAudio: () => audio,
    onChange: s => states.push(s),
    onAiFailed: e => log.push(`ai failed: ${(e as Error).message}`),
  };
  return { log, states, deps, audio, synth, speaking: () => speaking };
};

const tick = () => new Promise(r => setTimeout(r, 0));

test('device voice: a pause goes on from the sentence it stopped in', () => {
  const h = harness();
  const p = new ReadAloudPlayer(h.deps, 'device');
  p.setPieces(['One.', 'Two.', 'Three.']);
  p.play();
  h.speaking()!.end();
  assert.equal(h.speaking()!.text, 'Two.');
  p.pause();
  assert.equal(p.state.status, 'paused');
  assert.equal(h.speaking(), null);
  p.play();
  assert.equal(h.speaking()!.text, 'Two.');
  assert.equal(p.state.status, 'playing');
  h.speaking()!.end();
  h.speaking()!.end();
  assert.deepEqual(p.state, { status: 'idle', index: 0, voice: 'device' });
});

test('device voice: stop goes back to the start; play from a piece starts there', () => {
  const h = harness();
  const p = new ReadAloudPlayer(h.deps, 'device');
  p.setPieces(['One.', 'Two.', 'Three.']);
  p.play(2);
  assert.equal(h.speaking()!.text, 'Three.');
  p.stop();
  assert.deepEqual(p.state, { status: 'idle', index: 0, voice: 'device' });
  p.play();
  assert.equal(h.speaking()!.text, 'One.');
});

test('AI voice: fetches ahead, a pause keeps the audio and play resumes it', async () => {
  const h = harness();
  const p = new ReadAloudPlayer(h.deps, 'ai');
  p.setPieces(['One.', 'Two.', 'Three.']);
  p.play();
  assert.equal(p.state.status, 'loading');
  h.synth[0].resolve('url-1');
  await tick();
  assert.equal(p.state.status, 'playing');
  assert.equal(h.audio.src, 'url-1');
  assert.equal(h.synth.length, 2, 'the next piece is asked for while this one plays');
  p.pause();
  assert.equal(p.state.status, 'paused');
  assert.ok(h.audio.paused);
  p.play();
  assert.equal(p.state.status, 'playing');
  assert.equal(h.audio.src, 'url-1', 'the same audio goes on, not a new request');
  h.synth[1].resolve('url-2');
  h.audio.ended();
  await tick();
  assert.equal(h.audio.src, 'url-2');
  assert.equal(p.state.index, 1);
});

test('AI voice: a pause while the audio is coming waits, then plays it on resume', async () => {
  const h = harness();
  const p = new ReadAloudPlayer(h.deps, 'ai');
  p.setPieces(['One.', 'Two.']);
  p.play();
  p.pause();
  h.synth[0].resolve('url-1');
  await tick();
  assert.equal(p.state.status, 'paused');
  p.play();
  await tick();
  assert.equal(p.state.status, 'playing');
  assert.equal(h.audio.src, 'url-1');
  assert.equal(h.synth.filter(s => s.text === 'One.').length, 1, 'asked once');
});

test('AI voice: when it fails, the device voice goes on from the same piece', async () => {
  const h = harness({ failAi: true });
  const p = new ReadAloudPlayer(h.deps, 'ai');
  p.setPieces(['One.', 'Two.']);
  p.play(1);
  await tick();
  assert.ok(h.log.includes('ai failed: quota'));
  assert.equal(p.state.voice, 'device');
  assert.equal(h.speaking()!.text, 'Two.');
  // Another text starts over in the chosen voice.
  p.setPieces(['Other.']);
  assert.equal(p.state.voice, 'ai');
});

test('the same text cut for another voice keeps its place', () => {
  const h = harness();
  const p = new ReadAloudPlayer(h.deps, 'device');
  p.setPieces(['One.', 'Two.', 'Three.']);
  p.play(2);
  p.pause();
  p.setPreferred('ai');
  p.setPieces(['One. Two.', 'Three.'], 1);
  assert.deepEqual(p.state, { status: 'paused', index: 1, voice: 'ai' });
});

test('PCM audio gets a WAV header; WAV stays as it is', () => {
  const pcm = new Uint8Array([1, 0, 2, 0]);
  const wav = wavFromPcm(pcm, 24000);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(wav.length, 48);
  assert.equal(new DataView(wav.buffer).getUint32(24, true), 24000);
  const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
  assert.equal(audioBytes(b64(pcm), 'audio/L16').bytes.length, 48);
  assert.equal(audioBytes(b64(wav), 'audio/wav').bytes.length, 48);
  assert.equal(audioBytes(b64(wav), '').type, 'audio/wav');
});

test('free translation: sentences joined up to the limit, long ones cut at a space', () => {
  const batches = freeBatches('One two. Three four. Five six seven eight nine ten.', 20);
  assert.deepEqual(batches, ['One two. Three four.', 'Five six seven eight', 'nine ten.']);
  assert.ok(batches.every(b => b.length <= 20));
});

test('AI translation: thinking, quotes and labels are dropped', () => {
  assert.equal(cleanAiTranslation('<think>hmm</think>\nترجمه: «باران بند آمد.»'), 'باران بند آمد.');
  assert.equal(cleanAiTranslation('```\nسلام\n```'), 'سلام');
});

// --- server/speech.ts ---

const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

test('speech: audio is found in an Interactions answer and a generateContent answer', () => {
  assert.deepEqual(findAudio({ steps: [{ type: 'user_input' }, { type: 'model_output', content: [{ type: 'audio', data: 'QUJD', mime_type: 'audio/wav' }] }] }),
    { data: 'QUJD', mimeType: 'audio/wav' });
  assert.deepEqual(findAudio({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: 'QUJD' } }] } }] }),
    { data: 'QUJD', mimeType: 'audio/L16', sampleRate: 24000 });
  assert.equal(findAudio({ text: 'no audio' }), null);
});

test('speech: the Interactions API first; a 404 there tries generateContent; a 429 does not', async () => {
  const calls: string[] = [];
  const ok = await generateSpeech('k', 'Hello.', 'gemini-3.8-flash-tts', 'Kore', async (url: string, init: any) => {
    calls.push(url);
    const body = JSON.parse(init.body);
    if (url.endsWith('/interactions')) {
      assert.equal(body.model, 'gemini-3.8-flash-tts');
      assert.equal(body.generation_config.speech_config[0].voice, 'Kore');
      return reply(404, { error: { message: 'not found' } });
    }
    assert.deepEqual(body.generationConfig.responseModalities, ['AUDIO']);
    assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
    return reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: 'QUJD' } }] } }] });
  });
  assert.equal(ok.data, 'QUJD');
  assert.equal(calls.length, 2);

  let n = 0;
  await assert.rejects(
    generateSpeech('k', 'Hello.', 'gemini-3.8-flash-tts', 'Kore', async () => { n++; return reply(429, { error: { message: 'quota' } }); }),
    (e: unknown) => e instanceof SpeechError && e.status === 429 && /quota/.test(e.message),
  );
  assert.equal(n, 1);
});

test('speech: older models go to generateContent first', async () => {
  const calls: string[] = [];
  await generateSpeech('k', 'Hi.', 'gemini-2.5-flash-preview-tts', 'Puck', async (url: string) => {
    calls.push(url);
    return reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16', data: 'QQ==' } }] } }] });
  });
  assert.match(calls[0], /:generateContent$/);
});

test('speech: model and voice names are checked', () => {
  assert.equal(cleanSpeechName('gemini-3.8-flash-tts', 'x'), 'gemini-3.8-flash-tts');
  assert.equal(cleanSpeechName('../models/evil?key=1', 'x'), 'x');
  assert.equal(cleanSpeechName(undefined, 'Kore'), 'Kore');
});

test('pieces: a long sentence without a full stop is cut between words', () => {
  const long = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
  const section = readerSection(long);
  const device = piecesOf(section);
  assert.equal(device.length, 3);
  assert.ok(device.every(p => p.to - p.from + 1 <= 40));
  const ai = piecesOf(section, 30);
  assert.ok(ai.every(p => p.to - p.from + 1 <= 30));
  assert.equal(ai.map(p => p.text).join(' '), long);
});

test('AI audio made with another voice is not reused; audio that comes too late is let go', async () => {
  const h = harness();
  let key = 'm/Kore';
  const revoked: string[] = [];
  const p = new ReadAloudPlayer({ ...h.deps, cacheKey: () => key, revoke: url => revoked.push(url) }, 'ai');
  p.setPieces(['One.', 'Two.']);
  p.play();
  h.synth[0].resolve('url-1');
  await tick();
  p.stop();
  key = 'm/Puck';
  p.play();
  assert.equal(h.synth.filter(s => s.text === 'One.').length, 2, 'asked again in the new voice');
  // The text changes while the first piece is still coming.
  p.setPieces(['Other.']);
  h.synth[2].resolve('url-late');
  await tick();
  assert.ok(revoked.includes('url-late'));
});

test('the same pieces again keep the place, even after an AI failure', async () => {
  const h = harness({ failAi: true });
  const p = new ReadAloudPlayer(h.deps, 'ai');
  p.setPieces(['One.', 'Two.']);
  p.play(1);
  await tick();
  p.pause();
  p.setPieces(['One.', 'Two.']);
  assert.equal(p.state.index, 1);
  assert.equal(p.state.status, 'paused');
});
