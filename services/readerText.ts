// File: /services/readerText.ts
// A reader section as numbered words: each word knows where it is in the
// text and which sentence it belongs to, so several words can be picked by
// dragging over them, a phrase can be marked where it occurs ("took it into
// account" for "take into account"), and a sentence can be picked whole.

import { isFormOf, tokensOf } from './lemma.js';
import { splitSentences } from './textChunker.js';

export interface ReaderWord {
  i: number; // index over the whole section
  text: string;
  start: number; // offsets in the section's text
  end: number;
  sentence: number;
}

export interface ReaderParagraph {
  start: number;
  end: number;
  words: ReaderWord[];
}

export interface ReaderSection {
  text: string;
  paragraphs: ReaderParagraph[];
  words: ReaderWord[];
  sentences: { start: number; end: number; first: number; last: number }[]; // first/last: word indexes
}

const WORD = /\p{Script=Latin}+(?:['’-]\p{Script=Latin}+)*/gu;

// A title or short form the sentence splitter takes for a sentence end.
const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|St|Prof|Sr|Jr|Capt|Col|Gen|Lt|Rev|Mt|vs|etc|e\.g|i\.e)\.$/i;

// Sentences of one paragraph as offsets in it.
const sentenceSpans = (paragraph: string): { start: number; end: number }[] => {
  const spans = rawSentenceSpans(paragraph);
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const prev = merged[merged.length - 1];
    if (prev && ABBREVIATION.test(paragraph.slice(prev.start, prev.end))) prev.end = span.end;
    else merged.push({ ...span });
  }
  return merged;
};

const rawSentenceSpans = (paragraph: string): { start: number; end: number }[] => {
  const Segmenter = (Intl as any).Segmenter;
  const spans: { start: number; end: number }[] = [];
  if (typeof Segmenter === 'function') {
    const segmenter = new Segmenter('en', { granularity: 'sentence' });
    for (const s of segmenter.segment(paragraph) as Iterable<{ segment: string; index: number }>) {
      const lead = s.segment.length - s.segment.trimStart().length;
      const body = s.segment.trim();
      if (body) spans.push({ start: s.index + lead, end: s.index + lead + body.length });
    }
    return spans;
  }
  let cursor = 0;
  for (const sentence of splitSentences(paragraph)) {
    const at = paragraph.indexOf(sentence, cursor);
    if (at < 0) continue;
    spans.push({ start: at, end: at + sentence.length });
    cursor = at + sentence.length;
  }
  return spans;
};

export const readerSection = (text: string): ReaderSection => {
  const section: ReaderSection = { text, paragraphs: [], words: [], sentences: [] };
  const breaks = [...text.matchAll(/\n\s*\n/g)];
  const bounds: [number, number][] = [];
  let from = 0;
  for (const b of breaks) { bounds.push([from, b.index!]); from = b.index! + b[0].length; }
  bounds.push([from, text.length]);

  for (const [start, end] of bounds) {
    const body = text.slice(start, end);
    if (!body.trim()) continue;
    const paragraph: ReaderParagraph = { start, end, words: [] };
    const firstSentence = section.sentences.length;
    const spans = sentenceSpans(body);
    if (spans.length === 0) spans.push({ start: 0, end: body.length });
    for (const span of spans) section.sentences.push({ start: start + span.start, end: start + span.end, first: -1, last: -1 });
    // The sentences cover the paragraph, so each word falls in one of them.
    let s = firstSentence;
    for (const m of body.matchAll(WORD)) {
      const at = start + m.index!;
      while (s < section.sentences.length - 1 && at >= section.sentences[s].end) s++;
      const word: ReaderWord = { i: section.words.length, text: m[0], start: at, end: at + m[0].length, sentence: s };
      const sentence = section.sentences[s];
      if (sentence.first < 0) sentence.first = word.i;
      sentence.last = word.i;
      section.words.push(word);
      paragraph.words.push(word);
    }
    section.paragraphs.push(paragraph);
  }
  section.sentences = section.sentences.filter(s => s.first >= 0);
  // Renumber after dropping sentences without words.
  section.sentences.forEach((s, n) => { for (let i = s.first; i <= s.last; i++) section.words[i].sentence = n; });
  return section;
};

// The text from one word to another, as written (punctuation between kept,
// line breaks made spaces).
export const rangeText = (section: ReaderSection, from: number, to: number): string => {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const first = section.words[a];
  const last = section.words[b];
  if (!first || !last) return '';
  return section.text.slice(first.start, last.end).replace(/\s+/g, ' ').trim();
};

export const sentenceOf = (section: ReaderSection, wordIndex: number): { text: string; first: number; last: number } | null => {
  const word = section.words[wordIndex];
  const sentence = word && section.sentences[word.sentence];
  if (!sentence) return null;
  return { text: section.text.slice(sentence.start, sentence.end).replace(/\s+/g, ' ').trim(), first: sentence.first, last: sentence.last };
};

// Where a term occurs, as word ranges, in any inflected form and with up to
// one word between its parts ("took it into account").
export const phraseRanges = (section: ReaderSection, term: string): [number, number][] => {
  const parts = tokensOf(term.toLowerCase());
  if (parts.length === 0) return [];
  const out: [number, number][] = [];
  const words = section.words;
  for (let start = 0; start < words.length; start++) {
    if (!isFormOf(words[start].text, parts[0])) continue;
    let i = start + 1;
    let ok = true;
    for (let p = 1; p < parts.length && ok; p++) {
      if (i < words.length && !isFormOf(words[i].text, parts[p]) && words[i].sentence === words[start].sentence) i++;
      ok = i < words.length && words[i].sentence === words[start].sentence && isFormOf(words[i].text, parts[p]);
      i++;
    }
    if (ok) out.push([start, i - 1]);
  }
  return out;
};
