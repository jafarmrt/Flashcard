import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Settings } from '../types';
import {
  aiRequestOptions, DEFAULT_ANTHROPIC_MODEL, DEFAULT_OR_AUDIO_MODEL, OPENROUTER_URL, providerList, providerName, providerOptions,
  pronunciationOptions, usableModel,
} from '../services/aiSettings';
import { providerFields } from '../services/aiClient';
import { KEY_IDS } from '../services/keySync';
import { anthropicReply, anthropicRequestBody, AiRequestError, openAiRequestBody, requestAudio, requestText, systemText } from '../server/aiRequests';
import { anthropicModels, openAiModels } from '../server/aiModels';
import { encodeWav, hasSpeech, louder, speechLevel } from '../services/audioWav';

const settings = (over: Partial<Settings> = {}): Settings => ({ theme: 'system', ...over } as Settings);

test('Claude is a service of its own: its key, its models, never an OpenAI-style address', () => {
  const s = settings({ aiProviders: [{ id: 'anthropic', enabled: true }, { id: 'gemini', enabled: true }], aiKeys: { anthropic: 'sk-ant-1' } });
  const options = aiRequestOptions(s);
  assert.deepEqual({ ...options, fallbacks: undefined }, { aiProvider: 'anthropic', aiBaseUrl: undefined, customApiKey: 'sk-ant-1', model: DEFAULT_ANTHROPIC_MODEL, fallbacks: undefined });
  assert.equal(options.fallbacks?.[0].aiProvider, 'gemini');
  assert.equal(providerName(options), 'Claude');
  assert.deepEqual(providerFields(options), { aiProvider: 'anthropic', aiBaseUrl: undefined, model: DEFAULT_ANTHROPIC_MODEL, customApiKey: 'sk-ant-1' });
  assert.equal(aiRequestOptions(settings({ aiProviders: [{ id: 'anthropic', enabled: true }] })).aiProvider, 'gemini', 'without a key it is skipped');
  assert.ok(KEY_IDS.includes('ai:anthropic'), 'its key follows the account');
  assert.ok(providerList(settings({ aiProviders: [{ id: 'groq', enabled: true }] })).some(p => p.id === 'anthropic' && !p.enabled), 'offered, off, on older settings');
});

test('a model name from another service is not sent to Claude, nor a Claude name elsewhere', () => {
  assert.equal(usableModel({ aiProvider: 'anthropic', aiModel: 'claude-sonnet-4-5' }), 'claude-sonnet-4-5');
  assert.equal(usableModel({ aiProvider: 'anthropic', aiModel: 'gemini-2.5-flash' }), DEFAULT_ANTHROPIC_MODEL);
  assert.equal(usableModel({ aiProvider: 'anthropic', aiModel: 'claude-3-haiku-20240307' }), DEFAULT_ANTHROPIC_MODEL, 'retired');
  assert.equal(usableModel({ aiProvider: 'openai-compatible', aiModel: 'claude-haiku-4-5' }), 'llama-3.3-70b-versatile');
  assert.equal(usableModel({ aiProvider: 'openai-compatible', aiModel: 'anthropic/claude-haiku-4.5' }), 'anthropic/claude-haiku-4.5', 'Claude through OpenRouter');
  const entry = { id: 'anthropic' as const, enabled: true, model: 'claude-opus-4-1' };
  assert.equal(providerOptions(settings({ aiKeys: { anthropic: 'k' } }), entry).model, 'claude-opus-4-1');
});

test('pronunciation is heard by Gemini and OpenRouter only, as chosen', () => {
  const noOr = pronunciationOptions(settings({ aiProviders: [{ id: 'anthropic', enabled: true }], aiKeys: { anthropic: 'k' } }));
  assert.equal(noOr.aiProvider, 'gemini', 'Claude is never asked to listen');
  assert.equal(noOr.fallbacks, undefined);
  const withOr = settings({ aiKeys: { openrouter: 'or-1', gemini: 'g-1' } });
  const auto = pronunciationOptions(withOr);
  assert.equal(auto.aiProvider, 'gemini');
  assert.deepEqual(auto.fallbacks, [{ aiProvider: 'openai-compatible', aiBaseUrl: OPENROUTER_URL, customApiKey: 'or-1', model: DEFAULT_OR_AUDIO_MODEL }]);
  assert.equal(pronunciationOptions({ ...withOr, pronunciationService: 'openrouter', orAudioModel: 'mistralai/voxtral-small-24b-2507' }).model, 'mistralai/voxtral-small-24b-2507');
  assert.equal(pronunciationOptions({ ...withOr, pronunciationService: 'gemini' }).fallbacks, undefined);
  assert.equal(pronunciationOptions(settings({ pronunciationService: 'openrouter' })).aiProvider, 'gemini', 'no OpenRouter key: Gemini');
});

const audioPayload = {
  model: 'google/gemini-2.5-flash',
  contents: { parts: [{ text: 'Judge this.' }, { inlineData: { mimeType: 'audio/wav', data: 'UklGRg==' } }] },
  config: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { score: { type: 'INTEGER' } } } },
};

