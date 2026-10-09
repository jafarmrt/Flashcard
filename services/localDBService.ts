import Dexie, { type Table } from 'dexie';
import { Flashcard, Deck, StudyLog, UserProfile, UserAchievement, TextDoc, Source, Chapter, ChapterText, Occurrence, KnownWord } from '../types';

// Small values this browser keeps for itself, such as how far it has synced.
export interface MetaRow {
  key: string;
  value: any;
}

// A word looked up in the free dictionaries, kept so a second tap is instant
// and works offline (services/lookupCache).
export interface LookupRow {
  term: string;
  value: any;
  until: number; // ms; asked again after this
}

// One request to an outside service, for the usage page (services/usageLog).
// Kept on this device for 30 days, never synced.
export interface UsageRow {
  id?: number;
  day: string; // YYYY-MM-DD on this device's calendar
  at: string; // ISO
  service: string; // "Gemini", "Groq", "dictionary", "translation"
  task: string; // what it was for: "extract", "sense", "grammar"…
  ok: boolean;
  status?: number;
  error?: string;
  chars?: number; // characters sent for translation (the free daily quota counts them)
}

export class LinguaCardsDB extends Dexie {
  flashcards!: Table<Flashcard>; 
  decks!: Table<Deck>;
  studyHistory!: Table<StudyLog>;
  userProfile!: Table<UserProfile>;
  userAchievements!: Table<UserAchievement>;
  texts!: Table<TextDoc>;
  sources!: Table<Source>;
  chapters!: Table<Chapter>;
  chapterTexts!: Table<ChapterText>;
  occurrences!: Table<Occurrence>;
  meta!: Table<MetaRow>;
  knownWords!: Table<KnownWord>;
  lookups!: Table<LookupRow>;
  usage!: Table<UsageRow>;

