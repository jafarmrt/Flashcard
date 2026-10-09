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

## Where the data lives

- Everything is kept in the browser (IndexedDB) first.
- With an account it syncs to the server: `DATA_DIR/.data_store.json` on a
  VPS (back this file up), or Upstash Redis on Vercel (`KV_REST_API_URL`,
  `KV_REST_API_TOKEN`).
- A sync sends only what changed since the last one, in batches small enough
  for Vercel's request limit. Chapter texts are stored apart from the account
  and fetched the first time a chapter is opened on another device. Sound
  recorded on a device stays on it.

## Accounts

The app is for one person. With `ALLOW_REGISTRATION` empty, the first account
can be created and registration closes after it. `true` opens registration to
anyone, `false` closes it completely. Set `SESSION_SECRET` (at least 32
characters) on Vercel; on a VPS one is generated in `DATA_DIR/.session_secret`.

## AI

The server's `GEMINI_API_KEY` (or `API_KEY`) is used when the app's AI
settings have no key. In the settings you can instead pick Gemini, Groq,
OpenRouter, DeepSeek or a local Ollama, each with its own key. When the AI
fails, word extraction falls back to the free dictionaries and says why.
