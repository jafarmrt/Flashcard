import { Dexie, type Table } from 'dexie';
import { Flashcard, Deck, StudyLog } from '../types';

export class LinguaCardsDB extends Dexie {
  flashcards!: Table<Flashcard>; 
  decks!: Table<Deck>;
  studyHistory!: Table<StudyLog>;

  constructor() {
    super('LinguaCardsDB');
    this.version(2).stores({
      flashcards: 'id, deckId, front, back, dueDate',
      decks: 'id, name',
      studyHistory: '++id, cardId, date'
    });
  }
}

export const db = new LinguaCardsDB();

// Pre-populate with a default deck if none exist
db.on('populate', async () => {
  await db.decks.add({ id: 'default', name: 'Default Deck' });
});