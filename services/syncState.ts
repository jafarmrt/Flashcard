// File: /services/syncState.ts
// Pure helpers for syncing this browser with the account:
//   - a cheap fingerprint of the data, so the automatic sync only runs when
//     something changed since the last one (reloading the merged data used to
//     start a new sync every 2 seconds, forever);
//   - protection for edits made while a sync request is in flight;
//   - study logs keyed the same way on every device.

import type { Deck, Flashcard, StudyLog, TextDoc, UserAchievement, UserProfile } from '../types';

type Row = { id: string };

export interface SyncSnapshotInput {
  cards: Flashcard[];
  decks: Deck[];
  texts: TextDoc[];
  profile: UserProfile | null | undefined;
  achievements: UserAchievement[];
  settingsUpdatedAt?: string;
}

// What identifies one version of a row. Every edit of a card or text stamps
// updatedAt; decks older than updatedAt also count their name and deletion.
export const cardStamp = (c: Flashcard | TextDoc) => `${c.updatedAt || ''}|${c.isDeleted ? 1 : 0}`;
export const deckStamp = (d: Deck) => `${d.updatedAt || ''}|${d.name}|${d.isDeleted ? 1 : 0}`;
export const profileStamp = (p: UserProfile | null | undefined) => (p ? JSON.stringify(p) : '');

const stampAll = <T extends Row>(rows: T[], stamp: (r: T) => string): string =>
  rows.map(r => `${r.id}=${stamp(r)}`).sort().join(',');

export const syncFingerprint = (s: SyncSnapshotInput): string => [
  stampAll(s.cards, cardStamp),
  stampAll(s.decks, deckStamp),
  stampAll(s.texts, cardStamp),
  profileStamp(s.profile),
  s.achievements.map(a => a.achievementId).sort().join(','),
  s.settingsUpdatedAt || '',
].join('#');

export const stampMap = <T extends Row>(rows: T[], stamp: (r: T) => string): Map<string, string> =>
  new Map(rows.map(r => [r.id, stamp(r)]));

// Rows of the merged answer that may be written over local ones: a row that
// changed here while the request was in flight keeps its local version (the
// next sync sends it). `skipped` counts those rows.
export const applicableRows = <T extends Row>(
  merged: T[] | undefined,
  sent: Map<string, string>,
  now: Map<string, string>,
): { rows: T[]; skipped: number } => {
  const rows: T[] = [];
  let skipped = 0;
  for (const row of merged || []) {
    if (now.get(row.id) === sent.get(row.id)) rows.push(row);
    else skipped++;
  }
  return { rows, skipped };
};

// A study log is the same review on every device when its uid matches; logs
// from before uids existed fall back to card, day and rating.
export const studyLogKey = (log: StudyLog): string => log.uid || `${log.cardId}-${log.date}-${log.rating}`;

// Logs from the account that this browser does not have yet, without their
// device-local ids (another device's id 1 is not this device's id 1).
export const newStudyLogs = (local: StudyLog[], incoming: StudyLog[] | undefined): StudyLog[] => {
  const have = new Set(local.map(studyLogKey));
  const out: StudyLog[] = [];
  for (const log of incoming || []) {
    const key = studyLogKey(log);
    if (have.has(key)) continue;
    have.add(key);
    const { id: _deviceId, ...rest } = log;
    out.push(rest);
  }
  return out;
};
