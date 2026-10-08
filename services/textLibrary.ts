import { TextDoc } from '../types';
import { splitIntoChunks } from './textChunker';

export const createTextDoc = (title: string, text: string, now: Date = new Date()): TextDoc => {
  const cleanTitle = title.trim() || text.trim().split(/\s+/).slice(0, 6).join(' ');
  return {
    id: crypto.randomUUID(),
    title: cleanTitle,
    chunks: splitIntoChunks(text.trim()),
    completed: [],
    deckName: cleanTitle,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
};

// The first section not finished yet, or the last one when all are done.
export const currentChunk = (doc: TextDoc): number => {
  for (let i = 0; i < doc.chunks.length; i++) {
    if (!doc.completed.includes(i)) return i;
  }
  return Math.max(0, doc.chunks.length - 1);
};

export const isTextFinished = (doc: TextDoc): boolean => doc.completed.length >= doc.chunks.length;

// Sections open to read: finished ones and the current one. Later ones stay locked.
export const isChunkUnlocked = (doc: TextDoc, index: number): boolean =>
  doc.completed.includes(index) || index <= currentChunk(doc);

export const completeChunk = (doc: TextDoc, index: number, now: Date = new Date()): { doc: TextDoc; firstTime: boolean } => {
  if (doc.completed.includes(index)) return { doc, firstTime: false };
  return {
    doc: { ...doc, completed: [...doc.completed, index].sort((a, b) => a - b), updatedAt: now.toISOString() },
    firstTime: true,
  };
};

export const textWordCount = (doc: TextDoc): number =>
  doc.chunks.reduce((sum, c) => sum + c.split(/\s+/).filter(Boolean).length, 0);
