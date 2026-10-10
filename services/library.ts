// File: /services/library.ts
// The library: books, articles and texts, each with chapters read section by
// section, and the places (occurrences) where a card's term was met. Pure
// functions shared by the browser and the server.

import type { CardOrigin, Chapter, ChapterText, Deck, Flashcard, Occurrence, Source, SourceKind, TextDoc } from '../types';
import { findSentence, splitIntoChunks, wordCount } from './textChunker.js';
import { lemmaCandidates, termWords, tokensOf } from './lemma.js';
import { normalizeTerm } from './vocabMerge.js';
import { BOOK_COMPLETE_XP, CHAPTER_COMPLETE_XP, CHUNK_COMPLETE_XP } from './xpRules.js';

export interface ChapterInput {
  title: string;
  text: string;
}

export interface SourceInput {
  kind: SourceKind;
  title: string;
  author?: string;
  url?: string;
  deckId: string;
  chapters: ChapterInput[];
}

export interface NewSource {
  source: Source;
  chapters: Chapter[];
  texts: ChapterText[];
}

export const chapterIdFor = (sourceId: string, order: number) => `${sourceId}-c${order}`;
export const occurrenceId = (cardId: string, chapterId: string) => `${cardId}@${chapterId}`;

const firstWords = (text: string, n = 6) => text.trim().split(/\s+/).slice(0, n).join(' ');

// A new source; chapters without text are left out.
export const buildSource = (input: SourceInput, now: Date = new Date(), id: string = crypto.randomUUID()): NewSource => {
  const at = now.toISOString();
  const title = input.title.trim() || firstWords(input.chapters.map(c => c.text).join(' ')) || 'Untitled';
  const chapters: Chapter[] = [];
  const texts: ChapterText[] = [];
  for (const input_ of input.chapters) {
    const chunks = splitIntoChunks(input_.text.trim());
    if (chunks.length === 0) continue;
    const order = chapters.length + 1;
    const chapterId = chapterIdFor(id, order);
    chapters.push({
      id: chapterId,
      sourceId: id,
      order,
      title: input_.title.trim() || (input.chapters.length === 1 ? title : `Chapter ${order}`),
      chunkCount: chunks.length,
      wordCount: chunks.reduce((sum, c) => sum + wordCount(c), 0),
      completed: [],
      createdAt: at,
      updatedAt: at,
    });
    texts.push({ id: chapterId, sourceId: id, chunks });
  }
  const source: Source = {
    id,
    kind: input.kind,
    title,
    ...(input.author?.trim() ? { author: input.author.trim() } : {}),
    ...(input.url ? { url: input.url } : {}),
    deckId: input.deckId,
    createdAt: at,
    updatedAt: at,
  };
  return { source, chapters, texts };
};

// Chapters of a source in reading order, without deleted ones.
export const chaptersOf = (sourceId: string, chapters: Chapter[]): Chapter[] =>
  chapters.filter(c => c.sourceId === sourceId && !c.isDeleted).sort((a, b) => a.order - b.order);

export const isChapterFinished = (c: Chapter) => c.completed.length >= c.chunkCount;

// A book (not an article or a pasted text) with every chapter read. The
// "book finished" bonus and badge both use this.
export const isBookFinished = (source: Pick<Source, 'id' | 'kind'>, chapters: Chapter[]): boolean => {
  if (source.kind !== 'book') return false;
  const list = chaptersOf(source.id, chapters);
  return list.length > 0 && list.every(isChapterFinished);
};

// What a finished section earns: its own XP, plus a bonus when it was the
// last of its chapter, and another when that chapter was the last of a book.
export const sectionReward = (chapter: Chapter, source: Pick<Source, 'id' | 'kind'> | undefined, chapters: Chapter[]) => {
  const chapterDone = isChapterFinished(chapter);
  const bookDone = chapterDone && !!source && isBookFinished(source, chapters.map(c => (c.id === chapter.id ? chapter : c)));
  const xp = CHUNK_COMPLETE_XP + (chapterDone ? CHAPTER_COMPLETE_XP : 0) + (bookDone ? BOOK_COMPLETE_XP : 0);
  return { chapterDone, bookDone, xp };
};

// The first section not finished yet, or the last one when all are done.
export const currentChunkOf = (c: Chapter): number => {
  for (let i = 0; i < c.chunkCount; i++) if (!c.completed.includes(i)) return i;
  return Math.max(0, c.chunkCount - 1);
};

// Sections open to read: finished ones and the current one. Later ones stay locked.
export const isChunkOpen = (c: Chapter, index: number): boolean =>
  c.completed.includes(index) || index <= currentChunkOf(c);

