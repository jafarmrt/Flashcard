// File: /services/extractionPipeline.ts
// Long text -> sections of at most 300 words -> hard items per section (AI, or
// free dictionaries when AI is off or fails) -> one merged list without repeats,
// with terms that already have a card flagged.

import { ExtractedWordCard } from '../types';
import { AiRequestOptions, extractVocabularyFromText } from './geminiService';
import { extractWithFreeDictionaries } from './freeExtractionService';
import { DEFAULT_CHUNK_WORDS, findSentence, splitIntoChunks } from './textChunker';
import { existingTermsInText, markExisting, mergeExtracted, normalizeTerm } from './vocabMerge';

export type ExtractionSource = 'ai' | 'free';

export interface ExtractionProgress {
  done: number; // sections finished
  total: number;
  found: number; // items found so far
  fallbackSections: number; // AI sections that fell back to free dictionaries
}

export interface LongTextExtractionParams {
  text: string;
  level: string;
  perSection: number; // items to extract from each section
  source: ExtractionSource;
  existingFronts: string[];
  includeGrammar?: boolean;
  aiOptions?: AiRequestOptions;
  chunkWords?: number;
  signal?: AbortSignal;
  onProgress?: (p: ExtractionProgress) => void;
  // Test seams
  extractAi?: typeof extractVocabularyFromText;
  extractFree?: typeof extractWithFreeDictionaries;
}

export interface LongTextExtractionResult {
  cards: ExtractedWordCard[];
  sections: number;
  fallbackSections: number;
  failedSections: number;
  stopped: boolean;
}

export const extractFromLongText = async (params: LongTextExtractionParams): Promise<LongTextExtractionResult> => {
  const {
    text, level, perSection, source, existingFronts, includeGrammar = true, aiOptions, signal, onProgress,
    chunkWords = DEFAULT_CHUNK_WORDS,
    extractAi = extractVocabularyFromText,
    extractFree = extractWithFreeDictionaries,
  } = params;

  const sections = splitIntoChunks(text, chunkWords);
  const collected: ExtractedWordCard[] = [];
  let fallbackSections = 0;
  let failedSections = 0;
  let done = 0;

  // Terms found in earlier sections are excluded from later ones too.
  const known = new Set(existingFronts.map(normalizeTerm));

  for (const section of sections) {
    if (signal?.aborted) break;
    const exclude = existingTermsInText(section, known);
    let found: ExtractedWordCard[] = [];

    try {
      if (source === 'ai') {
        try {
          found = await extractAi({ text: section, level, count: perSection, exclude, includeGrammar, options: aiOptions });
        } catch (aiError) {
          if (signal?.aborted) break;
          console.warn('AI extraction failed for a section, using free dictionaries:', aiError);
          fallbackSections++;
          found = await extractFree({ text: section, level, count: perSection, exclude, signal });
        }
      } else {
        found = await extractFree({ text: section, level, count: perSection, exclude, signal });
      }
    } catch (error) {
      console.error('Extraction failed for a section:', error);
      failedSections++;
    }

    for (const card of found) {
      collected.push({ ...card, sourceSentence: card.sourceSentence || findSentence(section, card.front) });
      known.add(normalizeTerm(card.front));
    }
    done++;
    onProgress?.({ done, total: sections.length, found: collected.length, fallbackSections });
  }

  return {
    cards: markExisting(mergeExtracted(collected), existingFronts),
    sections: sections.length,
    fallbackSections,
    failedSections,
    stopped: !!signal?.aborted,
  };
};
