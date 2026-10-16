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


// What a card teaches: a single word, a phrasal verb or other multi-word
// phrase, a collocation ("make a decision"), an idiom ("spill the beans"), a
// fixed expression ("no wonder"), slang, or a grammar structure.
export type CardKind = 'word' | 'phrase' | 'collocation' | 'idiom' | 'expression' | 'slang' | 'grammar';

// Another common expression the term appears in, e.g. "make a decision".
export interface Collocation {
  phrase: string;
  meaning?: string; // Persian meaning of the whole expression
}

// A word close in meaning, with what sets the two apart (Persian).
export interface Synonym {
  word: string;
  note?: string; // "large is more formal; big is everyday"
}

// Another word of the same family: decide, decision, decisive, indecisive.
export interface WordFamilyMember {
  word: string;
  partOfSpeech?: string;
  meaning?: string; // Persian
}

// The extra sections of a card (services/cardExtras).
export interface CardExtras {
  synonyms?: Synonym[];
  commonMistake?: string; // Persian: a mistake Persian speakers often make with the term
  register?: string; // Persian: formal or informal, British or American, how common
  wordFamily?: WordFamilyMember[];
  wordRoot?: string; // Persian: its root, prefix and suffix
  reference?: string; // Persian: the historical, literary or cultural reference the term or its sentence makes
  extrasAt?: string; // ISO: when an AI was last asked for these
}

// Who filled in a card: an AI (with provider and model), the free
// dictionaries, the user by hand, or a CSV import. Cards made before this was
// recorded have no origin.
export interface CardOrigin {
  by: 'ai' | 'dictionary' | 'manual' | 'import' | 'rules'; // rules: the app's own grammar rules
  provider?: string; // "Gemini", "Groq", "OpenRouter"…
  model?: string;
  at?: string; // ISO
}

export interface Flashcard extends CardExtras {
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
  grammarId?: string; // Grammar cards: the app's rule for the structure (services/grammarPatterns), when known
  level?: CefrLevel; // how advanced the term is, from its frequency or the AI
  origin?: CardOrigin;
  notInDictionary?: boolean; // the free dictionaries did not know the term when the card was made
  checkedAt?: string; // ISO: the user (or an AI check they accepted) confirmed the card is right
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
  leechHelpLapses?: number; // the lapses when a fresh memory aid was last made for it (services/cardExtras)
}

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

// The AI services the app can use. They are tried in the order of
// Settings.aiProviders: when one fails (no quota left, a wrong key), the next.
export type AiProviderId = 'gemini' | 'anthropic' | 'groq' | 'openrouter' | 'deepseek' | 'ollama' | 'custom';

export interface AiProviderSetting {
  id: AiProviderId;
  enabled: boolean;
  model?: string;
  baseUrl?: string; // 'custom' (and a non-default Ollama address)
}

// A dictionary in the order they are tried (services/dictionaryCatalog).
export interface DictionaryEntrySetting {
  id: import('./services/dictionaryCatalog').DictionaryId;
  enabled: boolean;
}

export interface Settings {
    theme: 'light' | 'dark' | 'system';
    dictionaries?: DictionaryEntrySetting[]; // the order they are tried in
    dictKeys?: Partial<Record<import('./services/dictionaryCatalog').DictionaryKeyId, string>>; // kept with the account, encrypted (services/keySync)
    extractKinds?: CardKind[]; // what extraction looks for in a text; all when unset
    bulkAddConcurrency?: number;
    bulkAddAiTimeout?: number;
    bulkAddDictTimeout?: number;
    aiProvider?: 'gemini' | 'openai-compatible';
    aiBaseUrl?: string;
    customApiKey?: string;
    aiModel?: string;
    aiProviders?: AiProviderSetting[]; // the order they are tried in; replaces aiProvider/aiBaseUrl/aiModel
    aiKeys?: Partial<Record<AiProviderId, string>>; // kept with the account, encrypted (services/keySync); replaces customApiKey
    keysChanged?: import('./services/keySync').KeyId[]; // keys typed or removed here that the server does not have yet
    userLevel?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'IELTS' | 'TOEFL';
    extractionSource?: 'ai' | 'free';
    dailyReviewGoal?: number; // reviews per day for the daily goal
    preReadAuto?: boolean; // the reader shows a section's hard words before it
    hideGrammar?: boolean; // the reader does not underline grammar structures
    readAloudVoice?: 'device' | 'ai'; // reading aloud with the device's voice (default) or an AI voice
    aiSpeechProvider?: 'gemini' | 'openrouter'; // the service that makes the AI voice (Gemini by default)
    aiSpeechVoice?: string; // the AI voice (a Gemini voice name)
    aiSpeechModel?: string; // the Gemini text-to-speech model
    orSpeechModel?: string; // the OpenRouter speech model
    orSpeechVoice?: string; // its voice; unset: the model's own default
    readerMode?: 'book' | 'scroll'; // book pages (default) or one scrolling page per section
    readerPaper?: 'cream' | 'white' | 'night'; // the page colour in book mode; unset: cream, night in the dark theme
    readerFontSize?: number; // step 0-4 in book mode (READER_FONT_SIZES)
    readerJustify?: boolean; // justified text in book mode (default on)
    pronunciationService?: 'auto' | 'gemini' | 'openrouter'; // who listens in pronunciation practice; auto: Gemini, then OpenRouter
    orAudioModel?: string; // the OpenRouter model that listens (one that takes audio)
    updatedAt?: string; // when settings last changed; the newest wins across devices
}

