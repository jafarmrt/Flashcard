// File: /services/drivingMode.ts
// Pure logic for Hands-Free Driving Mode ("حالت رانندگی"):
//   1. continuous chapter-and-section progression across a book;
//   2. eyes-free audio flashcard script generation with Persian voice safety
//      (never feeding Persian script into an English-only synthesizer);
//   3. post-drive sentence bookmarks (synced via TextNote with by === 'drive')
//      and tappable candidate words for parking review;
//   4. localized display names for legacy English deck names.

import type { Chapter, Flashcard, Settings, Source, TextNote } from '../types';
import { speechProvider } from './aiSpeech';

export const DRIVE_NOTE_BY = 'drive';

// Maps internal legacy English deck names ("Default Deck", "Imported Deck")
// to clean Persian display titles without mutating database keys expected by
// existing storage/import pipelines.
export const displayDeckName = (name: string): string => {
  const trimmed = (name || '').trim();
  if (trimmed === 'Default Deck') return 'کارت‌های دستی';
  if (trimmed === 'Imported Deck') return 'واردشده';
  return name;
};

export interface BookStepPosition {
  chapter: Chapter;
  chunk: number;
  chapterChanged: boolean;
}

export const orderedBookChapters = (sourceId: string, chapters: readonly Chapter[]): Chapter[] =>
  chapters
    .filter(c => !c.isDeleted && c.sourceId === sourceId)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

// Resolves where continuous book listening starts for a given source.
export const resolveDriveStartPosition = (
  source: Pick<Source, 'id' | 'position'>,
  chapters: readonly Chapter[],
): { chapter: Chapter; chunk: number } | null => {
  const list = orderedBookChapters(source.id, chapters);
  if (list.length === 0) return null;

  if (source.position) {
    const found = list.find(c => c.id === source.position!.chapterId);
    if (found && source.position.chunk >= 0 && source.position.chunk < Math.max(1, found.chunkCount)) {
      return { chapter: found, chunk: source.position.chunk };
    }
  }

  for (const ch of list) {
    const count = Math.max(1, ch.chunkCount);
    for (let i = 0; i < count; i++) {
      if (!ch.completed.includes(i)) return { chapter: ch, chunk: i };
    }
  }
  return { chapter: list[0], chunk: 0 };
};

// Advances to the next section within the current chapter, or chunk 0 of the
// next chapter when a chapter ends. Returns null only at the end of the book.
export const nextBookPosition = (
  sourceId: string,
  chapters: readonly Chapter[],
  chapterId: string,
  chunk: number,
): BookStepPosition | null => {
  const list = orderedBookChapters(sourceId, chapters);
  const idx = list.findIndex(c => c.id === chapterId);
  if (idx < 0) return null;
  const current = list[idx];
  if (chunk + 1 < current.chunkCount) {
    return { chapter: current, chunk: chunk + 1, chapterChanged: false };
  }
  for (let nextIdx = idx + 1; nextIdx < list.length; nextIdx++) {
    const nextChapter = list[nextIdx];
    if (nextChapter.chunkCount > 0) {
      return { chapter: nextChapter, chunk: 0, chapterChanged: true };
    }
  }
  return null;
};

// Steps backward one section (or to the last section of the previous chapter).
export const prevBookPosition = (
  sourceId: string,
  chapters: readonly Chapter[],
  chapterId: string,
  chunk: number,
): BookStepPosition | null => {
  const list = orderedBookChapters(sourceId, chapters);
  const idx = list.findIndex(c => c.id === chapterId);
  if (idx < 0) return null;
  const current = list[idx];
  if (chunk > 0) {
    return { chapter: current, chunk: chunk - 1, chapterChanged: false };
  }
  for (let prevIdx = idx - 1; prevIdx >= 0; prevIdx--) {
    const prevChapter = list[prevIdx];
    if (prevChapter.chunkCount > 0) {
      return { chapter: prevChapter, chunk: prevChapter.chunkCount - 1, chapterChanged: true };
    }
  }
  return null;
};

// Persian meaning can be spoken naturally when either:
//   - AI speech is active with Gemini (multilingual TTS handles Persian well), or
//   - the device exposes a Persian (`fa*`) Web Speech voice.
// OpenRouter's default Kokoro model and English-only Web Speech voices cannot
// pronounce Persian script, so we fall back cleanly to English definitions.
export const canSpeakPersianInDrive = (
  voice: 'device' | 'ai',
  settings: Partial<Settings>,
  hasFaDeviceVoice: boolean,
): boolean => {
  if (voice === 'ai' && speechProvider(settings) === 'gemini') return true;
  return hasFaDeviceVoice;
};