  constructor() {
    super('LinguaCardsDB');
    
    // Version 1 Schema (Original)
    (this as any).version(1).stores({
      flashcards: 'id, deckId, front, back, dueDate',
      decks: 'id, name',
    });
    
    // Version 2 Schema (Adds studyHistory)
    (this as any).version(2).stores({
      flashcards: 'id, deckId, front, back, dueDate',
      decks: 'id, name',
      studyHistory: '++id, cardId, date'
    }).upgrade((tx: any) => {
      console.log("Upgrading database to version 2, adding studyHistory table.");
    });

    // Version 3 Schema (Adds userProfile for gamification)
    (this as any).version(3).stores({
      flashcards: 'id, deckId, front, back, dueDate',
      decks: 'id, name',
      studyHistory: '++id, cardId, date',
      userProfile: 'id' // 'id' will always be 1 for the single user profile
    }).upgrade((tx: any) => {
       console.log("Upgrading database to version 3, adding userProfile table.");
       return tx.table('userProfile').add({ id: 1, xp: 0, level: 1, lastStreakCheck: '' });
    });
    
    // Version 4 Schema (Adds userAchievements for gamification)
    (this as any).version(4).stores({
      flashcards: 'id, deckId, front, back, dueDate',
      decks: 'id, name',
      studyHistory: '++id, cardId, date',
      userProfile: 'id',
      userAchievements: '&achievementId'
    }).upgrade((tx: any) => {
      console.log("Upgrading database to version 4, adding userAchievements table.");
    });

    // Version 5 Schema (Adds profile fields to userProfile)
    (this as any).version(5).stores({
        flashcards: 'id, deckId, front, back, dueDate',
        decks: 'id, name',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId',
    }).upgrade((tx: any) => {
        console.log("Upgrading database to version 5, adding profile fields to userProfile table.");
        return tx.table('userProfile').toCollection().modify((profile: any) => {
            profile.firstName = '';
            profile.lastName = '';
            profile.bio = '';
        });
    });

    // Version 6: Add profileLastUpdated timestamp for smarter syncing
    (this as any).version(6).stores({
        flashcards: 'id, deckId, front, back, dueDate',
        decks: 'id, name',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId',
    }).upgrade((tx: any) => {
        console.log("Upgrading database to version 6, adding profileLastUpdated to userProfile.");
        return tx.table('userProfile').toCollection().modify((profile: any) => {
            if (!profile.profileLastUpdated) {
                profile.profileLastUpdated = new Date(0).toISOString(); // Set to epoch if it doesn't exist
            }
        });
    });

    // Version 7: Add daily goals to userProfile for gamification
    (this as any).version(7).stores({
        flashcards: 'id, deckId, front, back, dueDate',
        decks: 'id, name',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId',
    }).upgrade((tx: any) => {
        console.log("Upgrading database to version 7, adding dailyGoals to userProfile.");
        return tx.table('userProfile').toCollection().modify((profile: any) => {
            if (!profile.dailyGoals) {
                profile.dailyGoals = {
                    date: '1970-01-01', // old date to trigger refresh
                    goals: [],
                    allCompleteAwarded: false
                };
            }
        });
    });

    // Version 8: Add index for isDeleted for performance
    (this as any).version(8).stores({
        flashcards: 'id, deckId, front, back, dueDate, isDeleted',
        decks: 'id, name',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId'
    });

    // Version 9: Add createdAt for better sorting and index it.
    (this as any).version(9).stores({
        flashcards: 'id, deckId, front, back, dueDate, isDeleted, createdAt',
        decks: 'id, name, isDeleted',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId'
    }).upgrade((tx: any) => {
        console.log("Upgrading database to version 9, adding createdAt to flashcards and isDeleted to decks.");
        // Add createdAt to existing cards using their ID (which is a timestamp) as a fallback.
        return tx.table('flashcards').toCollection().modify((card: any) => {
            if (!card.createdAt) {
                const timestamp = parseInt(card.id.split('-')[0], 10);
                card.createdAt = new Date(timestamp).toISOString();
            }
        });
    });

    // Version 10: Add updatedAt for reliable data sync.
    (this as any).version(10).stores({
        flashcards: 'id, deckId, front, back, dueDate, isDeleted, createdAt, updatedAt',
        decks: 'id, name, isDeleted',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId'
    }).upgrade((tx: any) => {
        console.log("Upgrading database to version 10, adding updatedAt to flashcards for sync.");
        return tx.table('flashcards').toCollection().modify((card: any) => {
            if (!card.updatedAt) {
                card.updatedAt = card.createdAt; // Set initial value to createdAt
            }
        });
    });

    // Version 11: Texts read section by section on the reading path.
    (this as any).version(11).stores({
        flashcards: 'id, deckId, front, back, dueDate, isDeleted, createdAt, updatedAt',
        decks: 'id, name, isDeleted',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId',
        texts: 'id, updatedAt, isDeleted'
    });

    // Version 12: the library. Books, articles and texts with chapters; a
    // chapter's text is kept apart from its progress; occurrences say where a
    // card's term was met. Old texts move over at start-up (services/library).
    (this as any).version(12).stores({
        flashcards: 'id, deckId, front, back, dueDate, isDeleted, createdAt, updatedAt',
        decks: 'id, name, isDeleted',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId',
        texts: 'id, updatedAt, isDeleted',
        sources: 'id, updatedAt',
        chapters: 'id, sourceId, updatedAt',
        chapterTexts: 'id, sourceId',
        occurrences: 'id, cardId, sourceId, chapterId',
        meta: 'key'
    });

    // Version 13: reading mode. Words the user already knows (synced), and
    // dictionary lookups kept on this device.
    (this as any).version(13).stores({
        flashcards: 'id, deckId, front, back, dueDate, isDeleted, createdAt, updatedAt',
        decks: 'id, name, isDeleted',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId',
        texts: 'id, updatedAt, isDeleted',
        sources: 'id, updatedAt',
        chapters: 'id, sourceId, updatedAt',
        chapterTexts: 'id, sourceId',
        occurrences: 'id, cardId, sourceId, chapterId',
        meta: 'key',
        knownWords: 'id, term, updatedAt',
        lookups: 'term'
    });

    // Version 14: requests to the AI services and dictionaries, for the usage page.
    (this as any).version(14).stores({
        flashcards: 'id, deckId, front, back, dueDate, isDeleted, createdAt, updatedAt',
        decks: 'id, name, isDeleted',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId',
        texts: 'id, updatedAt, isDeleted',
        sources: 'id, updatedAt',
        chapters: 'id, sourceId, updatedAt',
        chapterTexts: 'id, sourceId',
        occurrences: 'id, cardId, sourceId, chapterId',
        meta: 'key',
        knownWords: 'id, term, updatedAt',
        lookups: 'term',
        usage: '++id, day'
    });
  }
}

export const db = new LinguaCardsDB();

// Pre-populate with a default deck and user profile if none exist
(db as any).on('populate', async () => {
  await db.decks.add({ id: 'default', name: 'Default Deck' });
  await db.userProfile.add({ 
      id: 1, 
      xp: 0, 
      level: 1, 
      lastStreakCheck: '', 
      firstName: '', 
      lastName: '', 
      bio: '', 
      profileLastUpdated: new Date().toISOString(),
      dailyGoals: {
          date: '1970-01-01',
          goals: [],
          allCompleteAwarded: false
      }
  });
});