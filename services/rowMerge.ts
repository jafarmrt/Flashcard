// File: /services/rowMerge.ts
// How two versions of one synced row become one. The server merges what a
// device sends with what it holds; a device merges a row it changed but has
// not sent yet with the server's newer copy, by the same rule, so both ends
// agree whichever order the changes arrive in.

import { mergeReading } from './readingTime.js';

type Row = { id: string; updatedAt?: string; isDeleted?: boolean; [key: string]: any };

const time = (iso?: string) => new Date(iso || 0).getTime() || 0;

// The newer edit wins (the device's on a tie), a row deleted anywhere stays
// deleted, a section finished anywhere stays finished, and minutes read on
// either device are kept.
export const mergeRow = (table: string, cloud: Row | undefined, client: Row): Row => {
  if (!cloud) return client;
  const winner = time(client.updatedAt) >= time(cloud.updatedAt) ? client : cloud;
  const merged: Row = { ...winner };
  if (cloud.isDeleted || client.isDeleted) merged.isDeleted = true;
  if (table === 'chapters') {
    const done = new Set<number>([...(cloud.completed || []), ...(client.completed || [])]);
    merged.completed = Array.from(done).sort((a, b) => a - b);
  }
  if (table === 'sources') {
    if (cloud.reading || client.reading) merged.reading = mergeReading(cloud.reading, client.reading);
    if (cloud.audioPosition || client.audioPosition) {
      const ca = cloud.audioPosition;
      const cla = client.audioPosition;
      merged.audioPosition = !ca ? cla : !cla ? ca : time(cla.updatedAt) >= time(ca.updatedAt) ? cla : ca;
    }
  }
  return merged;
};
