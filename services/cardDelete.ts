import type { Flashcard } from '../types';

// Deleting cards is soft: a card gets isDeleted and a new updatedAt, so the
// next sync carries the deletion to the server and from there to every other
// device (a row simply missing would come back from the server).

// The cards behind the ids that are still there, each once, in the order of
// `cards`; ids of cards already deleted or unknown are left out.
export function cardsToDelete(cards: Flashcard[], ids: Iterable<string>): Flashcard[] {
  const wanted = new Set(ids);
  return cards.filter(c => wanted.has(c.id) && !c.isDeleted);
}

export function markDeleted(cards: Flashcard[], now: string): Flashcard[] {
  return cards.map(c => ({ ...c, isDeleted: true, updatedAt: now }));
}

// What the confirmation names: the first few words, and how many more, so a
// long selection still fits on a phone screen.
export function deletionPreview(cards: Flashcard[], shown = 6): { words: string[]; more: number } {
  const words = cards.slice(0, shown).map(c => c.front.trim() || '—');
  return { words, more: Math.max(0, cards.length - words.length) };
}
