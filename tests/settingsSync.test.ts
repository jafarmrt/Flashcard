import { geminiAudioOptions, usableModel } from '../services/aiSettings';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIncomingSettings, newerSettings, toSyncedSettings } from '../services/settingsSync';

test('the AI key never leaves the device', () => {
  const synced = toSyncedSettings({ bulkAddConcurrency: 40, customApiKey: 'secret' });
  assert.deepEqual(synced, { bulkAddConcurrency: 40 });
});

test('the most recently changed settings win on the server', () => {
  const phone = { bulkAddConcurrency: 30, updatedAt: '2026-10-08T10:00:00Z' };
  const laptop = { bulkAddConcurrency: 50, updatedAt: '2026-10-08T12:00:00Z', customApiKey: 'k' };
  assert.deepEqual(newerSettings(phone, laptop), { bulkAddConcurrency: 50, updatedAt: '2026-10-08T12:00:00Z' });
  assert.deepEqual(newerSettings(laptop, phone), { bulkAddConcurrency: 50, updatedAt: '2026-10-08T12:00:00Z' });
  assert.deepEqual(newerSettings(undefined, phone), phone);
  assert.equal(newerSettings(undefined, undefined), undefined);
});

test('newer settings from the cloud are adopted but keep the local AI key', () => {
  const local = { bulkAddConcurrency: 20, customApiKey: 'mine', updatedAt: '2026-10-08T09:00:00Z' };
  const cloud = { bulkAddConcurrency: 60, theme: 'dark' as const, updatedAt: '2026-10-08T11:00:00Z' };
  assert.deepEqual(applyIncomingSettings(local, cloud), {
    bulkAddConcurrency: 60, theme: 'dark', customApiKey: 'mine', updatedAt: '2026-10-08T11:00:00Z',
  });
});

test('older or unstamped cloud settings leave the device alone', () => {
  const local = { bulkAddConcurrency: 20, updatedAt: '2026-10-08T11:00:00Z' };
  assert.equal(applyIncomingSettings(local, { bulkAddConcurrency: 60, updatedAt: '2026-10-08T09:00:00Z' }), null);
  assert.equal(applyIncomingSettings(local, { bulkAddConcurrency: 60 }), null);
  assert.equal(applyIncomingSettings(local, undefined), null);
});

test('a device that never saved settings takes the cloud ones', () => {
  assert.deepEqual(applyIncomingSettings({}, { bulkAddConcurrency: 60, updatedAt: '2026-10-08T09:00:00Z' }),
    { bulkAddConcurrency: 60, updatedAt: '2026-10-08T09:00:00Z' });
});

test('usableModel keeps a model only with the provider it belongs to', () => {
  assert.equal(usableModel({ aiProvider: 'gemini', aiModel: 'gemini-2.5-pro' }), 'gemini-2.5-pro');
  assert.equal(usableModel({ aiProvider: 'gemini', aiModel: 'llama-3.3-70b-versatile' }), 'gemini-2.5-flash');
  assert.equal(usableModel({ aiProvider: 'openai-compatible', aiModel: 'gemini-2.5-flash' }), 'llama-3.3-70b-versatile');
  assert.equal(usableModel({ aiProvider: 'openai-compatible', aiModel: 'google/gemini-2.5-flash' }), 'google/gemini-2.5-flash');
  assert.equal(usableModel({ aiProvider: 'gemini', aiModel: 'gemini-1.5-flash' }), 'gemini-2.5-flash');
  assert.equal(usableModel({ aiProvider: 'openai-compatible', aiModel: 'mixtral-8x7b-32768' }), 'llama-3.3-70b-versatile');
  assert.equal(usableModel({ aiProvider: 'openai-compatible' }), 'llama-3.3-70b-versatile');
});

test('geminiAudioOptions never sends another provider\'s key to Google', () => {
  const groq = geminiAudioOptions({ aiProvider: 'openai-compatible', customApiKey: 'gsk_secret', aiModel: 'llama-3.3-70b-versatile' } as any);
  assert.equal(groq.aiProvider, 'gemini');
  assert.equal(groq.customApiKey, undefined);
  assert.equal(groq.model, 'gemini-2.5-flash');
});
