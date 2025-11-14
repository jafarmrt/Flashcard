import { Flashcard, Deck } from '../types';

export const convertToCSV = (cards: Flashcard[], decks: Deck[]): string => {
  const decksById = new Map(decks.map(deck => [deck.id, deck.name]));
  
  const headers = [
    'front', 'back', 'deckName', 'pronunciation', 'partOfSpeech', 
    'definition', 'exampleSentenceTarget', 'notes'
  ];

  const escapeCSV = (value: string | string[] | undefined): string => {
    if (value === undefined || value === null) return '';
    // Handle array fields by joining them with a semicolon
    let str = Array.isArray(value) ? value.join('; ') : String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      str = `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = cards.map(card => {
    const rowData = {
      front: card.front,
      back: card.back,
      deckName: decksById.get(card.deckId) || 'Unknown',
      pronunciation: card.pronunciation,
      partOfSpeech: card.partOfSpeech,
      definition: card.definition,
      exampleSentenceTarget: card.exampleSentenceTarget,
      notes: card.notes,
    };
    return headers.map(header => escapeCSV(rowData[header as keyof typeof rowData])).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
};

export const parseCSV = (csvText: string): Record<string, string>[] => {
    const rows: Record<string, string>[] = [];
    const regex = /(".*?"|[^",\r\n]+)(?=\s*,|\s*$)/g;
    const lines = csvText.trim().split('\n');
    if (lines.length < 1) return [];

    const headers = (lines.shift()?.match(regex) || []).map(h => h.replace(/"/g, '').trim());

    for (const line of lines) {
        if (!line.trim()) continue;
        const values = (line.match(regex) || []).map(v => v.replace(/"/g, '').trim());
        if (values.length === headers.length) {
            const entry = headers.reduce((obj, header, index) => {
                obj[header] = values[index];
                return obj;
            }, {} as Record<string, string>);
            rows.push(entry);
        }
    }
    return rows;
};
