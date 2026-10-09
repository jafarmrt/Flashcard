export interface Deck {
  id: string;
  name: string;
  isDeleted?: boolean;
  updatedAt?: string; // ISO; the newest rename or delete wins across devices
}

export type PerformanceRating = 'AGAIN' | 'HARD' | 'GOOD' | 'EASY';

export interface StudyLog {
  id?: number; // auto-incremented primary key, local to one device
  uid?: string; // the same on every device; older logs have none
  cardId: string;
  date: string; // YYYY-MM-DD of the review, on the device's calendar
  rating: PerformanceRating;
}

export interface DailyGoal {
  id: string; // e.g., 'study-10'
  type: 'STUDY' | 'QUIZ' | 'STREAK';
  description: string; // e.g., 'Review 10 cards'
  target: number;
  progress: number;
  xp: number;
  isComplete: boolean;
}

export interface UserProfile {
  id: number; // primary key, always 1 for the single user
  firstName?: string;
  lastName?: string;
  bio?: string;
  xp: number;
  level: number;
  lastStreakCheck: string; // ISO date string YYYY-MM-DD
  profileLastUpdated?: string; // ISO string for timestamp
  dailyGoals?: {
    date: string; // YYYY-MM-DD
    goals: DailyGoal[];
    allCompleteAwarded: boolean;
  };
  // Streak freezes: one covers a missed day. Earned grows only while fewer
  // than MAX_HELD_FREEZES are unused; every covered day is kept in frozenDates.
  streakFreezesEarned?: number;
  frozenDates?: string[]; // YYYY-MM-DD (UTC, like StudyLog.date)
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  isSecret?: boolean; // For hidden achievements
}

export interface UserAchievement {
  achievementId: string;
  dateEarned: string; // ISO string
}


// What a card teaches: a single word, a multi-word phrase (phrasal verb,
// collocation), an idiom, or a grammar structure.
export type CardKind = 'word' | 'phrase' | 'idiom' | 'grammar';

// Another common expression the term appears in, e.g. "make a decision".
export interface Collocation {
  phrase: string;
  meaning?: string; // Persian meaning of the whole expression
}

export interface Flashcard {
  id: string;
  deckId: string;
  front: string; // Target Language (English)
  back: string; // Native Language (Persian)
  pronunciation?: string;
  partOfSpeech?: string;
  definition?: string[];
  exampleSentenceTarget?: string[];
  notes?: string;
  kind?: CardKind;
  sourceSentence?: string; // The exact sentence of the source text the term came from
  collocations?: Collocation[];
  grammarPattern?: string; // Grammar cards: the structure, e.g. "had + past participle"
  practicePrompt?: string; // Grammar cards: a sentence-building exercise
  isDeleted?: boolean;
  createdAt: string; // ISO string
  updatedAt?: string; // ISO string for timestamp-based sync

  // Field for audio
  audioSrc?: string; // URL of the audio file

  // Fields for Spaced Repetition System (SRS)
  repetition: number;
  easinessFactor: number;
  interval: number;
  dueDate: string; // ISO string

  // FSRS memory state; absent on cards not yet reviewed with FSRS
  stability?: number; // days until recall probability falls to 90%
  difficulty?: number; // 1 (easy) to 10 (hard)
  lastReviewed?: string; // ISO timestamp
  lapses?: number; // times forgotten after being learned
}

export interface Settings {
    theme: 'light' | 'dark' | 'system';
    defaultApiSource: 'free' | 'mw';
    bulkAddConcurrency?: number;
    bulkAddAiTimeout?: number;
    bulkAddDictTimeout?: number;
    aiProvider?: 'gemini' | 'openai-compatible';
    aiBaseUrl?: string;
    customApiKey?: string;
    aiModel?: string;
    userLevel?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'IELTS' | 'TOEFL';
    extractionSource?: 'ai' | 'free';
    dailyReviewGoal?: number; // reviews per day for the daily goal
    updatedAt?: string; // when settings last changed; the newest wins across devices
}

// A long text the user reads section by section (the "path").
export interface TextDoc {
  id: string;
  title: string;
  chunks: string[]; // sections of at most 300 words
  completed: number[]; // indexes of finished sections
  deckName: string; // cards made from this text go to this deck
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

export interface ExtractedWordCard {
  front: string;
  back: string;
  pronunciation?: string;
  partOfSpeech?: string;
  definition?: string[];
  exampleSentenceTarget?: string[];
  notes?: string;
  kind?: CardKind;
  sourceSentence?: string;
  collocations?: Collocation[];
  grammarPattern?: string;
  practicePrompt?: string;
  audioSrc?: string;
  selected?: boolean;
  alreadyInDeck?: boolean; // A card with the same term already exists
}

export interface StudySessionOptions {
  filter: 'all-due' | 'new' | 'review' | 'all-cards';
  limit: number;
}