// A book, an article or a pasted text in the library. Its words go to one
// deck (by id, so renaming the deck keeps the link).
export type SourceKind = 'book' | 'article' | 'text';

export interface Source {
  id: string;
  kind: SourceKind;
  title: string;
  author?: string;
  url?: string; // where an article came from
  deckId: string;
  position?: { chapterId: string; chunk: number }; // where reading stopped
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

// A chapter of a source. Its text lives apart (ChapterText): it never changes,
// so it is uploaded once instead of travelling with every sync.
export interface Chapter {
  id: string;
  sourceId: string;
  order: number; // 1, 2, 3… within the source
  title: string;
  chunkCount: number; // sections of at most 300 words
  wordCount: number;
  completed: number[]; // indexes of finished sections
  textEditedAt?: string; // when the reader last edited its text: devices with an older copy fetch it again
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

export interface ChapterText {
  id: string; // the chapter's id
  sourceId: string;
  chunks: string[];
  uploaded?: boolean; // this device: the server has a copy
  editedAt?: string; // the edit this copy holds (Chapter.textEditedAt)
}

// Where a card's term was met: one row per card and chapter.
export interface Occurrence {
  id: string; // `${cardId}@${chapterId}`
  cardId: string;
  sourceId: string;
  chapterId: string;
  chunk: number; // section index within the chapter
  sentence?: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

// The reader's own note on a passage of a book: a comment, or a Persian
// translation kept for it. It points at the section's words, and keeps the
// words themselves, so it is found again after the text is edited.
export interface TextNote {
  id: string;
  sourceId: string;
  chapterId: string;
  chunk: number; // section within the chapter
  kind: 'comment' | 'translation';
  from: number; // first and last word of the passage, in the section
  to: number;
  quote: string; // the passage as written
  text: string; // the comment, or the translation
  by?: string; // a translation: the service that made it ("Gemini", "MyMemory")
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

// A term the user already knows: never suggested again, in any book. Ids are
// random so a term removed from the list can be added again (a deleted row
// stays deleted on every device).
export interface KnownWord {
  id: string;
  term: string; // normalized: lower case, single spaces
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

// Before the library: a long text read section by section. Kept only to move
// old texts into the library.
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

export interface ExtractedWordCard extends CardExtras {
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
  grammarId?: string;
  level?: CefrLevel;
  audioSrc?: string;
  origin?: CardOrigin;
  notInDictionary?: boolean;
  selected?: boolean;
  alreadyInDeck?: boolean; // A card with the same term already exists
}

export interface StudySessionOptions {
  filter: 'all-due' | 'new' | 'review' | 'all-cards';
  limit: number;
}
// One spoken try in pronunciation practice, with what the AI heard. Kept
// without the sound itself (too heavy to sync), so the history follows the
// account to every device.
export interface SpeechIssue {
  sound: string; // an id from services/speechPractice SOUNDS ('th-voiceless', 'stress'…)
  word?: string; // the word where it happened
  detail: string; // Persian: what was heard and how to say it
}

// A word of the read text that did not come out right; words without a mark
// were right. `i` counts the text's words from 0 (services/speechPractice
// speechTokens).
export interface SpeechMark {
  i: number;
  status: 'unclear' | 'wrong' | 'missed';
  heard?: string; // how it sounded, in English letters
  sound?: string; // a SOUNDS id
}

// The parts of a sentence's score, each 0-100.
export interface SpeechParts {
  accuracy?: number; // the sounds of the words
  fluency?: number; // smooth, without long pauses, restarts or hesitations
  rhythm?: number; // word and sentence stress, intonation
  completeness?: number; // every word read, none added
}

export interface SpeechAttempt {
  id: string;
  cardId?: string;
  target: string; // the word or sentence that was read aloud
  kind: 'word' | 'sentence';
  score: number; // 0-100
  heard?: string; // what the AI heard, in English
  feedback: string; // Persian summary
  correction?: string; // IPA of the right pronunciation
  issues: SpeechIssue[];
  focus?: string; // the card's word inside a sentence
  focusScore?: number; // how that word alone came out, 0-100
  marks?: SpeechMark[]; // sentence: the words that did not come out right
  parts?: SpeechParts; // sentence: what the score is made of
  tip?: string; // Persian: the one thing to do on the next try
  by?: string; // the service and model that listened ("Gemini · gemini-2.5-flash")
  compact?: true; // an old try kept without its long texts (services/speechPractice)
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}
