// File: /services/extractionPipeline.ts
// Long text -> sections of at most 300 words -> hard items per section (AI, or
// free dictionaries when AI is off or fails) -> one merged list without repeats,
// with terms that already have a card flagged.

import { ExtractedWordCard } from '../types';
import { ProxyError } from './apiService';
import { AiRequestOptions, extractVocabularyFromText } from './geminiService';
import { aiOrigin, dictionaryOrigin } from './aiSettings';
import { extractWithFreeDictionaries } from './freeExtractionService';
import { DEFAULT_CHUNK_WORDS, findSentence, splitIntoChunks } from './textChunker';
import { existingTermsInText, markExisting, mergeExtracted, normalizeTerm } from './vocabMerge';
import { isKnownTerm, knownFormsInText } from './knownWords';

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
  knownTerms?: string[]; // the "I know it" list: never suggested, in any form
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
  aiError?: string; // why the AI failed, when it did
}

// A wrong key, a missing key or an unknown model fails the same way for every
// section: after the first one, go straight to the free dictionaries.
const PERMANENT_AI_STATUS = new Set([400, 401, 403, 404]);
export const isPermanentAiError = (error: unknown) =>
  error instanceof ProxyError && PERMANENT_AI_STATUS.has(error.status);

export const extractFromLongText = async (params: LongTextExtractionParams): Promise<LongTextExtractionResult> => {
  const {
    text, level, perSection, source, existingFronts, knownTerms = [], includeGrammar = true, aiOptions, signal, onProgress,
    chunkWords = DEFAULT_CHUNK_WORDS,
    extractAi = extractVocabularyFromText,
    extractFree = extractWithFreeDictionaries,
  } = params;

  const sections = splitIntoChunks(text, chunkWords);
  const collected: ExtractedWordCard[] = [];
  let fallbackSections = 0;
  let failedSections = 0;
  let done = 0;
  let aiError: string | undefined;
  let aiDisabled = false;

  // Terms found in earlier sections are excluded from later ones too.
  const known = new Set(existingFronts.map(normalizeTerm));
  const userKnows = new Set(knownTerms.map(normalizeTerm));

  for (const section of sections) {
    if (signal?.aborted) break;
    const exclude = [...existingTermsInText(section, known), ...knownFormsInText(section, userKnows)];
    let found: ExtractedWordCard[] = [];
    let byAi = false;

    try {
      if (source === 'ai' && !aiDisabled) {
        try {
          found = await extractAi({ text: section, level, count: perSection, exclude, includeGrammar, options: aiOptions });
          byAi = true;
        } catch (error) {
          if (signal?.aborted) break;
          console.warn('AI extraction failed for a section, using free dictionaries:', error);
          aiError = aiError || (error as Error)?.message || 'AI request failed';
          if (isPermanentAiError(error)) aiDisabled = true;
          fallbackSections++;
          found = await extractFree({ text: section, level, count: perSection, exclude, signal });
        }
      } else if (source === 'ai') {
        fallbackSections++;
        found = await extractFree({ text: section, level, count: perSection, exclude, signal });
      } else {
        found = await extractFree({ text: section, level, count: perSection, exclude, signal });
      }
    } catch (error) {
      console.error('Extraction failed for a section:', error);
      failedSections++;
    }

    const origin = byAi ? aiOrigin(aiOptions) : dictionaryOrigin();
    for (const card of found) {
      if (card.kind !== 'grammar' && isKnownTerm(card.front, userKnows)) continue;
      collected.push({ ...card, origin: card.origin || origin, sourceSentence: card.sourceSentence || findSentence(section, card.front) });
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
    aiError,
  };
};
