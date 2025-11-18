// Fix: Use a named import for Dexie to ensure TypeScript correctly recognizes the class for extension. The default import was failing in this project's module resolution setup.
// Fix: Using default import for Dexie class as per standard usage and documentation, while keeping Table as a named type import. 
// This resolves 'Property ... does not exist on type LinguaCardsDB' errors.
import { Dexie } from 'dexie';
import type { Table } from 'dexie';
import { Flashcard, Deck, StudyLog, UserProfile, UserAchievement } from '../types';

export class LinguaCardsDB extends Dexie {
  flashcards!: Table<Flashcard>; 
  decks!: Table<Deck>;
  studyHistory!: Table<StudyLog>;
  userProfile!: Table<UserProfile>;
  userAchievements!: Table<UserAchievement>;

  constructor() {
    super('LinguaCardsDB');
    
    // Version 1 Schema (Original)
    this.version(1).stores({
      flashcards: 'id, deckId, front, back, dueDate',
      decks: 'id, name',
    });
    
    // Version 2 Schema (Adds studyHistory)
    this.version(2).stores({
      flashcards: 'id, deckId, front, back, dueDate',
      decks: 'id, name',
      studyHistory: '++id, cardId, date'
    }).upgrade(tx => {
      console.log("Upgrading database to version 2, adding studyHistory table.");
    });

    // Version 3 Schema (Adds userProfile for gamification)
    this.version(3).stores({
      flashcards: 'id, deckId, front, back, dueDate',
      decks: 'id, name',
      studyHistory: '++id, cardId, date',
      userProfile: 'id' // 'id' will always be 1 for the single user profile
    }).upgrade(tx => {
       console.log("Upgrading database to version 3, adding userProfile table.");
       return tx.table('userProfile').add({ id: 1, xp: 0, level: 1, lastStreakCheck: '' });
    });
    
    // Version 4 Schema (Adds userAchievements for gamification)
    this.version(4).stores({
      flashcards: 'id, deckId, front, back, dueDate',
      decks: 'id, name',
      studyHistory: '++id, cardId, date',
      userProfile: 'id',
      userAchievements: '&achievementId'
    }).upgrade(tx => {
      console.log("Upgrading database to version 4, adding userAchievements table.");
    });

    // Version 5 Schema (Adds profile fields to userProfile)
    this.version(5).stores({
        flashcards: 'id, deckId, front, back, dueDate',
        decks: 'id, name',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId',
    }).upgrade(tx => {
        console.log("Upgrading database to version 5, adding profile fields to userProfile table.");
        return tx.table('userProfile').toCollection().modify(profile => {
            profile.firstName = '';
            profile.lastName = '';
            profile.bio = '';
        });
    });

    // Version 6: Add profileLastUpdated timestamp for smarter syncing
    this.version(6).stores({
        flashcards: 'id, deckId, front, back, dueDate',
        decks: 'id, name',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId',
    }).upgrade(tx => {
        console.log("Upgrading database to version 6, adding profileLastUpdated to userProfile.");
        return tx.table('userProfile').toCollection().modify(profile => {
            if (!profile.profileLastUpdated) {
                profile.profileLastUpdated = new Date(0).toISOString(); // Set to epoch if it doesn't exist
            }
        });
    });

    // Version 7: Add daily goals to userProfile for gamification
    this.version(7).stores({
        flashcards: 'id, deckId, front, back, dueDate',
        decks: 'id, name',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId',
    }).upgrade(tx => {
        console.log("Upgrading database to version 7, adding dailyGoals to userProfile.");
        return tx.table('userProfile').toCollection().modify(profile => {
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
    this.version(8).stores({
        flashcards: 'id, deckId, front, back, dueDate, isDeleted',
        decks: 'id, name',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId'
    });

    // Version 9: Add createdAt for better sorting and index it.
    this.version(9).stores({
        flashcards: 'id, deckId, front, back, dueDate, isDeleted, createdAt',
        decks: 'id, name, isDeleted',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId'
    }).upgrade(tx => {
        console.log("Upgrading database to version 9, adding createdAt to flashcards and isDeleted to decks.");
        // Add createdAt to existing cards using their ID (which is a timestamp) as a fallback.
        return tx.table('flashcards').toCollection().modify(card => {
            if (!card.createdAt) {
                const timestamp = parseInt(card.id.split('-')[0], 10);
                card.createdAt = new Date(timestamp).toISOString();
            }
        });
    });

    // Version 10: Add updatedAt for reliable data sync.
    this.version(10).stores({
        flashcards: 'id, deckId, front, back, dueDate, isDeleted, createdAt, updatedAt',
        decks: 'id, name, isDeleted',
        studyHistory: '++id, cardId, date',
        userProfile: 'id, firstName, lastName, bio',
        userAchievements: '&achievementId'
    }).upgrade(tx => {
        console.log("Upgrading database to version 10, adding updatedAt to flashcards for sync.");
        return tx.table('flashcards').toCollection().modify(card => {
            if (!card.updatedAt) {
                card.updatedAt = card.createdAt; // Set initial value to createdAt
            }
        });
    });
  }
}

export const db = new LinguaCardsDB();

// Pre-populate with a default deck and user profile if none exist
db.on('populate', async () => {
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