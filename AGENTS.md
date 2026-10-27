# Lingua Cards — notes for the AI assistant

Read this first. It is the hand-over from earlier sessions: what the project
is, how to work on it, and what is still open. Keep it up to date when
something here changes.

## The user

- Speaks Persian: answer in Persian, short and clear. Code, comments and
  commit messages stay in English.
- Is the only user of the app (a Persian speaker learning English). Wants
  real learning value, not just features.
- Has asked that changes be committed and pushed to `main` once they are
  tested (Vercel deploys `main`). Still: say what was done and what was not
  tested before pushing.

## The project

- English learning app for Persian speakers: a library of books/articles read
  in ~300-word sections, flashcards with FSRS-5 review, pronunciation
  practice, AI services. Offline-first PWA.
- Repo: https://github.com/jafarmrt/Flashcard (branch `main`), local copy at
  `D:\Projects\flashcard`. Deployed on Vercel from `main`.
- Stack: React 19 + Vite + TypeScript + Tailwind, Dexie (IndexedDB) in the
  browser, one API endpoint `/api/proxy` (server/api.ts, action-based) run by
  Express (server.ts) locally/VPS and by Vercel (api/proxy.ts). Storage: JSON
  file (`DATA_DIR/.data_store.json`) or Upstash Redis on Vercel.
- UI is Persian, right to left (`dir="rtl"`, `font-fa`); English text sets
  `dir="ltr"`. Persian digits through `fa()` (components/common/ui.tsx).

## Commands (Windows, PowerShell 5.1)

- `npm install`, `npx tsc --noEmit` (type-check), `npm test` (node:test, ~290
  tests), `npm run build`.
- The npm test output is long; write it to a file and read the tail:
  `npm test *> "$env:TEMP\opencode\test.log"; Get-Content "$env:TEMP\opencode\test.log" -Tail 8`
- Do not rewrite files with `Set-Content`/`Out-File` (they add a BOM / break
  Persian text). Use the Edit/Write tools. Files use LF line endings.
- `package-lock.json` is local only (the repo uses `bun.lock`): never commit it.

## Rules of the codebase

- **Versions:** `CHANGELOG.md` is the only place a version is written. Every
  change users see gets an entry `## [x.y.z] - YYYY-MM-DD - Title` with
  `- **Label:** text` items, and `package.json` "version" must match the
  newest entry (tests/changelog.test.ts checks this). Feature: raise the
  middle number; fixes only: the last.
- Comments explain *why*, in plain English, in the style of the existing code.
- Pure logic goes in `services/*.ts` with tests in `tests/*.test.ts`.
- Synced tables: decks, cards, sources, chapters, occurrences, knownWords,
  speechAttempts, notes (services/syncClient.ts SYNC_TABLES and
  server/syncStore.ts ROW_TABLES must list the same). A new synced table also
  needs: types.ts, a Dexie version in services/localDBService.ts, readLocal /
  SYNC_DB_TABLES / the sync transaction / fingerprint in hooks/useAppLogic.ts,
  and syncState.ts.
- Chapter text lives apart from the sync (`chapter-put`/`chapter-get`);
  edits carry `editedAt`, and `Chapter.textEditedAt` makes other devices
  fetch the new text.
- AI: services/aiClient.ts tries the user's services in order (Gemini,
  Claude/Anthropic, Groq, OpenRouter, DeepSeek, Ollama, custom). Pronunciation
  only uses services that hear audio (services/aiSettings.ts
  `pronunciationOptions`: Gemini, OpenRouter audio models). Never send
  `temperature` to Claude (newer models refuse it).
- Security already done: private/IPv6-mapped addresses blocked for article
  fetch and custom AI base URLs (`ALLOW_PRIVATE_AI_URL=true` opts out).

## Testing in the browser

Playwright MCP is set up in opencode. To run the app locally with a throwaway
data folder, save this as `$env:TEMP\opencode\start-server.ps1` and start it
hidden:

```powershell
$env:DATA_DIR = "$env:TEMP\opencode\lc-data"
$env:PORT = '3000'; $env:HOST = '127.0.0.1'; $env:ALLOW_REGISTRATION = 'true'
Set-Location 'D:\Projects\flashcard'
npx tsx server.ts *> "$env:TEMP\opencode\lc-server.log"
```

`Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"$env:TEMP\opencode\start-server.ps1" -WindowStyle Hidden`
then open http://127.0.0.1:3000. Test accounts there: `ann` / `bob`,
password `long-enough-password-1` / `-2` (only if that data folder still
exists; otherwise register). Stop it with
`Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess`.

- No real microphone or AI keys on this machine: mock them (replace
  `navigator.mediaDevices.getUserMedia`, route `/api/proxy` `gemini-generate`).
- From this machine (Iran) Google and OpenRouter refuse requests ("User
  location is not supported", "Access denied by security policy"); Vercel's
  server is not affected. The app reports this as a region refusal.
- Windows speech (System.Speech) can check that a recording is intelligible.

## Git

- Work on a branch `feat/...`, then `git switch main; git pull --ff-only;
  git merge --no-ff <branch>; git push origin main <branch>`.
- `gh` is installed (`C:\Program Files\GitHub CLI\gh.exe`) but not logged in;
  pushing with git works.

## What is done (latest first)

- 7.6.0: books as pages (components/reader/BookPages.tsx, book layout in
  components/ChunkReaderView.tsx), continuous sections, end-of-chapter page,
  Aa panel (type size, paper, justify), editing a section's text
  (components/reader/TextEditor.tsx), notes and kept translations
  (services/notes.ts, table `notes`).
- 7.5.x: Claude as a service; pronunciation heard by Gemini or OpenRouter
  audio models; recordings sent as 16 kHz WAV, boosted when quiet, silence not
  sent; answers that did not really hear ("leaked audio") are not saved;
  scores checked against what was heard word by word.
- 7.4.0: pronunciation in the book's sentence with word-by-word feedback and
  its own review schedule; safe sign-out (another account's data is cleared);
  versions read from CHANGELOG.md.

## Open ideas (ask the user before starting)

1. A page in the library listing all notes and kept translations of a book,
   with export.
2. One "today's plan" on the Today screen: due cards, due pronunciation items
   and a reading section.
3. FSRS fixes: lapses counted too often (services/srsService.ts), "same day"
   measured as 24 h instead of the calendar date, no learning steps.
4. From the first code review, still open: a failed save freezes a study
   session (components/StudyView.tsx `rate`, no try/finally); no timeout on
   `/api/proxy` requests (services/apiService.ts); the service worker trims
   its cache oldest-first and can drop the main bundle
   (public/service-worker.js); "auto-fix all" can overwrite reviews made
   meanwhile (hooks/useAppLogic.ts handleCompleteCardDetails); the JSON file
   store's rollback on a failed write does nothing (server/api.ts setKey,
   getKey returns the cached object).
5. Pronunciation has not yet been tried with a real voice and a real Gemini /
   OpenRouter key on the deployed site; ask the user how it went.
