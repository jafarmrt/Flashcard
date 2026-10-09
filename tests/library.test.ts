import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  buildSource, cardIndex, cardsInText, chaptersOf, continuePoint, currentChunkOf, findCard, isChunkOpen, markChunkDone,
  migrateTexts, newOccurrence, originText, placesByCard, sourceProgress,
} from '../services/library';
import { isChapterHeading, resolvePath, splitLongChapters, splitTextIntoChapters, suggestedChapter, importPlainText } from '../services/importers';
import { readZip, readZipText, ZipError } from '../services/zip';
import {
  confirmReceived, confirmSent, freshSyncState, LocalData, LOGS_PER_REQUEST, markAllSynced, nextLogCursor, nextOutgoing,
  ROWS_PER_REQUEST, usableSyncState, withLocalAudio, FULL_PUSH_EVERY_MS,
} from '../services/syncClient';
import { providerName } from '../services/aiSettings';
import type { Chapter, Deck, Flashcard, Source, StudyLog } from '../types';

const NOW = new Date('2026-10-09T10:00:00Z');

const card = (over: Partial<Flashcard> = {}): Flashcard => ({
  id: 'c1', deckId: 'd1', front: 'decide', back: 'تصمیم گرفتن', createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z', repetition: 0, easinessFactor: 2.5, interval: 0, dueDate: '2026-10-01T00:00:00Z', ...over,
});