export type CardAudioPhase = 'listen' | 'think' | 'meaning' | 'repeat';

export type CardAudioStep =
  | { kind: 'en'; phase: 'listen' | 'repeat'; text: string; audioSrc?: string; slow?: boolean }
  | { kind: 'pause'; phase: 'think'; ms: number }
  | { kind: 'fa'; phase: 'meaning'; text: string }
  | { kind: 'en-def'; phase: 'meaning'; text: string };

export const pickCardSentence = (
  card: Pick<Flashcard, 'sourceSentence' | 'exampleSentenceTarget'>,
  places?: readonly { sentence?: string }[],
): string | undefined => {
  const fromPlace = places?.find(p => p.sentence?.trim())?.sentence?.trim();
  if (fromPlace) return fromPlace;
  if (card.sourceSentence?.trim()) return card.sourceSentence.trim();
  const ex = card.exampleSentenceTarget?.find(s => s.trim())?.trim();
  return ex || undefined;
};

export const buildCardAudioScript = (
  card: Pick<Flashcard, 'front' | 'back' | 'definition' | 'sourceSentence' | 'exampleSentenceTarget' | 'audioSrc'>,
  places: readonly { sentence?: string }[] | undefined,
  opts: { pauseSeconds: number; canSpeakPersian: boolean },
): CardAudioStep[] => {
  const word = card.front.trim();
  if (!word) return [];

  const steps: CardAudioStep[] = [
    { kind: 'en', phase: 'listen', text: word, audioSrc: card.audioSrc },
  ];

  const sentence = pickCardSentence(card, places);
  if (sentence && sentence.toLowerCase() !== word.toLowerCase()) {
    steps.push({ kind: 'en', phase: 'listen', text: sentence });
  }

  const pauseMs = Math.max(1, Math.min(15, Math.round(opts.pauseSeconds || 5))) * 1000;
  steps.push({ kind: 'pause', phase: 'think', ms: pauseMs });

  const faMeaning = card.back.trim();
  const enDef = card.definition?.find(d => d.trim())?.trim();

  if (opts.canSpeakPersian && faMeaning) {
    steps.push({ kind: 'fa', phase: 'meaning', text: faMeaning });
  } else if (enDef) {
    steps.push({ kind: 'en-def', phase: 'meaning', text: enDef });
  }

  steps.push({
    kind: 'en',
    phase: 'repeat',
    text: word,
    audioSrc: card.audioSrc,
    slow: !opts.canSpeakPersian && !enDef,
  });

  return steps;
};

export const drivingBookmarksOf = (notes: readonly TextNote[]): TextNote[] =>
  notes
    .filter(n => !n.isDeleted && n.by === DRIVE_NOTE_BY && n.quote.trim().length > 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'had', 'has', 'was', 'were',
  'are', 'not', 'but', 'you', 'your', 'his', 'her', 'its', 'they', 'them', 'their', 'she',
  'him', 'who', 'what', 'when', 'where', 'which', 'while', 'into', 'onto', 'upon', 'over',
  'under', 'about', 'after', 'before', 'between', 'through', 'there', 'here', 'then', 'than',
  'very', 'just', 'only', 'also', 'more', 'most', 'some', 'such', 'each', 'other', 'been',
  'being', 'would', 'could', 'should', 'will', 'shall', 'might', 'must', 'said', 'says',
]);

const LATIN_WORD = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

export interface BookmarkWordCandidate {
  word: string;
  normalized: string;
  existingCard?: Flashcard;
}

// Extracts distinct content words from a bookmarked sentence so the user can
// tap a word after parking to inspect its dictionary meaning or turn it into a card.
export const bookmarkCandidateWords = (
  quote: string,
  cards: readonly Flashcard[],
  knownTerms: ReadonlySet<string> = new Set(),
): BookmarkWordCandidate[] => {
  const cardByTerm = new Map<string, Flashcard>();
  for (const c of cards) {
    if (c.isDeleted) continue;
    const key = c.front.trim().toLowerCase();
    if (key && !cardByTerm.has(key)) cardByTerm.set(key, c);
  }

  const matches = quote.match(LATIN_WORD) || [];
  const seen = new Set<string>();
  const out: BookmarkWordCandidate[] = [];

  for (const raw of matches) {
    const clean = raw.replace(/’/g, "'");
    const norm = clean.toLowerCase();
    if (norm.length < 3) continue;
    if (STOP_WORDS.has(norm)) continue;
    if (knownTerms.has(norm) && !cardByTerm.has(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({
      word: clean,
      normalized: norm,
      existingCard: cardByTerm.get(norm),
    });
  }
  return out;
};