export const markChunkDone = (c: Chapter, index: number, now: Date = new Date()): { chapter: Chapter; firstTime: boolean } => {
  if (c.completed.includes(index)) return { chapter: c, firstTime: false };
  return {
    chapter: { ...c, completed: [...c.completed, index].sort((a, b) => a - b), updatedAt: now.toISOString() },
    firstTime: true,
  };
};

export interface SourceProgress {
  sections: number;
  done: number;
  words: number;
  percent: number;
  finished: boolean;
}

export const sourceProgress = (chapters: Chapter[]): SourceProgress => {
  const sections = chapters.reduce((s, c) => s + c.chunkCount, 0);
  const done = chapters.reduce((s, c) => s + Math.min(c.completed.length, c.chunkCount), 0);
  return {
    sections,
    done,
    words: chapters.reduce((s, c) => s + c.wordCount, 0),
    percent: sections ? Math.round((done / sections) * 100) : 0,
    finished: sections > 0 && done >= sections,
  };
};

// Where to continue: the saved position when it is still open, else the first
// unfinished section of the first unfinished chapter.
export const continuePoint = (source: Source, chapters: Chapter[]): { chapter: Chapter; chunk: number } | null => {
  const list = chaptersOf(source.id, chapters);
  if (list.length === 0) return null;
  const saved = source.position && list.find(c => c.id === source.position!.chapterId);
  if (saved && !saved.completed.includes(source.position!.chunk) && source.position!.chunk < saved.chunkCount) {
    return { chapter: saved, chunk: source.position!.chunk };
  }
  const next = list.find(c => !isChapterFinished(c)) || list[list.length - 1];
  return { chapter: next, chunk: currentChunkOf(next) };
};

// --- Cards met in several places ---

// Existing cards by every key a term can be matched under: the term itself
// and, for single words, its base forms ("decided" finds "decide").
export const cardIndex = (cards: Flashcard[]): Map<string, Flashcard> => {
  const map = new Map<string, Flashcard>();
  for (const card of cards) {
    if (card.isDeleted) continue;
    const key = normalizeTerm(card.front);
    if (key && !map.has(key)) map.set(key, card);
  }
  return map;
};

export const findCard = (term: string, index: Map<string, Flashcard>): Flashcard | undefined => {
  const key = normalizeTerm(term);
  if (!key) return undefined;
  const direct = index.get(key);
  if (direct || key.includes(' ')) return direct;
  for (const form of lemmaCandidates(key)) {
    const hit = index.get(normalizeTerm(form));
    if (hit) return hit;
  }
  return undefined;
};

export const newOccurrence = (
  card: Pick<Flashcard, 'id'>, chapter: Pick<Chapter, 'id' | 'sourceId'>, chunk: number, sentence: string | undefined, now: Date = new Date(),
): Occurrence => ({
  id: occurrenceId(card.id, chapter.id),
  cardId: card.id,
  sourceId: chapter.sourceId,
  chapterId: chapter.id,
  chunk,
  ...(sentence ? { sentence } : {}),
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});

// Cards whose term is in a text, in any form ("decided" for "decide", "took
// it into account" for "take into account"), with the sentence it is in.
// Grammar cards are left out: their front is a pattern, not words to find.
export const cardsInText = <T extends Pick<Flashcard, 'front' | 'kind' | 'isDeleted'>>(text: string, cards: T[]): { card: T; sentence: string }[] => {
  const forms = new Set<string>();
  for (const token of tokensOf(text)) for (const form of lemmaCandidates(token)) forms.add(form);
  const out: { card: T; sentence: string }[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    if (card.isDeleted || card.kind === 'grammar') continue;
    const key = normalizeTerm(card.front);
    const first = termWords(key)[0];
    if (!first || seen.has(key) || !forms.has(first.toLowerCase())) continue;
    const sentence = findSentence(text, key);
    if (!sentence) continue;
    seen.add(key);
    out.push({ card, sentence });
  }
  return out;
};

// Sources each card was met in, without deleted rows.
export const sourcesByCard = (occurrences: Occurrence[]): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>();
  for (const o of occurrences) {
    if (o.isDeleted) continue;
    let set = map.get(o.cardId);
    if (!set) map.set(o.cardId, (set = new Set()));
    set.add(o.sourceId);
  }
  return map;
};

// Where each card was met, for showing on the card: the source's title, the
// chapter's title when the source has more than one, and the sentence.
export interface CardPlace {
  sourceId: string;
  sourceTitle: string;
  chapterTitle?: string;
  chapterOrder?: number;
  sentence?: string;
}

