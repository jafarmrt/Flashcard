// A chapter's text as the server keeps it: its sections compressed, so a
// whole book fits in the free cloud storage. Texts saved before compression
// (with plain `chunks`) are still read.

import { Buffer } from 'buffer';
import { gunzipSync, gzipSync } from 'zlib';

export interface StoredChapter {
  id: string;
  sourceId: string;
  gz?: string; // base64 of the gzipped JSON list of sections
  chunks?: string[]; // texts saved before compression
}

export const packChapter = (text: { id: string; sourceId: string; chunks: string[] }): StoredChapter => ({
  id: text.id,
  sourceId: text.sourceId,
  gz: gzipSync(JSON.stringify(text.chunks), { level: 9 }).toString('base64'),
});

export const unpackChapter = (stored: StoredChapter): { id: string; sourceId: string; chunks: string[] } => ({
  id: stored.id,
  sourceId: stored.sourceId,
  chunks: stored.gz ? JSON.parse(gunzipSync(Buffer.from(stored.gz, 'base64')).toString('utf-8')) : stored.chunks || [],
});
