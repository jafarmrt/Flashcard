// File: /services/extractionPipeline.ts
// Long text -> sections of at most 300 words -> hard items per section (AI, or
// free dictionaries when AI is off or fails) -> one merged list without repeats,
// with terms that already have a card flagged.

import { CardKind, ExtractedWordCard } from '../types';
import { AiRequestOptions, extractVocabularyFromText } from './geminiService';
import { isPermanentAiError } from './aiClient';
import { aiOrigin, dictionaryOrigin } from './aiSettings';
import { extractWithFreeDictionaries } from './freeExtractionService';
import { DEFAULT_CHUNK_WORDS, findSentence, splitIntoChunks } from './textChunker';
import { existingTermsInText, markExisting, mergeExtracted, normalizeTerm } from './vocabMerge';
import { isKnownTerm, knownFormsInText } from './knownWords';
import { ruleCardsInText } from './grammarCards';
import { ruleForName } from './grammarPatterns';

// Without AI, the app's grammar rules add a few structures per section.
export const RULE_GRAMMAR_PER_SECTION = 2;

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
  knownRuleIds?: Iterable<string>; // structures that already have a card, when the caller knows
  knownTerms?: string[]; // the "I know it" list: never suggested, in any form
  includeGrammar?: boolean;
  kinds?: CardKind[]; // what the AI looks for (services/cardKinds); all when unset
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

// A wrong key, a missing key or an unknown model (on every service set up)
// fails the same way for every section: after the first one, go straight to
// the free dictionaries.
export { isPermanentAiError };

export const extractFromLongText = async (params: LongTextExtractionParams): Promise<LongTextExtractionResult> => {
  const {
    text, level, perSection, source, existingFronts, knownRuleIds, knownTerms = [], kinds, aiOptions, signal, onProgress,
    chunkWords = DEFAULT_CHUNK_WORDS,
    extractAi = extractVocabularyFromText,
    extractFree = extractWithFreeDictionaries,
  } = params;
  // Grammar switched off in the settings is off here too.
  const includeGrammar = (params.includeGrammar ?? true) && (!kinds || kinds.includes('grammar'));

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
  // Structures that already have a card (an AI may have named one its own
  // way). Without the caller's list, only fronts that read like a structure's
  // name count, so a word card such as "used to" does not hide a rule.
  const knownRules = new Set(knownRuleIds ?? existingFronts
    .filter(front => /^[A-Z]/.test(front) && /\s/.test(front.trim()))
    .map(front => ruleForName(front)?.id)
    .filter((id): id is string => !!id));

  for (const section of sections) {
    if (signal?.aborted) break;
    const exclude = [...existingTermsInText(section, known), ...knownFormsInText(section, userKnows)];
    let found: ExtractedWordCard[] = [];
    let byAi = false;

    try {
      if (source === 'ai' && !aiDisabled) {
        try {
          found = await extractAi({ text: section, level, count: perSection, exclude, includeGrammar, kinds, options: aiOptions });
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

    if (includeGrammar && !byAi) {
      const rules = ruleCardsInText(section, RULE_GRAMMAR_PER_SECTION, knownRules);
      rules.forEach(card => card.grammarId && knownRules.add(card.grammarId));
      found = [...found, ...rules.filter(card => !known.has(normalizeTerm(card.front)))];
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
