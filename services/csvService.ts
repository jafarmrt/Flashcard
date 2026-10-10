import { Collocation, Flashcard, Deck, CardKind } from '../types';
import { CARD_KINDS } from './cardKinds';

// Columns of an export. Lists are joined with "; ", collocations as
// "phrase = meaning". Older exports have only the first eight columns.
const HEADERS = [
  'front', 'back', 'deckName', 'pronunciation', 'partOfSpeech',
  'definition', 'exampleSentenceTarget', 'notes',
  'kind', 'sourceSentence', 'collocations', 'grammarPattern', 'practicePrompt',
  'level', 'grammarId',
] as const;

const escapeCSV = (value: string | string[] | undefined): string => {
  if (value === undefined || value === null) return '';
  const str = Array.isArray(value) ? value.join('; ') : String(value);
  return /[",\r\n]/.test(str) || /^\s|\s$/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

export const convertToCSV = (cards: Flashcard[], decks: Deck[]): string => {
  const decksById = new Map(decks.map(deck => [deck.id, deck.name]));
  const rows = cards.map(card => {
    const rowData: Record<(typeof HEADERS)[number], string | string[] | undefined> = {
      front: card.front,
      back: card.back,
      deckName: decksById.get(card.deckId) || 'Unknown',
      pronunciation: card.pronunciation,
      partOfSpeech: card.partOfSpeech,
      definition: card.definition,
      exampleSentenceTarget: card.exampleSentenceTarget,
      notes: card.notes,
      kind: card.kind,
      sourceSentence: card.sourceSentence,
      collocations: (card.collocations || []).map(c => (c.meaning ? `${c.phrase} = ${c.meaning}` : c.phrase)),
      grammarPattern: card.grammarPattern,
      practicePrompt: card.practicePrompt,
      level: card.level,
      grammarId: card.grammarId,
    };
    return HEADERS.map(header => escapeCSV(rowData[header])).join(',');
  });
  return [HEADERS.join(','), ...rows].join('\r\n');
};

// RFC 4180: quoted fields may hold commas, quotes ("") and line breaks; empty
// fields are kept. A byte-order mark (added for Excel) is ignored.
export const parseCSVRows = (csvText: string): string[][] => {
  const text = csvText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      quoted = true;
      field = '';
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
};

export const parseCSV = (csvText: string): Record<string, string>[] => {
  const [headerRow, ...rows] = parseCSVRows(csvText);
  if (!headerRow) return [];
  const headers = headerRow.map(h => h.trim());
  return rows.map(values => headers.reduce((obj, header, index) => {
    obj[header] = (values[index] ?? '').trim();
    return obj;
  }, {} as Record<string, string>));
};

// "a; b" -> ["a", "b"], without empty entries.
export const splitList = (value: string | undefined): string[] =>
  (value || '').split(';').map(s => s.trim()).filter(Boolean);

// "phrase = meaning; other" -> [{ phrase, meaning }, { phrase }]
export const parseCollocations = (value: string | undefined): Collocation[] =>
  splitList(value).map(item => {
    const [phrase, ...meaning] = item.split(' = ');
    return meaning.length ? { phrase: phrase.trim(), meaning: meaning.join(' = ').trim() } : { phrase: phrase.trim() };
  });

export const parseKind = (value: string | undefined): CardKind | undefined =>
  CARD_KINDS.includes(value as CardKind) ? (value as CardKind) : undefined;

// Saves a CSV as a file. The byte-order mark makes Excel read it as UTF-8.
export const downloadCSV = (filename: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
