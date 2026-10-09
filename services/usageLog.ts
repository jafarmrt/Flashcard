// File: /services/usageLog.ts
// Every request to an AI service or a free dictionary is noted on this
// device for 30 days, for the usage page: how many went to each service, how
// many failed and why, and roughly how much of the free daily translation
// quota is spent. Nothing here leaves the device.

import type { Flashcard } from '../types';
import { db, type UsageRow } from './localDBService';
import { addDays, dayString } from './streakService';

export type { UsageRow };

export const USAGE_KEEP_DAYS = 30;

// MyMemory's free quota, in characters a day; an email on the server
// (MYMEMORY_EMAIL) raises it about ten times.
export const MYMEMORY_DAILY_CHARS = 5_000;
export const MYMEMORY_DAILY_CHARS_WITH_EMAIL = 50_000;

// Service names of the free lookups; AI services go by their own name.
export const DICTIONARY_SERVICE = 'dictionary';
export const TRANSLATION_SERVICE = 'translation';

// No IndexedDB (tests, old browsers): nothing is noted.
const usageTable = () => (typeof indexedDB === 'undefined' ? null : db.usage);
let pruned = false;

export function logUsage(entry: Omit<UsageRow, 'id' | 'day' | 'at'>, now: Date = new Date()): void {
  const table = usageTable();
  if (!table) return;
  const row: UsageRow = { ...entry, ...(entry.error ? { error: entry.error.slice(0, 300) } : {}), day: dayString(now), at: now.toISOString() };
  table.add(row).catch(e => console.warn('Noting a request failed:', e));
  if (!pruned) {
    pruned = true;
    table.where('day').below(addDays(dayString(now), -(USAGE_KEEP_DAYS - 1))).delete().catch(() => undefined);
  }
}

export const readUsage = async (): Promise<UsageRow[]> => {
  const table = usageTable();
  return table ? table.toArray() : [];
};

export interface ServiceTotals {
  service: string;
  ok: number;
  failed: number;
}

// Requests per service, from `fromDay` on, the busiest first.
export const totalsByService = (rows: UsageRow[], fromDay = ''): ServiceTotals[] => {
  const map = new Map<string, ServiceTotals>();
  for (const row of rows) {
    if (row.day < fromDay) continue;
    const t = map.get(row.service) || { service: row.service, ok: 0, failed: 0 };
    if (row.ok) t.ok++; else t.failed++;
    map.set(row.service, t);
  }
  return [...map.values()].sort((a, b) => b.ok + b.failed - (a.ok + a.failed) || a.service.localeCompare(b.service));
};

// The last `days` days, newest first, each with its requests per service.
export const usageByDay = (rows: UsageRow[], today: string, days = 7): { day: string; services: ServiceTotals[] }[] =>
  Array.from({ length: days }, (_, i) => {
    const day = addDays(today, -i);
    return { day, services: totalsByService(rows.filter(r => r.day === day)) };
  });

export const recentErrors = (rows: UsageRow[], count = 10): UsageRow[] =>
  rows.filter(r => !r.ok && r.error).sort((a, b) => b.at.localeCompare(a.at)).slice(0, count);

// Characters sent for Persian translation on a day: sentences translated,
// and the headword of every dictionary lookup (the server translates it).
// An upper bound: the server's own cache answers some without MyMemory.
export const translationCharsOn = (rows: UsageRow[], day: string): number =>
  rows.reduce((n, r) => (r.day === day && r.ok && (r.service === TRANSLATION_SERVICE || r.service === DICTIONARY_SERVICE) ? n + (r.chars || 0) : n), 0);

// Cards made from `fromDay` on, by who made them: an AI service by name,
// the free dictionaries, the app's grammar rules, by hand or from a file.
export const cardsByMaker = (cards: Flashcard[], fromDay: string): { maker: string; count: number }[] => {
  const map = new Map<string, number>();
  for (const card of cards) {
    if (card.isDeleted) continue;
    const made = card.origin?.at || card.createdAt;
    if (!made || dayString(new Date(made)) < fromDay) continue;
    const o = card.origin;
    const maker = !o ? 'unknown' : o.by === 'ai' ? o.provider || 'AI' : o.by;
    map.set(maker, (map.get(maker) || 0) + 1);
  }
  return [...map.entries()].map(([maker, count]) => ({ maker, count })).sort((a, b) => b.count - a.count);
};