test('OpenRouter gets the recording as input_audio, and JSON asked for in words', () => {
  const body = openAiRequestBody(audioPayload, 'openrouter.ai');
  assert.deepEqual(body.messages[1].content, [{ type: 'text', text: 'Judge this.' }, { type: 'input_audio', input_audio: { data: 'UklGRg==', format: 'wav' } }]);
  assert.match(body.messages[0].content, /one JSON object only.*"score"/s);
  assert.equal(body.response_format, undefined, 'not every audio model takes a JSON mode');
  assert.deepEqual(body.usage, { include: true });
  const text = openAiRequestBody({ contents: 'Hi', config: { responseMimeType: 'application/json', systemInstruction: { parts: [{ text: 'Be brief.' }] } } }, 'api.groq.com');
  assert.deepEqual(text.messages, [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }]);
  assert.deepEqual(text.response_format, { type: 'json_object' });
  assert.equal(text.usage, undefined);
  assert.deepEqual(requestAudio({ parts: [{ inlineData: { mimeType: 'audio/webm;codecs=opus', data: 'x' } }, { inlineData: { mimeType: 'image/png', data: 'y' } }] }), [{ data: 'x', format: 'webm' }]);
  assert.equal(requestText([{ parts: [{ text: 'a' }, { text: 'b' }] }]), 'a\nb');
  assert.equal(systemText(undefined), '');
});

test('Claude gets a Messages API request; audio is refused; its answer is read back', () => {
  const body = anthropicRequestBody({ model: 'claude-haiku-4-5', contents: 'List words.', config: { responseMimeType: 'application/json', systemInstruction: 'You teach English.' } });
  assert.equal(body.model, 'claude-haiku-4-5');
  assert.equal(body.max_tokens, 8192);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'List words.' }]);
  assert.match(body.system, /^You teach English\.\n\nReply with one JSON object only/);
  assert.equal(anthropicRequestBody({ contents: 'x', config: { maxOutputTokens: 16 } }).max_tokens, 16);
  // Newer Claude models refuse sampling settings ("`temperature` is deprecated for this model").
  const sampled = anthropicRequestBody({ contents: 'x', config: { temperature: 0.2, topP: 0.9, topK: 5 } });
  assert.deepEqual(Object.keys(sampled).sort(), ['max_tokens', 'messages', 'model']);
  assert.equal(anthropicRequestBody({ contents: 'x' }).system, undefined);
  assert.throws(() => anthropicRequestBody(audioPayload), (e: unknown) => e instanceof AiRequestError && /cannot listen/.test(e.message));
  assert.deepEqual(
    anthropicReply({ model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: '{"a":' }, { type: 'thinking', thinking: 'x' }, { type: 'text', text: '1}' }], usage: { input_tokens: 12, output_tokens: 5 } }, 'claude-haiku-4-5'),
    { text: '{"a":1}', model: 'claude-haiku-4-5-20251001', usage: { input: 12, output: 5 } },
  );
  assert.deepEqual(anthropicReply({}, 'asked'), { text: '', model: 'asked' });
});

test('model lists: Claude models with their names; OpenRouter says which ones hear audio', () => {
  assert.deepEqual(anthropicModels({ data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }, { id: 'other' }] }), [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }]);
  const list = openAiModels({ data: [
    { id: 'google/gemini-2.5-flash', architecture: { input_modalities: ['text', 'image', 'audio'], output_modalities: ['text'] } },
    { id: 'deepseek/deepseek-chat', architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  ] });
  assert.deepEqual(list.map(m => [m.id, !!m.audio]), [['google/gemini-2.5-flash', true], ['deepseek/deepseek-chat', false]]);
});

test('a recording becomes 16-bit mono WAV', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), 'WAVE');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), 8);
  assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true), view.getInt16(50, true)], [0, 32767, -32768, 32767]);
});

// One second at 16 kHz: quiet room noise, with a voice from 0.3 to 0.8 s.
const recording = (voice: number, noise = 0.002) => {
  const s = new Float32Array(16000);
  for (let k = 0; k < s.length; k++) {
    const t = k / 16000;
    s[k] = (Math.sin(k * 7.1) * noise) + (t >= 0.3 && t < 0.8 ? Math.sin(2 * Math.PI * 220 * t) * voice : 0);
  }
  return s;
};

test('a recording is measured: how loud, how much of it is voice', () => {
  const normal = speechLevel(recording(0.4));
  assert.ok(Math.abs(normal.voicedSeconds - 0.5) < 0.05, `${normal.voicedSeconds}`);
  assert.ok(hasSpeech(normal));
  assert.ok(hasSpeech(speechLevel(recording(0.03))), 'a quiet voice is still a voice');
  assert.ok(hasSpeech(speechLevel(recording(0.008, 0.0005))), 'a very quiet voice in a quiet room too');
  assert.equal(hasSpeech(speechLevel(recording(0))), false, 'room noise only');
  assert.equal(hasSpeech(speechLevel(new Float32Array(16000))), false, 'silence');
  const short = recording(0.4).map((v, k) => (k > 16000 * 0.4 ? 0 : v));
  assert.equal(hasSpeech(speechLevel(short)), false, 'a tenth of a second is no word');
});

test('a quiet recording is made louder, up to ten times; a loud one is left alone', () => {
  const quiet = louder(recording(0.05));
  assert.ok(Math.max(...quiet) > 0.45 && Math.max(...quiet) <= 0.9, `${Math.max(...quiet)}`);
  const loud = recording(0.7);
  assert.equal(louder(loud), loud);
  assert.ok(Math.max(...louder(recording(0.001, 0.001))) < 0.03, 'noise is not blown up past ten times');
});
