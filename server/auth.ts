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

// A sign-in for a name that has no account takes as long as one that has
// (scrypt against a made-up hash), so timing does not tell which names exist.
let dummyHash: Promise<string> | null = null;
export const passwordForUnknownUser = (): Promise<string> => (dummyHash ||= hashPassword(crypto.randomBytes(16).toString('hex')));

// Longer than any real sign-in: refused before the store or scrypt is touched.
export const MAX_USERNAME_LENGTH = 64; // older accounts may predate USERNAME_PATTERN
export const MAX_PASSWORD_LENGTH = 1024;

export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;
export const MIN_PASSWORD_LENGTH = 8;

// This is a one-person app: the first account can always be created, and
// after that registration is closed unless ALLOW_REGISTRATION=true. With
// ALLOW_REGISTRATION=false nobody can register, not even the first account.
export const registrationAllowed = (accountExists: boolean) => {
  const setting = (process.env.ALLOW_REGISTRATION || '').trim().toLowerCase();
  if (setting === 'false') return false;
  if (setting === 'true') return true;
  return !accountExists;
};

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

// A token carries the account's session version: "sign out everywhere"
// raises the version, and every token made before stops opening the account.
// Tokens from before versions existed read as version 0.
export function createSessionToken(username: string, secret: string, now = Date.now(), version = 0): string {
  const expires = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${Buffer.from(username.toLowerCase()).toString('base64url')}.${expires}${version > 0 ? `.${version}` : ''}`;
  return `${payload}.${sign(payload, secret)}`;
}

export interface Session { username: string; version: number }

// The account and version of a valid, unexpired token; null otherwise.
export function verifySession(token: string | undefined, secret: string, now = Date.now()): Session | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 && parts.length !== 4) return null;
  const signature = parts[parts.length - 1];
  const payload = parts.slice(0, -1).join('.');
  const expected = sign(payload, secret);
  if (!safeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const expires = Number(parts[1]);
  if (!Number.isFinite(expires) || expires < now) return null;
  const version = parts.length === 4 ? Number(parts[2]) : 0;
  if (!Number.isSafeInteger(version) || version < 0) return null;
  const username = Buffer.from(parts[0], 'base64url').toString();
  return username.trim() ? { username, version } : null; // older accounts may predate USERNAME_PATTERN
}

// The username of a valid, unexpired token; null otherwise.
export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): string | null {
  return verifySession(token, secret, now)?.username ?? null;
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

export function sessionOf(cookieHeader: string | undefined, secret: string): Session | null {
  return verifySession(readCookie(cookieHeader, SESSION_COOKIE), secret);
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

// Pairs a long-running server has not heard from in LOCK_MS are dropped once
// the map grows, so made-up names do not fill its memory.
const MAX_TRACKED = 10_000;
export function recordLoginFailure(ip: string, username: string, now = Date.now()): void {
  if (failures.size >= MAX_TRACKED) {
    for (const [k, e] of failures) if (now - e.first > LOCK_MS && e.lockedUntil <= now) failures.delete(k);
  }
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

// Failed sign-ins per account, kept in the store: the counts above live in
// one server's memory, and every Vercel instance (and every cold start)
// began again from zero. Twenty failures in fifteen minutes, from any
// address, lock the account's sign-in for fifteen minutes.
export const ACCOUNT_MAX_FAILURES = 20;
export interface FailureRecord { count: number; first: number; lockedUntil: number }

export const accountLockMinutes = (record: FailureRecord | null | undefined, now = Date.now()): number =>
  record && record.lockedUntil > now ? Math.ceil((record.lockedUntil - now) / 60000) : 0;

// How long a failure record matters: after this it is neither a lock nor
// part of a count, and the store may forget it.
export const FAILURE_RECORD_MS = 2 * LOCK_MS;

export const nextFailureRecord = (record: FailureRecord | null | undefined, now = Date.now()): FailureRecord => {
  if (!record || now - record.first > LOCK_MS) return { count: 1, first: now, lockedUntil: 0 };
  const count = record.count + 1;
  return { count, first: record.first, lockedUntil: count >= ACCOUNT_MAX_FAILURES ? now + LOCK_MS : record.lockedUntil };
};

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
