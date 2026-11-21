// File: /services/readingInvite.ts
// An invitation back to the book: where reading stopped, in a few lines.
// The hard part of reading every day is starting, so the start is made
// small and concrete: the last lines read ("where were we?"), the first
// lines of the next section, and how few minutes it takes. Today shows it,
// and the Telegram bot sends it in the morning (and in the evening on a day
// without reading), so the book is begun before the app is even opened.
// Pure: the server and the browser both build it from the account's data.

import type { Chapter, Source } from '../types';
import { currentReading } from './library.js';
import { minutesFor, totalOf, wordsPerMinute } from './readingTime.js';
import { splitSentences, wordCount } from './textChunker.js';

export interface NextReading {
  source: Source;
  chapter: Chapter;
  chunk: number;
  chapterCount: number;
  previous?: Chapter; // the chapter before, when the next section opens a chapter
}

// The unfinished book read most recently, and the section to go on with.
export const nextReading = (sources: Source[], chapters: Chapter[]): NextReading | null => {
  const reading = currentReading(sources, chapters);
  if (!reading?.next) return null;
  const { chapter, chunk } = reading.next;
  const at = reading.list.findIndex(c => c.id === chapter.id);
  return { source: reading.source, chapter, chunk, chapterCount: reading.list.length, ...(chunk === 0 && at > 0 ? { previous: reading.list[at - 1] } : {}) };
};

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();
const cutWords = (text: string, max: number) => text.split(' ').slice(0, max).join(' ');

// The opening of a text: whole sentences up to about `maxWords`; a first
// sentence longer than that is cut, with an ellipsis.
export const firstLines = (text: string, maxWords = 45): string => {
  const sentences = splitSentences(tidy(text));
  const out: string[] = [];
  let words = 0;
  for (const s of sentences) {
    const n = wordCount(s);
    if (out.length > 0 && words + n > maxWords) break;
    out.push(s);
    words += n;
    if (words >= maxWords) break;
  }
  const joined = out.join(' ');
  return wordCount(joined) > maxWords * 1.4 ? `${cutWords(joined, maxWords)} …` : joined;
};

// The close of a text: its last whole sentences, up to about `maxWords`.
export const lastLinesOf = (text: string, maxWords = 35): string => {
  const sentences = splitSentences(tidy(text));
  const out: string[] = [];
  let words = 0;
  for (let i = sentences.length - 1; i >= 0; i--) {
    const n = wordCount(sentences[i]);
    if (out.length > 0 && words + n > maxWords) break;
    out.unshift(sentences[i]);
    words += n;
  }
  const joined = out.join(' ');
  return wordCount(joined) > maxWords * 1.4 ? `… ${joined.split(' ').slice(-maxWords).join(' ')}` : joined;
};

export interface ReadingInvite {
  sourceId: string;
  title: string;
  chapterTitle?: string; // when the book has more than one chapter
  section: number; // 1-based
  sections: number; // of the chapter
  minutes: number; // at the reader's own pace once it is known
  teaser: string; // the first lines of the next section
  before: string; // the last lines read; '' at the very start of a book
}

// `chunks`: the sections of the chapter to read; `previousChunks`: those of
// the chapter before, when the next section is a chapter's first.
export const readingInvite = (next: NextReading, chunks: string[], previousChunks?: string[] | null): ReadingInvite | null => {
  const text = chunks[next.chunk];
  if (!text || !text.trim()) return null;
  const last = next.chunk > 0 ? chunks[next.chunk - 1] : previousChunks?.length ? previousChunks[previousChunks.length - 1] : '';
  return {
    sourceId: next.source.id,
    title: next.source.title,
    ...(next.chapterCount > 1 && next.chapter.title && next.chapter.title !== next.source.title ? { chapterTitle: next.chapter.title } : {}),
    section: next.chunk + 1,
    sections: next.chapter.chunkCount,
    minutes: minutesFor(wordCount(text), wordsPerMinute(totalOf(next.source.reading))),
    teaser: firstLines(text),
    before: last ? lastLinesOf(last) : '',
  };
};

// A section was finished on this local day (YYYY-MM-DD), in any book.
export const readOn = (sources: Source[], day: string): boolean =>
  sources.some(s => !s.isDeleted && (s.reading?.[day]?.sections || 0) > 0);
