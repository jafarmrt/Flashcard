// File: /services/notes.ts
// The reader's notes on a book: comments on a word, a phrase or a passage,
// and Persian translations kept for later. A note points at the words of
// its section and keeps them as written, so after the text is edited it is
// found again by its words; one whose words are gone is still listed.

import type { TextNote } from '../types';
import { rangeText, type ReaderSection } from './readerText.js';

export type NoteRange = { from: number; to: number };

export const newNote = (
  fields: Pick<TextNote, 'sourceId' | 'chapterId' | 'chunk' | 'kind' | 'from' | 'to' | 'quote' | 'text'> & { by?: string },
  now: Date = new Date(),
  id: string = crypto.randomUUID(),
): TextNote => ({
  id,
  sourceId: fields.sourceId,
  chapterId: fields.chapterId,
  chunk: fields.chunk,
  kind: fields.kind,
  from: Math.min(fields.from, fields.to),
  to: Math.max(fields.from, fields.to),
  quote: fields.quote.replace(/\s+/g, ' ').trim().slice(0, 4000),
  text: fields.text.trim().slice(0, 8000),
  ...(fields.by ? { by: fields.by } : {}),
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});

const WORD = /\p{Script=Latin}+(?:['’-]\p{Script=Latin}+)*/gu;
const plainWord = (w: string) => w.toLowerCase().replace(/’/g, "'");
const quoteWords = (quote: string) => (quote.match(WORD) || []).map(plainWord);

// Where a note's passage is in the section now: where it was made if the
// words are still there, else the place of the same words nearest to it.
export const locateNote = (section: ReaderSection, note: Pick<TextNote, 'from' | 'to' | 'quote'>): NoteRange | null => {
  const wanted = quoteWords(note.quote);
  if (wanted.length === 0) return null;
  const same = (from: number) => wanted.every((w, k) => section.words[from + k] && plainWord(section.words[from + k].text) === w);
  if (note.to - note.from + 1 === wanted.length && same(note.from)) return { from: note.from, to: note.to };
  let best: number | null = null;
  for (let i = 0; i + wanted.length <= section.words.length; i++) {
    if (same(i) && (best === null || Math.abs(i - note.from) < Math.abs(best - note.from))) best = i;
  }
  return best === null ? null : { from: best, to: best + wanted.length - 1 };
};

export interface PlacedNote { note: TextNote; range: NoteRange | null }

// The live notes of one section, each with its place now (null: its words
// were edited away), in reading order.
export const notesOfSection = (section: ReaderSection, notes: TextNote[], chapterId: string, chunk: number): PlacedNote[] =>
  notes
    .filter(n => !n.isDeleted && n.chapterId === chapterId && n.chunk === chunk)
    .map(note => ({ note, range: locateNote(section, note) }))
    .sort((a, b) => (a.range?.from ?? Infinity) - (b.range?.from ?? Infinity) || a.note.createdAt.localeCompare(b.note.createdAt));

// For each word of the section, the notes on it.
export const notesAtWords = (wordCount: number, placed: PlacedNote[]): TextNote[][] => {
  const at: TextNote[][] = Array.from({ length: wordCount }, () => []);
  for (const { note, range } of placed) {
    if (!range) continue;
    for (let i = range.from; i <= range.to && i < wordCount; i++) at[i].push(note);
  }
  return at;
};

// The translation kept for exactly this passage, if any.
export const savedTranslation = (placed: PlacedNote[], range: NoteRange): TextNote | undefined =>
  placed.find(p => p.note.kind === 'translation' && p.range && p.range.from === range.from && p.range.to === range.to)?.note;

export const noteQuote = (section: ReaderSection, range: NoteRange) => rangeText(section, range.from, range.to);

// The notes of a whole book or chapter, in reading order: chapter, section,
// then where in the section.
export const notesInOrder = (notes: TextNote[], chapterOrder: Map<string, number>): TextNote[] =>
  notes
    .filter(n => !n.isDeleted)
    .sort((a, b) => (chapterOrder.get(a.chapterId) ?? 0) - (chapterOrder.get(b.chapterId) ?? 0) || a.chunk - b.chunk || a.from - b.from);

// --- A book's notes on one page, and as a file ---

export interface NotesChapter { id: string; order: number; title: string }

// A book's notes as Markdown: chapter headings, each passage quoted, then
// the comment or the kept translation. Opens in any notes app, prints well.
export const notesMarkdown = (title: string, notes: TextNote[], chapters: NotesChapter[], now: Date = new Date()): string => {
  const order = new Map(chapters.map(c => [c.id, c.order]));
  const names = new Map(chapters.map(c => [c.id, c.title]));
  const lines: string[] = [`# ${title}`, '', `Notes exported ${now.toISOString().slice(0, 10)}`];
  let chapter: string | null = null;
  for (const n of notesInOrder(notes, order)) {
    if (n.chapterId !== chapter && chapters.length > 1) {
      chapter = n.chapterId;
      lines.push('', `## ${names.get(n.chapterId) || `Chapter ${order.get(n.chapterId) ?? ''}`.trim()}`);
    }
    lines.push('', ...n.quote.split('\n').map(l => `> ${l}`), '');
    lines.push(n.kind === 'translation' ? `ترجمه${n.by ? ` (${n.by})` : ''}: ${n.text}` : n.text);
  }
  return `${lines.join('\n')}\n`;
};
