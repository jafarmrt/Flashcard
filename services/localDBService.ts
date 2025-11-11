// Fix: Use a default import for Dexie to resolve type inheritance issues.
import Dexie, { type Table } from 'dexie';
import { Flashcard, Deck, StudyLog } from '../types';

export class LinguaCardsDB extends Dexie {
  flashcards!: Table<Flashcard>; 
  decks!: Table<Deck>;
  studyHistory!: Table<StudyLog>;

  constructor() {
    super('LinguaCardsDB');
    
    // Version 1 Schema (Original)
    // This defines the structure that existing users have.
    this.version(1).stores({
      flashcards: 'id, deckId, front, back, dueDate',
      decks: 'id, name',
    });
    
    // Version 2 Schema (Adds studyHistory)
    // This tells Dexie how to upgrade from v1 to v2 without losing data.
    this.version(2).stores({
      // We only need to declare the *new* table here.
      // Dexie knows to keep the old ones.
      studyHistory: '++id, cardId, date'
    }).upgrade(tx => {
      // This upgrade function is intentionally left empty.
      // It signals to Dexie that it should just add the new 'studyHistory' table
      // and leave the existing 'flashcards' and 'decks' tables untouched.
      // This is the key to preventing data loss.
      console.log("Upgrading database to version 2, adding studyHistory table.");
      return; 
    });
  }
}

export const db = new LinguaCardsDB();

// Pre-populate with a default deck if none exist
db.on('populate', async () => {
  await db.decks.add({ id: 'default', name: 'Default Deck' });
});