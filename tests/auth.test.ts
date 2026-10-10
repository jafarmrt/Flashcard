import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword, verifyPassword, createSessionToken, verifySessionToken, readCookie,
  sessionCookieHeader, sessionUser, SESSION_COOKIE, loginLockMinutes, recordLoginFailure,
  clearLoginFailures, isAllowedAudioUrl, PUBLIC_ACTIONS, registrationAllowed,
} from '../server/auth';
import { aiErrorMessage, cleanAiBaseUrl } from '../server/api';

const SECRET = 'x'.repeat(40);

test('hashed passwords verify and never store the password', async () => {
  const stored = await hashPassword('correct horse');
  assert.ok(stored.startsWith('scrypt$'));
  assert.ok(!stored.includes('correct horse'));
  assert.deepEqual(await verifyPassword('correct horse', stored), { ok: true, needsRehash: false });
  assert.equal((await verifyPassword('wrong horse', stored)).ok, false);
  assert.notEqual(await hashPassword('correct horse'), stored, 'salt differs each time');
});

test('a legacy plain-text password still works once and asks for a rehash', async () => {
  assert.deepEqual(await verifyPassword('oldpass', 'oldpass'), { ok: true, needsRehash: true });
  assert.deepEqual(await verifyPassword('nope', 'oldpass'), { ok: false, needsRehash: false });
  assert.deepEqual(await verifyPassword('x', undefined), { ok: false, needsRehash: false });
});

test('session tokens carry the username and reject tampering and expiry', () => {
  const now = Date.UTC(2026, 0, 1);
  const token = createSessionToken('Jafar', SECRET, now);
  assert.equal(verifySessionToken(token, SECRET, now + 1000), 'jafar');
  assert.equal(verifySessionToken(token, 'y'.repeat(40), now), null, 'other secret');
  const [, expires, sig] = token.split('.');
  const forged = `${Buffer.from('someone').toString('base64url')}.${expires}.${sig}`;
  assert.equal(verifySessionToken(forged, SECRET, now), null, 'swapped username');
  assert.equal(verifySessionToken(token, SECRET, now + 31 * 24 * 3600 * 1000), null, 'expired');
  assert.equal(verifySessionToken('garbage', SECRET, now), null);
  assert.equal(verifySessionToken(undefined, SECRET, now), null);
});

test('the session cookie is HttpOnly and SameSite=Strict, and is read back from the header', () => {
  const token = createSessionToken('jafar', SECRET);
  const header = sessionCookieHeader(token, true);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Secure/);
  assert.doesNotMatch(sessionCookieHeader(token, false), /Secure/);
  const cookie = `theme=dark; ${SESSION_COOKIE}=${encodeURIComponent(token)}; other=1`;
  assert.equal(readCookie(cookie, SESSION_COOKIE), token);
  assert.equal(sessionUser(cookie, SECRET), 'jafar');
  assert.equal(sessionUser('theme=dark', SECRET), null);
  assert.equal(sessionUser(undefined, SECRET), null);
});

test('only ping and auth actions are public', () => {
  for (const action of ['sync-load', 'sync-merge', 'gemini-generate', 'fetch-audio', 'dictionary-lookup', 'test-dictionary']) {
    assert.equal(PUBLIC_ACTIONS.has(action), false, action);
  }
  assert.ok(PUBLIC_ACTIONS.has('auth-login'));
});

test('five failed logins lock that username from that address for 15 minutes', () => {
  const now = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 4; i++) recordLoginFailure('1.2.3.4', 'Jafar', now);
  assert.equal(loginLockMinutes('1.2.3.4', 'jafar', now), 0);
  recordLoginFailure('1.2.3.4', 'jafar', now);
  assert.equal(loginLockMinutes('1.2.3.4', 'jafar', now), 15);
  assert.equal(loginLockMinutes('5.6.7.8', 'jafar', now), 0, 'other address');
  assert.equal(loginLockMinutes('1.2.3.4', 'jafar', now + 16 * 60 * 1000), 0, 'lock expires');
  clearLoginFailures('1.2.3.4', 'jafar');
  assert.equal(loginLockMinutes('1.2.3.4', 'jafar', now), 0);
});

test('the audio proxy only accepts https dictionary hosts', () => {
  assert.ok(isAllowedAudioUrl('https://api.dictionaryapi.dev/media/pronunciations/en/hello-us.mp3'));
  assert.ok(isAllowedAudioUrl('https://media.merriam-webster.com/audio/prons/en/us/mp3/h/hello001.mp3'));
  for (const url of [
    'http://api.dictionaryapi.dev/a.mp3',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost:3000/api',
    'https://api.dictionaryapi.dev.evil.com/a.mp3',
    'https://user:pw@api.dictionaryapi.dev/a.mp3',
    'https://api.dictionaryapi.dev:8443/a.mp3',
    'file:///etc/passwd',
    'not a url',
  ]) {
    assert.equal(isAllowedAudioUrl(url), false, url);
  }
});

test('registration: the first account is allowed, later ones only when ALLOW_REGISTRATION=true', () => {
  const saved = process.env.ALLOW_REGISTRATION;
  try {
    delete process.env.ALLOW_REGISTRATION;
    assert.equal(registrationAllowed(false), true, 'first account');
    assert.equal(registrationAllowed(true), false, 'closed once an account exists');
    process.env.ALLOW_REGISTRATION = 'true';
    assert.equal(registrationAllowed(true), true);
    process.env.ALLOW_REGISTRATION = 'false';
    assert.equal(registrationAllowed(false), false);
  } finally {
    if (saved === undefined) delete process.env.ALLOW_REGISTRATION; else process.env.ALLOW_REGISTRATION = saved;
  }
});

test('AI errors say why they failed', () => {
  assert.equal(
    aiErrorMessage('Gemini', 429, JSON.stringify({ error: { message: 'Resource has been exhausted.' } })),
    'Gemini (429): the free quota is used up for now - Resource has been exhausted.',
  );
  assert.match(aiErrorMessage('api.groq.com', 401, '{"error":{"message":"Invalid API Key"}}'), /key is wrong.*Invalid API Key/);
  assert.equal(aiErrorMessage('Gemini', 500, ''), 'Gemini (500): request failed');
});

test('the AI base URL must be an http(s) address without credentials', () => {
  assert.equal(cleanAiBaseUrl('https://api.groq.com/openai/v1/'), 'https://api.groq.com/openai/v1');
  assert.equal(cleanAiBaseUrl(undefined), 'https://api.groq.com/openai/v1');
  assert.throws(() => cleanAiBaseUrl('file:///etc/passwd'));
  assert.throws(() => cleanAiBaseUrl('not a url'));
  assert.throws(() => cleanAiBaseUrl('https://user:pass@example.com/v1'));
});