export const placesByCard = (occurrences: Occurrence[], sources: Source[], chapters: Chapter[]): Map<string, CardPlace[]> => {
  const sourceById = new Map(sources.filter(s => !s.isDeleted).map(s => [s.id, s]));
  const chapterById = new Map(chapters.map(c => [c.id, c]));
  const chapterCount = new Map<string, number>();
  for (const c of chapters) if (!c.isDeleted) chapterCount.set(c.sourceId, (chapterCount.get(c.sourceId) || 0) + 1);
  const map = new Map<string, CardPlace[]>();
  const sorted = [...occurrences].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const o of sorted) {
    const source = sourceById.get(o.sourceId);
    if (o.isDeleted || !source) continue;
    const chapter = chapterById.get(o.chapterId);
    const many = (chapterCount.get(o.sourceId) || 0) > 1;
    const place: CardPlace = {
      sourceId: source.id,
      sourceTitle: source.title,
      ...(many && chapter ? { chapterTitle: chapter.title, chapterOrder: chapter.order } : {}),
      ...(o.sentence ? { sentence: o.sentence } : {}),
    };
    let list = map.get(o.cardId);
    if (!list) map.set(o.cardId, (list = []));
    list.push(place);
  }
  return map;
};

// Who made a card, in a few words: "Gemini · gemini-2.5-flash", "دیکشنری رایگان".
export const originText = (origin?: CardOrigin): string | null => {
  if (!origin) return null;
  switch (origin.by) {
    case 'ai': return [origin.provider || 'AI', origin.model].filter(Boolean).join(' · ');
    case 'dictionary': return origin.provider || 'دیکشنری رایگان';
    case 'manual': return 'دستی';
    case 'import': return 'فایل CSV';
    case 'rules': return 'قاعده‌های برنامه';
    default: return null;
  }
};

// --- Moving texts from before the library ---

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// Where in the text a card's term was met: its saved sentence when the text
// holds it, else the first sentence using the term.
const placeInText = (card: Flashcard, chunks: string[]): { chunk: number; sentence?: string } | null => {
  if (card.sourceSentence) {
    const wanted = squash(card.sourceSentence);
    const i = chunks.findIndex(c => squash(c).includes(wanted));
    if (i >= 0) return { chunk: i, sentence: card.sourceSentence };
  }
  for (let i = 0; i < chunks.length; i++) {
    const sentence = findSentence(chunks[i], card.front);
    if (sentence) return { chunk: i, sentence };
  }
  return null;
};

export interface MigratedTexts {
  sources: Source[];
  chapters: Chapter[];
  chapterTexts: ChapterText[];
  occurrences: Occurrence[];
}

// Each old text becomes a one-chapter source with the same id, linked to the
// deck of its name, and the deck's cards whose term is in the text get an
// occurrence. The ids and dates come from the text and the cards only, so the
// browser and the server, migrating apart, make the same rows.
export const migrateTexts = (texts: TextDoc[], decks: Deck[], cards: Flashcard[]): MigratedTexts => {
  const out: MigratedTexts = { sources: [], chapters: [], chapterTexts: [], occurrences: [] };
  const deckByName = new Map<string, Deck>();
  for (const d of decks) if (!d.isDeleted && !deckByName.has(d.name.trim().toLowerCase())) deckByName.set(d.name.trim().toLowerCase(), d);

  for (const text of texts) {
    if (!text || !text.id || !Array.isArray(text.chunks)) continue;
    const deck = deckByName.get((text.deckName || text.title || '').trim().toLowerCase());
    const deleted = !!text.isDeleted;
    const updatedAt = text.updatedAt || text.createdAt || new Date(0).toISOString();
    const createdAt = text.createdAt || updatedAt;
    const chapterId = chapterIdFor(text.id, 1);
    out.sources.push({
      id: text.id, kind: 'text', title: text.title || 'Untitled', deckId: deck?.id || '',
      createdAt, updatedAt, ...(deleted ? { isDeleted: true } : {}),
    });
    out.chapters.push({
      id: chapterId, sourceId: text.id, order: 1, title: text.title || 'Untitled',
      chunkCount: text.chunks.length,
      wordCount: text.chunks.reduce((s, c) => s + wordCount(c), 0),
      completed: [...(text.completed || [])].sort((a, b) => a - b),
      createdAt, updatedAt, ...(deleted ? { isDeleted: true } : {}),
    });
    if (deleted) continue;
    out.chapterTexts.push({ id: chapterId, sourceId: text.id, chunks: text.chunks });
    if (!deck) continue;
    for (const card of cards) {
      if (card.deckId !== deck.id || card.isDeleted) continue;
      const place = placeInText(card, text.chunks);
      if (!place) continue;
      out.occurrences.push({
        id: occurrenceId(card.id, chapterId), cardId: card.id, sourceId: text.id, chapterId,
        chunk: place.chunk, ...(place.sentence ? { sentence: place.sentence } : {}),
        createdAt: card.createdAt || createdAt, updatedAt,
      });
    }
  }
  return out;
};
