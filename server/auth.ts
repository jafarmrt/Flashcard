// File: /server/auth.ts
// Password hashing, signed session cookies, a login rate limit and the audio
// host allow-list. Framework-agnostic: used by server.ts (Express) and
// api/proxy.ts (Vercel).

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// --- Passwords --------------------------------------------------------------

const SCRYPT_KEYLEN = 64;
const SCRYPT_PREFIX = 'scrypt$';

const scrypt = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => (err ? reject(err) : resolve(key)))
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `${SCRYPT_PREFIX}${salt.toString('base64')}$${key.toString('base64')}`;
}

const safeEqual = (a: Buffer, b: Buffer) => a.length === b.length && crypto.timingSafeEqual(a, b);

// `needsRehash` is true for a legacy plain-text password that matched: the
// caller stores the hash instead.
export async function verifyPassword(password: string, stored: string | undefined): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (!stored) return { ok: false, needsRehash: false };
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const [, saltB64, keyB64] = stored.split('$');
    if (!saltB64 || !keyB64) return { ok: false, needsRehash: false };
    const key = await scrypt(password, Buffer.from(saltB64, 'base64'));
    return { ok: safeEqual(key, Buffer.from(keyB64, 'base64')), needsRehash: false };
  }
  const ok = safeEqual(Buffer.from(password), Buffer.from(stored));
  return { ok, needsRehash: ok };
}

export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;
export const MIN_PASSWORD_LENGTH = 8;

// Registration is open unless ALLOW_REGISTRATION=false (set it once your account exists).
export const registrationAllowed = () => (process.env.ALLOW_REGISTRATION || 'true').toLowerCase() !== 'false';

// --- Session cookie ---------------------------------------------------------

export const SESSION_COOKIE = 'lc_session';
export const SESSION_DAYS = 30;

let cachedSecret: string | null = null;

// SESSION_SECRET from the environment, else a random secret kept in
// `<dataDir>/.session_secret` (created once, readable only by the owner).
export function getSessionSecret(dataDir: string = process.cwd()): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return (cachedSecret = fromEnv);
  const file = path.join(dataDir, '.session_secret');
  try {
    const existing = fs.readFileSync(file, 'utf-8').trim();
    if (existing.length >= 32) return (cachedSecret = existing);
  } catch {
    // not created yet
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  try {
    fs.writeFileSync(file, secret, { mode: 0o600 });
  } catch (e) {
    throw new Error('SESSION_SECRET is not set and no secret file can be written. Set SESSION_SECRET (at least 32 characters).');
  }
  return (cachedSecret = secret);
}

const sign = (payload: string, secret: string) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

export function createSessionToken(username: string, secret: string, now = Date.now()): string {
  const expires = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${Buffer.from(username.toLowerCase()).toString('base64url')}.${expires}`;
  return `${payload}.${sign(payload, secret)}`;
}

// The username of a valid, unexpired token; null otherwise.
export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userB64, expiresStr, signature] = parts;
  const expected = sign(`${userB64}.${expiresStr}`, secret);
  if (!safeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < now) return null;
  const username = Buffer.from(userB64, 'base64url').toString();
  return username.trim() ? username : null; // older accounts may predate USERNAME_PATTERN
}

export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

// HttpOnly so page scripts never see it; SameSite=Strict so other sites cannot send it.
export function sessionCookieHeader(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export const clearSessionCookieHeader = (secure: boolean) =>
  [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join('; ');

export function sessionUser(cookieHeader: string | undefined, secret: string): string | null {
  return verifySessionToken(readCookie(cookieHeader, SESSION_COOKIE), secret);
}

// Actions anyone may call; every other action needs a session.
export const PUBLIC_ACTIONS = new Set(['ping', 'ping-free-dict', 'ping-mw', 'auth-login', 'auth-register', 'auth-logout', 'auth-session']);

// --- Login rate limit -------------------------------------------------------

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; first: number; lockedUntil: number }>();

const limitKey = (ip: string, username: string) => `${ip}|${username.toLowerCase()}`;

// Minutes left when this (address, username) pair is locked; 0 when it may try.
export function loginLockMinutes(ip: string, username: string, now = Date.now()): number {
  const entry = failures.get(limitKey(ip, username));
  if (!entry || entry.lockedUntil <= now) return 0;
  return Math.ceil((entry.lockedUntil - now) / 60000);
}

export function recordLoginFailure(ip: string, username: string, now = Date.now()): void {
  const key = limitKey(ip, username);
  const entry = failures.get(key);
  if (!entry || now - entry.first > LOCK_MS) {
    failures.set(key, { count: 1, first: now, lockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) entry.lockedUntil = now + LOCK_MS;
}

export const clearLoginFailures = (ip: string, username: string) => failures.delete(limitKey(ip, username));

// --- Audio proxy allow-list -------------------------------------------------

// Hosts the dictionaries serve pronunciation audio from.
export const AUDIO_HOSTS = new Set(['api.dictionaryapi.dev', 'media.merriam-webster.com', 'ssl.gstatic.com']);

export function isAllowedAudioUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && AUDIO_HOSTS.has(url.hostname) && !url.username && !url.password && (url.port === '' || url.port === '443');
  } catch {
    return false;
  }
}
