// File: /server/keyVault.ts
// The account's AI and dictionary keys, kept encrypted (AES-256-GCM) under
// their own record, never in the user record or the synced settings. The
// encryption key is derived from SESSION_SECRET (or the server's secret
// file), so a copy of the data store alone does not reveal them. A record
// that no longer decrypts (the secret was changed) counts as empty: every
// device sends its keys again with its next sync.

import crypto from 'crypto';
import { Buffer } from 'buffer';
import type { KeyEntries } from '../services/keySync.js';
import { cleanKeyEntries } from '../services/keySync.js';

export interface SealedKeys { v: 1; iv: string; tag: string; data: string }

const vaultKey = (secret: string) =>
  Buffer.from(crypto.hkdfSync('sha256', secret, 'lingua-cards', 'account api keys v1', 32));

export function sealKeys(entries: KeyEntries, secret: string): SealedKeys {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey(secret), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(entries), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function openKeys(sealed: unknown, secret: string): KeyEntries {
  const s = sealed as SealedKeys | null;
  if (!s || s.v !== 1 || typeof s.iv !== 'string' || typeof s.tag !== 'string' || typeof s.data !== 'string') return {};
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey(secret), Buffer.from(s.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(s.tag, 'base64'));
    const text = Buffer.concat([decipher.update(Buffer.from(s.data, 'base64')), decipher.final()]).toString('utf8');
    return cleanKeyEntries(JSON.parse(text), Number.MAX_SAFE_INTEGER);
  } catch {
    return {};
  }
}
