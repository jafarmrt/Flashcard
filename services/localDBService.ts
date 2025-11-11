// Fix: Use a default import for `Dexie` and a type-only import for `Table`. This is the correct approach for modern versions of Dexie (3.x+) and resolves type resolution issues that prevented `LinguaCardsDB` from inheriting `Dexie`'s methods and properties (like .transaction(), .version(), etc.) correctly.
import Dexie, { type Table } from 'dexie';
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
      studyHistory: '++id, cardId, date'
    }).upgrade(tx => {
      console.log("Upgrading database to version 2, adding studyHistory table.");
      return; 
    });

    // Version 3 Schema (Adds userProfile for gamification)
    this.version(3).stores({
      userProfile: 'id' // 'id' will always be 1 for the single user profile
    }).upgrade(tx => {
       console.log("Upgrading database to version 3, adding userProfile table.");
       return tx.table('userProfile').add({ id: 1, xp: 0, level: 1, lastStreakCheck: '' });
    });
    
    // Version 4 Schema (Adds userAchievements for gamification)
    this.version(4).stores({
      userAchievements: '&achievementId'
    }).upgrade(tx => {
      console.log("Upgrading database to version 4, adding userAchievements table.");
      return;
    });

    // Version 5 Schema (Adds profile fields to userProfile)
    this.version(5).stores({
        userProfile: 'id, firstName, lastName, bio'
    }).upgrade(tx => {
        console.log("Upgrading database to version 5, adding profile fields to userProfile table.");
        return tx.table('userProfile').toCollection().modify(profile => {
            profile.firstName = '';
            profile.lastName = '';
            profile.bio = '';
        });
    });
  }
}

export const db = new LinguaCardsDB();

// Pre-populate with a default deck and user profile if none exist
db.on('populate', async () => {
  await db.decks.add({ id: 'default', name: 'Default Deck' });
  await db.userProfile.add({ id: 1, xp: 0, level: 1, lastStreakCheck: '', firstName: '', lastName: '', bio: '' });
});