// "w0 w1 … w(n-1)." in sentences of ten words.
const words = (n: number, prefix = 'w') =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}${i % 10 === 9 ? '.' : ''}`).join(' ');

// --- Sources and chapters ---

test('a source is built with one chapter per input, empty ones left out', () => {
  const { source, chapters, texts } = buildSource({
    kind: 'book', title: '  The Book ', author: ' Ann ', deckId: 'd1',
    chapters: [{ title: 'One', text: words(650) }, { title: 'Empty', text: '   ' }, { title: '', text: words(20) }],
  }, NOW, 'src');
  assert.equal(source.title, 'The Book');
  assert.equal(source.author, 'Ann');
  assert.deepEqual(chapters.map(c => [c.id, c.order, c.title]), [['src-c1', 1, 'One'], ['src-c2', 2, 'Chapter 2']]);
  assert.equal(chapters[0].chunkCount, texts[0].chunks.length);
  assert.ok(chapters[0].chunkCount >= 3, 'about 300 words a section');
  assert.equal(chapters[0].wordCount, 650);
  assert.equal(texts[1].sourceId, 'src');
});

test('a single-chapter source names the chapter after the source, and an untitled one after its words', () => {
  const one = buildSource({ kind: 'text', title: '', deckId: '', chapters: [{ title: '', text: 'Once upon a time there was a fox.' }] }, NOW, 's');
  assert.equal(one.source.title, 'Once upon a time there was');
  assert.equal(one.chapters[0].title, one.source.title);
});

test('sections are finished in order; the place to continue follows the saved position', () => {
  const { source, chapters } = buildSource({
    kind: 'book', title: 'B', deckId: 'd', chapters: [{ title: 'A', text: words(650) }, { title: 'B', text: words(650) }],
  }, NOW, 's');
  let [a, b] = chapters;
  assert.equal(currentChunkOf(a), 0);
  assert.equal(isChunkOpen(a, 1), false);
  const first = markChunkDone(a, 0, NOW);
  assert.equal(first.firstTime, true);
  a = first.chapter;
  assert.equal(markChunkDone(a, 0, NOW).firstTime, false);
  assert.equal(isChunkOpen(a, 1), true);
  assert.equal(isChunkOpen(a, 2), false);
  assert.deepEqual(continuePoint(source, [a, b]), { chapter: a, chunk: 1 });

  // A saved place in the second chapter wins while it is not finished.
  const placed: Source = { ...source, position: { chapterId: b.id, chunk: 0 } };
  assert.equal(continuePoint(placed, [a, b])!.chapter.id, b.id);

  for (let i = 1; i < a.chunkCount; i++) a = markChunkDone(a, i, NOW).chapter;
  assert.deepEqual(continuePoint(source, [a, b]), { chapter: b, chunk: 0 });
  for (let i = 0; i < b.chunkCount; i++) b = markChunkDone(b, i, NOW).chapter;
  const p = sourceProgress([a, b]);
  assert.equal(p.finished, true);
  assert.equal(p.percent, 100);
  assert.equal(p.words, 1300);
  assert.deepEqual(chaptersOf('s', [b, a, { ...a, id: 'x', isDeleted: true }]).map(c => c.id), [a.id, b.id]);
});

// --- Cards met in several places ---

test('a term finds its card in any form, and a phrase only as itself', () => {
  const index = cardIndex([card(), card({ id: 'c2', front: 'carry out' }), card({ id: 'gone', front: 'abate', isDeleted: true })]);
  assert.equal(findCard('decided', index)?.id, 'c1');
  assert.equal(findCard('Decide', index)?.id, 'c1');
  assert.equal(findCard('to decide', index)?.id, 'c1');
  assert.equal(findCard('carry out', index)?.id, 'c2');
  assert.equal(findCard('carried out', index), undefined);
  assert.equal(findCard('abate', index), undefined, 'deleted cards are not matched');
});

test('cards whose term is in a text are found with their sentence, grammar cards left out', () => {
  const text = 'She finally decided to leave. They carried it out at night.\n\nThe rain abated.';
  const cards = [
    card(),
    card({ id: 'c2', front: 'carry out' }),
    card({ id: 'c3', front: 'abate' }),
    card({ id: 'c4', front: 'subjunctive', kind: 'grammar' }),
    card({ id: 'c5', front: 'mountain' }),
  ];
  const found = cardsInText(text, cards);
  assert.deepEqual(found.map(f => [f.card.id, f.sentence]), [
    ['c1', 'She finally decided to leave.'],
    ['c2', 'They carried it out at night.'],
    ['c3', 'The rain abated.'],
  ]);
});

test('places list the sources a card was met in, with chapter titles only for books of several chapters', () => {
  const sources: Source[] = [
    { id: 'b', kind: 'book', title: 'Book', deckId: 'd', createdAt: '', updatedAt: '' },
    { id: 'a', kind: 'article', title: 'Article', deckId: 'd', createdAt: '', updatedAt: '' },
    { id: 'gone', kind: 'text', title: 'Gone', deckId: 'd', createdAt: '', updatedAt: '', isDeleted: true },
  ];
  const chapter = (id: string, sourceId: string, order: number): Chapter => ({
    id, sourceId, order, title: `Ch ${order}`, chunkCount: 1, wordCount: 10, completed: [], createdAt: '', updatedAt: '',
  });
  const chapters = [chapter('b-c1', 'b', 1), chapter('b-c2', 'b', 2), chapter('a-c1', 'a', 1), chapter('g-c1', 'gone', 1)];
  const at = (iso: string) => new Date(iso);
  const occurrences = [
    newOccurrence({ id: 'c1' }, chapters[2], 0, 'In the article.', at('2026-10-02T00:00:00Z')),
    newOccurrence({ id: 'c1' }, chapters[1], 3, 'In the book.', at('2026-10-01T00:00:00Z')),
    newOccurrence({ id: 'c1' }, chapters[3], 0, 'Deleted source.', at('2026-10-03T00:00:00Z')),
  ];
  assert.equal(occurrences[1].id, 'c1@b-c2');
  const places = placesByCard(occurrences, sources, chapters).get('c1')!;
  assert.deepEqual(places, [
    { sourceId: 'b', sourceTitle: 'Book', chapterTitle: 'Ch 2', chapterOrder: 2, sentence: 'In the book.' },
    { sourceId: 'a', sourceTitle: 'Article', sentence: 'In the article.' },
  ]);
});

test('the maker of a card is told in a few words', () => {
  assert.equal(originText({ by: 'ai', provider: 'Gemini', model: 'gemini-2.5-flash' }), 'Gemini · gemini-2.5-flash');
  assert.equal(originText({ by: 'ai' }), 'AI');
  assert.equal(originText({ by: 'dictionary' }), 'دیکشنری رایگان');
  assert.equal(originText({ by: 'manual' }), 'دستی');
  assert.equal(originText(undefined), null);
  assert.equal(providerName(undefined), 'Gemini');
  assert.equal(providerName({ aiProvider: 'openai-compatible' } as any), 'Groq');
  assert.equal(providerName({ aiProvider: 'openai-compatible', aiBaseUrl: 'https://openrouter.ai/api/v1' } as any), 'OpenRouter');
  assert.equal(providerName({ aiProvider: 'openai-compatible', aiBaseUrl: 'http://localhost:11434/v1' } as any), 'Ollama');
  assert.equal(providerName({ aiProvider: 'openai-compatible', aiBaseUrl: 'https://api.example.com/v1' } as any), 'example.com');
});

test('old texts move into the library with the same ids every time', () => {
  const decks: Deck[] = [{ id: 'd1', name: 'My Story' }];
  const text = {
    id: 't1', title: 'My Story', deckName: 'my story', chunks: ['She decided to go.', 'Nothing here.'], completed: [0],
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
  };
  const cards = [card(), card({ id: 'other', deckId: 'd2', front: 'go' })];
  const once = migrateTexts([text], decks, cards);
  assert.deepEqual(once, migrateTexts([text], decks, cards));
  assert.equal(once.sources[0].id, 't1');
  assert.equal(once.sources[0].deckId, 'd1');
  assert.deepEqual(once.chapters[0].completed, [0]);
  assert.deepEqual(once.chapterTexts[0], { id: 't1-c1', sourceId: 't1', chunks: text.chunks });
  assert.deepEqual(once.occurrences.map(o => [o.id, o.chunk, o.sentence]), [['c1@t1-c1', 0, 'She decided to go.']]);
});

// --- Importing ---

test('chapter headings split a long text; fewer than two keep it whole', () => {
  assert.equal(isChapterHeading('Chapter 12'), true);
  assert.equal(isChapterHeading('CHAPTER TWENTY-ONE. The Storm'), true);
  assert.equal(isChapterHeading('XIV'), true);
  assert.equal(isChapterHeading('3.'), true);
  assert.equal(isChapterHeading('Chapter one was the hardest part of the whole long book to write, she said.'), false);
  assert.equal(isChapterHeading('I said nothing.'), false);

  const book = `My Book\n\nA preface.\n\nChapter 1\n\n${words(30)}\n\nChapter 2\n\n${words(40, 'x')}`;
  const chapters = splitTextIntoChapters(book);
  assert.deepEqual(chapters.map(c => c.title), ['Opening', 'Chapter 1', 'Chapter 2']);
  assert.equal(splitTextIntoChapters(`Chapter 1\n\n${words(30)}`).length, 1);
  assert.equal(importPlainText(book).title, 'My Book');
  assert.equal(suggestedChapter({ title: 'Contents', text: words(100) }), false);
  assert.equal(suggestedChapter({ title: 'Chapter 1', text: words(100) }), true);
});

test('a very long chapter is cut between paragraphs', () => {
  const text = [words(40), words(40), words(40)].join('\n\n');
  const parts = splitLongChapters([{ title: 'Long', text }, { title: 'Short', text: 'Hi.' }], 90);
  assert.deepEqual(parts.map(p => p.title), ['Long · 1', 'Long · 2', 'Short']);
  assert.equal(parts[0].text.split('\n\n').length, 2);
});

test('paths inside an EPUB resolve from the file that links them', () => {
  assert.equal(resolvePath('OEBPS/content.opf', 'Text/ch1.xhtml'), 'OEBPS/Text/ch1.xhtml');
  assert.equal(resolvePath('OEBPS/Text/nav.xhtml', '../Text/ch%202.xhtml#p3'), 'OEBPS/Text/ch 2.xhtml');
  assert.equal(resolvePath('content.opf', './ch1.html'), 'ch1.html');
  assert.equal(resolvePath('a/b/c.opf', '/root.html'), 'root.html');
});

// A ZIP archive built by hand: stored and deflated files, no CRC check needed.
const makeZip = (files: { name: string; text: string; deflate?: boolean }[]): ArrayBuffer => {
  const enc = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = enc.encode(f.text);
    const data = f.deflate ? deflateRawSync(raw) : Buffer.from(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, Buffer.from(name), data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(f.deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, Buffer.from(name));
    offset += 30 + name.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...locals, dir, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length) as ArrayBuffer;
};

test('files are read from a ZIP archive, stored or compressed', async () => {
  const long = 'The quick brown fox. '.repeat(200);
  const zip = readZip(makeZip([
    { name: 'mimetype', text: 'application/epub+zip' },
    { name: 'OEBPS/ch 1.xhtml', text: long, deflate: true },
  ]));
  assert.deepEqual([...zip.keys()], ['mimetype', 'OEBPS/ch 1.xhtml']);
  assert.equal(await readZipText(zip, 'mimetype'), 'application/epub+zip');
  assert.equal(await readZipText(zip, 'OEBPS/ch%201.xhtml'), long);
  assert.equal(await readZipText(zip, 'missing'), null);
  assert.throws(() => readZip(new TextEncoder().encode('not a zip at all, just some text here').buffer as ArrayBuffer), ZipError);
});

// --- What a browser sends at each sync ---

const local = (over: Partial<LocalData> = {}): LocalData => ({
  decks: [], cards: [], sources: [], chapters: [], occurrences: [], knownWords: [], logs: [], achievements: [], ...over,
});
const log = (id: number): StudyLog => ({ id, cardId: 'c1', date: '2026-10-01', rating: 'GOOD' } as StudyLog);

test('only rows changed since the last confirmed sync are sent, in batches', () => {
  const cards = Array.from({ length: ROWS_PER_REQUEST + 5 }, (_, i) => card({ id: `c${i}` }));
  const data = local({ cards, logs: Array.from({ length: LOGS_PER_REQUEST + 1 }, (_, i) => log(i + 1)) });
  let state = freshSyncState('ann', NOW.getTime());

  const first = nextOutgoing(data, state);
  assert.equal(first.changes.cards.length, ROWS_PER_REQUEST);
  assert.equal(first.changes.studyHistory.length, LOGS_PER_REQUEST);
  assert.equal(first.changes.studyHistory[0].id, undefined, 'local log ids stay here');
  assert.equal(first.remaining, 5 + 1);
  state = confirmSent(state, first);
  state = { ...state, logCursor: nextLogCursor(state, first, LOGS_PER_REQUEST + 1, LOGS_PER_REQUEST + 1) };

  const second = nextOutgoing(data, state);
  assert.equal(second.changes.cards.length, 5);
  assert.equal(second.changes.studyHistory.length, 1);
  assert.equal(second.remaining, 0);
  state = confirmSent(state, second);
  state = { ...state, logCursor: nextLogCursor(state, second, LOGS_PER_REQUEST + 1, LOGS_PER_REQUEST + 1) };
  assert.equal(Object.keys(nextOutgoing(data, state).changes).length, 0);

  // An edit is sent again; a row taken from the server is not.
  const edited = { ...cards[3], back: 'new', updatedAt: '2026-10-05T00:00:00Z' };
  const fromServer = card({ id: 'srv', updatedAt: '2026-10-06T00:00:00Z' });
  state = confirmReceived(state, 'cards', [fromServer]);
  const third = nextOutgoing(local({ cards: [...cards.slice(0, 3), edited, ...cards.slice(4), fromServer] }), state);
  assert.deepEqual(third.changes.cards.map((c: Flashcard) => c.id), ['c3']);
});

test('the log cursor skips logs taken from the server but not a review saved meanwhile', () => {
  const state = { ...freshSyncState('ann'), logCursor: 10 };
  const sent = { changes: {}, sent: { decks: {}, cards: {}, sources: {}, chapters: {}, occurrences: {}, knownWords: {} }, remaining: 0, lastLogId: 12 };
  assert.equal(nextLogCursor(state, sent, 12, 20), 20, 'nothing new here: skip past the received logs');
  assert.equal(nextLogCursor(state, sent, 13, 20), 12, 'a review saved meanwhile is sent next time');
  const none = { ...sent, lastLogId: undefined };
  assert.equal(nextLogCursor(state, none, 10, 15), 15);
  assert.equal(nextLogCursor(state, none, 11, 15), 10);
});

test('sound kept on this device is not sent and survives incoming rows', () => {
  const recorded = card({ audioSrc: 'data:audio/mp3;base64,AAAA' });
  const out = nextOutgoing(local({ cards: [recorded, card({ id: 'web', audioSrc: 'https://x/a.mp3' })] }), freshSyncState('ann'));
  assert.equal('audioSrc' in out.changes.cards[0], false);
  assert.equal(out.changes.cards[1].audioSrc, 'https://x/a.mp3');
  const incoming = card({ back: 'from server' });
  assert.equal(withLocalAudio(incoming, recorded).audioSrc, recorded.audioSrc);
  assert.equal(withLocalAudio({ ...incoming, audioSrc: 'https://y' }, recorded).audioSrc, 'https://y');
});

test('a first sign-in takes the account as it is, and a week later everything is sent again', () => {
  const data = local({ decks: [{ id: 'd1', name: 'Default' }], logs: [log(4)] });
  const state = markAllSynced(freshSyncState('ann'), data);
  assert.equal(Object.keys(nextOutgoing(data, state).changes).length, 0);
  assert.equal(state.logCursor, 4);
  const saved = { ...state, storeId: 'S', rev: 9, fullAt: NOW.getTime() };
  assert.equal(usableSyncState(saved, 'ann', NOW.getTime() + 1000), saved);
  const due = usableSyncState(saved, 'ann', NOW.getTime() + FULL_PUSH_EVERY_MS + 1);
  assert.deepEqual([due.storeId, due.rev, Object.keys(due.stamps.decks).length], ['S', 9, 0]);
  assert.equal(usableSyncState(saved, 'bob').rev, 0, 'another account starts over');

  // Saved by a version without the known-words table: take everything again
  // once, keeping what was sent.
  const { knownWords: _none, ...olderStamps } = saved.stamps;
  const older = usableSyncState({ ...saved, stamps: olderStamps as typeof saved.stamps }, 'ann', NOW.getTime() + 1000);
  assert.deepEqual([older.rev, older.storeId, older.stamps.knownWords, older.stamps.decks], [0, 'S', {}, saved.stamps.decks]);
  assert.equal(usableSyncState(older, 'ann', NOW.getTime() + 2000), older, 'only once');
});
