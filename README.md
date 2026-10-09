# Lingua Cards

Read English books and articles section by section, turn the hard words,
phrases and grammar structures into flashcards, and review them with spaced
repetition (FSRS). Made for a Persian-speaking learner; works offline as an
installable web app.

## Run locally

Prerequisite: Node.js 20 or newer.

1. `npm install`
2. `cp .env.example .env` and fill in what you need. Nothing is required for a
   first try: without an AI key the app uses free dictionaries
   (dictionaryapi.dev, Datamuse, MyMemory).
3. `npm run dev` and open http://localhost:3000

`npm test` runs the unit tests, `npm run lint` type-checks, `npm run build`
builds the browser app into `dist/`, and `npm start` serves `dist/` with the
API in production mode.

## The library

Add a book (EPUB or .txt), an article (by its link) or pasted text. An EPUB's
chapters come from the book's own table of contents and are read in the
browser; an article's main text is taken out of the page with Mozilla
Readability. Each chapter is read in sections of about 300 words.

Every card remembers who made it (which AI model, the free dictionary, by
hand) and where its word was met: book, chapter, section and sentence. A word
met in another book gets that sentence added to its card instead of a second
card, and each book has a word list by chapter with search and CSV export.

## Reading a section

- Tap a word: the free dictionary answers at once. With the AI source on, the
  meaning the word has in this sentence replaces it a moment later; taps made
  close together go to the AI as one request.
- Drag over several words (with a finger, rest on the first word first), or
  shift-click, to pick a phrase or a sentence. The bar that opens gives the
  phrase's meaning in its dictionary form ("took it into account" becomes
  "take into account"), the sentence's grammar structures with a Persian
  explanation and a sentence-building exercise, or a free translation.
- "بلدم" (I know it) takes a word off the list for good: it is not suggested
  again in any book or form, on any device. The library lists these words and
  takes them back with ×.
- Words with a card are underlined by how well you know them: new, learning
  or known.
- Before a section, its hardest words can be shown first ("همیشه" does it
  every time). After a section, its cards are offered for a short review.

## Where the data lives

- Everything is kept in the browser (IndexedDB) first.
- With an account it syncs to the server: `DATA_DIR/.data_store.json` on a
  VPS (back this file up), or Upstash Redis on Vercel (`KV_REST_API_URL`,
  `KV_REST_API_TOKEN`).
- A sync sends only what changed since the last one, in batches small enough
  for Vercel's request limit. Chapter texts are stored apart from the account
  and fetched the first time a chapter is opened on another device; the
  server keeps them compressed. Sound recorded on a device stays on it.
- A word looked up in the free dictionaries is kept for 90 days, on the
  device and on the server (`DATA_DIR/.lookup_cache.json`, or Redis), so a
  second tap is instant, works offline and spends no translation quota.

## Accounts

The app is for one person. With `ALLOW_REGISTRATION` empty, the first account
can be created and registration closes after it. `true` opens registration to
anyone, `false` closes it completely. Set `SESSION_SECRET` (at least 32
characters) on Vercel; on a VPS one is generated in `DATA_DIR/.session_secret`.

## AI

In Settings, under «سرویس‌های هوش مصنوعی», list the AI services in the order
they should be tried: Gemini, Groq, OpenRouter, DeepSeek, a local Ollama or
another OpenAI-compatible service, each with its own key and model. When one
fails (its free quota is used up, its key is wrong, it is down), the next is
asked, and the free dictionaries come last. Gemini without a key uses the
server's `GEMINI_API_KEY` (or `API_KEY`). Keys stay on the device; the order
syncs. Every card records which service made it.

The usage page («گزارش مصرف», from Settings) shows, for the last 30 days on
this device: requests to each service per day, failures with their message,
the cards each service made, roughly how much of the free daily translation
quota (MyMemory) is left today, and how much data the account keeps on the
server and in the browser. Setting `MYMEMORY_EMAIL` on the server raises the
translation quota about tenfold.

## Checks

- Each word card gets a level (A1 to C2), from how often the word is used or
  from the AI. Words the AI picks below your level (Settings) are listed but
  not ticked.
- A card is flagged «نیاز به بررسی» when the dictionary did not know its
  term, it has no Persian meaning, or its term is not in its sentence. A
  book's «بررسی» tab lists them: confirm one with «درسته», or fix its meaning
  in place. Editing a card also clears the flag.
- On the same tab an AI checks the meanings of flagged and dictionary-made
  cards against the book's sentence, 20 at a time, and suggests a better one
  where it does not fit. Nothing changes until you accept a suggestion.
- About 20 grammar structures (passive, perfect tenses, conditionals,
  inversion, relative clauses, wish, used to, cleft sentences and more) are
  found by the app's own rules and lightly underlined while reading. Tapping
  a helper word of one (was, had, if, who…) makes a full grammar card with a
  Persian explanation and an exercise, with no AI; with AI the explanation is
  about that very sentence. Without AI, word extraction also adds up to two
  structures per section.
- Reviewing a grammar card asks for your own sentence with the structure. The
  rules say at once whether the structure is there; with AI you also get the
  mistakes with a short Persian explanation and a corrected sentence, and a
  suggested rating.

## Books, reviews and progress

- **How hard is a book?** A book's page measures, once per device, how many of
  its running words you already know: by your level, your grown cards and the
  «بلدم» list. A sample of 400 of its words is looked up in one request. It
  shows the share known, about how many new words each 300-word section has,
  and the text's level (the lowest level that knows 95% of it). The shelf
  shows the share known on each book.
- **Pre-study:** before a chapter, its first three sections' hard words can be
  listed, ticked, saved as cards at their section and reviewed at once.
- **Review by book or chapter:** a book or chapter page reviews its own cards,
  the due ones first, else the weakest 20.
- **Gap in the book's sentence («جای خالی»):** a review mode that shows the
  sentence the word was met in with the word left out and its Persian meaning
  as the hint; you write the word as the sentence needs it. A typo or another
  form of the word is "close" and suggests Hard. Cards without a sentence
  are asked for their meaning instead.
- **Rewards:** finishing a chapter adds 50 XP and finishing a book 200 XP on
  top of the section's 25. Each finished section counts as 5 reviews toward
  the daily goal. Reading badges: first chapter, 10 chapters, first book,
  three books, 100 words carded from texts.
- **Stats:** reviews per day, each book's cards week by week and how many are
  learned (stage «درخت» or above), the hardest words (most «دوباره») with a
  button to review them, and words by growth stage.
