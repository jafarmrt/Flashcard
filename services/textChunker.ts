// File: /services/textChunker.ts
// Splits long texts into sections of at most N words, on sentence boundaries,
// so each section can be analysed on its own (AI prompt size, free API limits).

import { isFormOf, tokensOf } from './lemma.js';

export const DEFAULT_CHUNK_WORDS = 300;

const countWords = (text: string): number => (text.match(/\S+/g) || []).length;

const splitSentencesFallback = (paragraph: string): string[] =>
  paragraph
    .split(/(?<=[.!?…])["'”’)\]]*\s+(?=["'“‘(\[]?[A-Z0-9])/)
    .map(s => s.trim())
    .filter(Boolean);

// Splits one paragraph into sentences. Uses Intl.Segmenter where available
// (modern browsers, Node 16+), which handles abbreviations better than a regex.
export const splitSentences = (paragraph: string): string[] => {
  const Segmenter = (Intl as any).Segmenter;
  if (typeof Segmenter === 'function') {
    const segmenter = new Segmenter('en', { granularity: 'sentence' });
    return Array.from(segmenter.segment(paragraph) as Iterable<{ segment: string }>)
      .map(s => s.segment.trim())
      .filter(Boolean);
  }
  return splitSentencesFallback(paragraph);
};

// A single sentence longer than the limit is cut into word slices.
const sliceLongSentence = (sentence: string, maxWords: number): string[] => {
  const words = sentence.split(/\s+/).filter(Boolean);
  const slices: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    slices.push(words.slice(i, i + maxWords).join(' '));
  }
  return slices;
};

// Returns sections of at most `maxWords` words. Sentences are never split unless
// a single sentence is longer than the limit; paragraph breaks are kept.
export const splitIntoChunks = (text: string, maxWords: number = DEFAULT_CHUNK_WORDS): string[] => {
  const limit = Math.max(1, Math.floor(maxWords));
  // Single line breaks inside a paragraph (text copied from a PDF) are not
  // sentence ends: join those lines.
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
    .map(p => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current: string[][] = []; // paragraphs of the current chunk, each a list of sentences
  let currentWords = 0;

  const flush = () => {
    if (currentWords > 0) {
      chunks.push(current.map(p => p.join(' ')).filter(Boolean).join('\n\n'));
    }
    current = [];
    currentWords = 0;
  };

  for (const paragraph of paragraphs) {
    let paragraphStarted = false;
    for (const sentence of splitSentences(paragraph)) {
      for (const piece of sliceLongSentence(sentence, limit)) {
        const words = countWords(piece);
        if (currentWords + words > limit) flush();
        if (!paragraphStarted || current.length === 0) {
          current.push([]);
          paragraphStarted = true;
        }
        current[current.length - 1].push(piece);
        currentWords += words;
      }
    }
  }
  flush();
  return chunks;
};

export const wordCount = countWords;

// Finds the sentence of `text` that contains `term`, matching each word in
// any inflected form ("decided" for "decide", "took" for "take") and allowing
// one word between the parts of a phrase ("take it into account").
export const findSentence = (text: string, term: string): string | undefined => {
  const words = tokensOf(term.toLowerCase());
  if (words.length === 0) return undefined;
  const matchesAt = (tokens: string[], start: number): boolean => {
    let i = start;
    for (let w = 0; w < words.length; w++) {
      if (w > 0 && i < tokens.length && !isFormOf(tokens[i], words[w])) i++; // one word between
      if (i >= tokens.length || !isFormOf(tokens[i], words[w])) return false;
      i++;
    }
    return true;
  };
  for (const paragraph of text.split(/\n\s*\n/)) {
    for (const sentence of splitSentences(paragraph.replace(/\s*\n\s*/g, ' '))) {
      const tokens = tokensOf(sentence);
      for (let start = 0; start < tokens.length; start++) {
        if (matchesAt(tokens, start)) return sentence;
      }
    }
  }
  return undefined;
};
