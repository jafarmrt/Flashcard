# Lingua Cards — notes for the AI assistant

Read this first. It is the hand-over from earlier sessions: what the project
is, how to work on it, and what is still open. Keep it up to date when
something here changes.

The same notes serve opencode (reads AGENTS.md, MCP in `opencode.json` and
the global `~/.config/opencode/opencode.jsonc`) and Claude Code (CLAUDE.md
imports this file, MCP in `.mcp.json`). Keep both MCP lists alike.

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

- `npm install`, `npx tsc --noEmit` (type-check), `npm test` (node:test, ~320
  tests), `npm run build`, `npm run lint:hooks` (ESLint with only the two
  React hooks rules; 7 old exhaustive-deps warnings still to review).
- A changed package.json also needs bun.lock updated:
  `npx -y bun@1 install --lockfile-only` (bun is not installed globally).
- Context7 MCP gives current docs for Dexie, React 19, Vite, Tailwind: use it
  before writing code against a library API you are unsure of.
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

## Telegram (7.8.0)

- server/telegram.ts holds the bot (pure logic over `TgDeps`, tested with
  fakes in tests/telegram.test.ts); server/api.ts builds the deps
  (`telegramDeps`), the app's actions `telegram-status/-link/-update/-send/
  -unlink`, and `handleTelegram` for /api/telegram (api/telegram.ts on
  Vercel, `app.all` in server.ts).
- Keys: `tg:user:<name>` (chat, words per day, tz offset, today's queue),
  `tg:chat:<id>` → name, `tg:code:<code>` (one-time link, 15 min).
- A rating goes into the account with `applyChanges` (new rev, a studyHistory
  log), so devices get it on their next sync.
- Daily: Vercel cron `30 4 * * *` (08:00 Tehran; Hobby allows one run a day)
  calls GET /api/telegram?cron=1 with `Authorization: Bearer $CRON_SECRET`;
  a VPS checks every 10 minutes and sends after 08:00 local
  (`startTelegramWorker`). `TELEGRAM_POLLING=true` makes a server poll
  instead of using the webhook (set on each link from the request's host).
- Env: `TELEGRAM_BOT_TOKEN` (required), `CRON_SECRET`, optional
  `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_POLLING`.
- Telegram is blocked from this machine: only the fakes and
  tests/telegramApi.test.ts (mocked fetch) have run it. Not yet tried live.

## Calm mode (7.8.0)

`Settings.playful` unset = calm (services/calm.ts `isPlayful`): game parts
are hidden in TodayView, StudyView (calm end screen), Navigation, MeView,
ProfileView, LibraryView `ChapterPath` (table of contents), the reader's XP
text, and `gameToast` in useAppLogic. XP and badges are still counted.

## What is done (latest first)

- 7.8.0: Telegram daily review (above); calm mode; plain stage names
  (masteryService STAGE_NAMES); gloss above words with new cards
  (services/gloss.ts, ReaderText `glosses`, `Settings.readerGloss`); active
  reading time per book and day (services/readingTime.ts `ActiveClock` in
  ReaderScreen, `Source.reading`, merged per day in syncStore `mergeRow`);
  "what happened so far" (services/recap.ts, components/reader/Recap.tsx);
  next chapter's coverage on the chapter's end page
  (components/reader/ChapterCoverage.tsx, coverage `knownByTerms`); book,
  chapter and section reviews default to cloze; «ترجمهٔ پاراگراف» in the word
  sheet; `Settings.openBookOnStart`; StatsView as «پیشرفت»
  (readingStats `readingSummary`, `yearGrid`).
- 7.7.0: a word that has a card shows the card in the reader
  (services/cardLookup.ts, ChunkReaderView `lookUp` short-circuit and the
  `shown` item in the sheet) and in a review's sentences (StudyView
  `LinkedText`); "today's plan" (services/todayPlan.ts, TodayView); a book's
  notes tab with Markdown export (components/library/SourceNotes.tsx,
  services/notes.ts `notesMarkdown`); FSRS: "Again" = 10-minute step the
  same day (interval 0), calendar days (`calendarDaysBetween`), a lapse only
  for a learned card once a day; fixes: failed review save, `callProxy`
  timeouts (25 s / 70 s, status 408), service worker trims least recently
  used and never the start files, `fillEmptyFields` for "complete all",
  file store hands out copies so rollback works. Tooling: ESLint hooks rules,
  Context7, CLAUDE.md, .mcp.json.
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

## Direction (from the user)

The app is first a way to read English books with ease; learning grows out
of reading. The user does not like the Duolingo-style parts (XP, levels,
combo, streak, badges, confetti, chests, the "garden"): since 7.8.0 they are
hidden by default (calm mode) but still in the code. Ask before deleting
them for good. Phases A–D of the 7.7.0 plan (calm mode, reading flow,
learning from the book, progress that means something) shipped in 7.8.0.

## Open ideas (ask the user before starting)

1. Try the Telegram bot live (set the env on Vercel, link, wait for a day's
   message) and ask how it feels; maybe a choice of hour (needs an hourly
   cron, which Vercel Hobby does not allow, or an outside cron service).
2. Pronunciation has not yet been tried with a real voice and a real Gemini /
   OpenRouter key on the deployed site; ask the user how it went.
3. Delete the hidden game code for good, if the user says so.
4. 7 old exhaustive-deps warnings (`npm run lint:hooks`).
