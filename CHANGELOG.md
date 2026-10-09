# Changelog

All notable changes to this project will be documented in this file.

## [7.1.0] - Books: Reviews, Difficulty and Progress
- **Review by book:** Each book and chapter reviews its own cards (due ones first, else the weakest); a chapter's hard words can be pre-studied before reading it.
- **Gap in the sentence:** A new review mode («جای خالی») leaves the word out of the book's sentence; a typo or another form counts as close.
- **Difficulty:** A book's page shows how many of its words you know, new words per section and the text's level, measured once with a 400-word sample.
- **Bookshelf and rewards:** The library is a shelf (reading, not started, finished); finishing a chapter or book gives extra XP and badges; reading counts toward the daily goal.
- **Stats:** Rewritten in Persian, with each book's words over time and the hardest words to review.
- **Persian everywhere:** Decks, the word list, the card form, bulk add, review setup, badges, profile and all messages.

## [7.0.0] - Library, Reading Mode and Checks
- **Library:** Books (EPUB), articles (a link) and texts in one library, read section by section, with the place every card came from and which service made it.
- **Reading:** A tap gives the meaning in the sentence; drag over words for a phrase or a sentence (meaning, grammar, translation); «بلدم» takes a word off the suggestions for good; words are underlined by how well you know them; a section's hard words can be shown before reading it.
- **AI services:** Several services in the order you choose, each with its own key; when one fails the next is asked, then the free dictionaries. A usage page shows requests, failures, cards per service, the free translation quota and data size.
- **Checks:** Word levels (A1 to C2); a «بررسی» tab per book for cards the dictionary did not know, without a Persian meaning, or not in their sentence; an AI meaning check of 20 cards at a time whose suggestions you accept or keep.
- **Grammar:** About 20 structures found by the app's own rules and underlined while reading, each with a built-in Persian explanation and exercise; reviewing a grammar card asks for your own sentence, checked by the rules and, with AI, explained, with a suggested rating.
- **Settings:** Now in Persian.
- **Matching:** A card's term is found in a text without its placeholders («take something into account» finds «took the cost into account») and in irregular plurals («children» for «child»).

## [6.0.0] - New Look: Today Screen, Reading Path & Fairer Rewards
- **Design:** A Persian, right-to-left interface with the Vazirmatn font; English words and texts stay left-to-right. Older screens (decks, card list, settings, stats, practice) keep their English layout inside the new frame.
- **Design:** On a computer a side menu lists every section (Today, Review, Practice, Texts, Words, Stats, Settings) with quick-add buttons and the sync status. On a phone there are four tabs (Today, Texts, Words, Me) and an add button.
- **Feature:** The Today screen is the new home: a daily goal ring with one Start Review button for all due cards, typing and practice shortcuts, this week's streak days, a "word garden" of mastery stages, and the text you are reading.
- **Feature:** The review screen shows the word, its pronunciation and your source sentence, then the meaning, expressions, definitions and examples on the same card. Each of the four FSRS buttons shows when the card comes back. Keyboard: Space shows the answer, 1-4 rate, P plays, Z undoes the last answer, Esc ends.
- **Feature:** A session summary shows XP, first-try accuracy, time, your streak and the words that moved up a stage, with "10 more cards" and confetti when the daily goal is reached.
- **Feature:** Texts are kept as a path of 300-word sections. Each section opens in a reader where you find its hard words (AI or free dictionaries), tap any word to look it up, make cards into the text's deck, and finish the section. Texts sync like cards. The one-shot extractor is still there as "استخراج یکجا".
- **Gamification:** XP now comes from reviews (more for a correct answer, plus a bonus for 5 right in a row) and from finishing text sections, not from adding cards. The daily goal is a fixed number of reviews you choose in Settings (default 20) instead of random goals.
- **Gamification:** Streak freezes: every third finished section gives one (you can hold two), and a freeze covers a missed day automatically so the streak survives.
- **Words:** Each card has a mastery stage from its FSRS stability: seed, sprout, sapling, tree, rooted.

## [5.4.0] - FSRS Scheduling
- **Feature:** Reviews are now scheduled with FSRS-5, which tracks how well you know each card (stability and difficulty) and shows it again just before you are likely to forget it, aiming for 90% recall. It needs noticeably fewer reviews than the old SM-2 rule for the same retention.
- **Feature:** A fourth answer button, **Hard**, sits between Again and Good. Each button shows when the card will come back (for example `3d`, `2mo`).
- **Improvement:** Existing cards keep their schedule: their current interval and easiness are converted to FSRS the first time you review them.
- **Fix:** A card answered "Again" and repeated in the same session now continues from that answer instead of being scored twice from its old state.

## [5.3.0] - Long Texts, Richer Cards & Free Dictionary Mode
- **Feature:** Long texts are split into sections of at most 300 words on sentence boundaries; each section is analysed on its own with a progress bar and a Stop button, and the results are merged without repeats.
- **Feature:** Terms that already have a card are excluded from the AI request and flagged ("قبلاً کارت دارد") instead of being added again.
- **Feature:** Cards now keep the exact sentence of your text, 3-5 common expressions that use the term (each with a listen button), a type (word, phrase, idiom, grammar) and, for grammar structures, the pattern and a sentence-building exercise. Every sentence and expression on a study card can be read aloud.
- **Feature:** "Free dictionaries" extraction works without AI: hard words are chosen by word frequency for your level, phrasal verbs are kept when a dictionary knows them, and meaning, IPA, audio, Persian translation (MyMemory) and common expressions (Datamuse) are fetched for each. If AI fails for a section, that section falls back to this mode automatically.
- **Fix:** A failed AI translation no longer saves "Could not generate translation." onto the card; "Complete card" now uses your AI settings and falls back to a free translation, and also adds common expressions.
- **Fix:** The Express server crashed on start in production mode (`app.get('*')` is invalid in Express 5).

## [5.2.1] - Secure Cloud Sync
- **Security:** Cloud sync now needs a real sign-in. The server sets a signed, HttpOnly session cookie at login, and sync only reads or writes the signed-in account. Before, anyone who knew a username could read or overwrite its cards.
- **Security:** Passwords are stored as scrypt hashes. Existing plain-text passwords are converted the next time you sign in.
- **Security:** Five wrong passwords lock that username from that address for 15 minutes.
- **Security:** The audio proxy only fetches from known dictionary hosts, and the API no longer accepts calls from other websites.
- **Setting:** `ALLOW_REGISTRATION=false` closes sign-up once your account exists. Everyone has to sign in once after this update.

## [5.2.0] - Auto-Fix Reporting & Stability Fixes
- **Feature:** Added a detailed report summary after the "Auto-Fix All" process completes. You can now see exactly how many cards were updated and what specific information (Audio, Definitions, Translations, etc.) was added to your collection.
- **Fix:** Resolved a critical issue where cards updated via "Auto-Fix" would revert to their previous state after a few moments. This was caused by a race condition in the background synchronization process, which has now been fixed by pausing sync during intensive operations and improving the data merge strategy.

## [5.1.1] - Improved Study Logic & Stats Redesign
- **Fix:** Refined the "New Cards" filter logic for study sessions. Previously, cards marked as forgotten ("Again") were incorrectly included in the "New Cards" list. The filter now ensures only truly new cards (never successfully reviewed) are shown.
- **Feature:** Redesigned the "Stats" page. The 90-day heatmap has been replaced with a cleaner, more intuitive "Weekly Activity" bar chart, giving you a clearer view of your recent study habits.

## [5.1.0] - Auto-Fix All Feature
- **New Feature:** Added a "Magic Wand" button to the "All Cards" list. With a single click, the app now scans your entire collection for incomplete cards (missing audio, definitions, translations, etc.) and automatically fetches the missing details.
- **Improvement:** This process runs intelligently in the background, skipping cards that are already complete to save time and data. A progress indicator allows you to monitor the operation, and a "Stop" button provides control if you wish to pause.

## [5.0.9] - Bulk Add Stability Fix
- **Fix:** Resolved a race condition in the Bulk Add feature where manual edits to a card's translation or notes could be overwritten by a delayed AI response. The app now respects your inputs and will not overwrite existing content with AI suggestions.
- **Fix:** Fixed an issue where the edit form in Bulk Add would reset while typing if other parts of the card (like audio) finished loading in the background.

## [5.0.8] - Daily Goals Stability Fix
- **Fix:** Resolved a critical bug where "Today's Goals" charts would disappear or reset immediately after a practice session. This was caused by a conflict between the server's UTC time and the user's local timezone, leading the app to incorrectly believe it was already "tomorrow" during evening usage. The app now correctly uses your local date for tracking daily progress.

## [5.0.7] - Accessibility & Bandwidth Optimization
- **Accessibility Fix:** Resolved an accessibility issue in the login/registration form where input fields were not associated with their labels. This improves the experience for users relying on screen readers.
- **Optimization:** Pronunciation audio files fetched from dictionaries are now cached on the Edge network for 24 hours. This significantly reduces bandwidth usage and speeds up playback for frequently accessed words.

## [5.0.6] - Reliability Improvements
- **Fix:** Addressed a potential crash in the "Practice" mode caused by an undefined variable when shuffling cards.
- **Improvement:** The "Bulk Add" feature now provides clearer feedback when the dictionary service times out, distinguishing it from other network errors.

## [5.0.5] - Stability & UX Fixes
- **Fix:** Improved error handling in "Practice" mode. If the AI service fails to generate a quiz, a user-friendly message is now shown on the screen instead of a disruptive system alert.
- **Fix:** Resolved a Service Worker registration error that could cause a 404 error in the browser console and prevent offline capabilities from working correctly.

## [5.0.4] - Practice Mode Reliability Fix
- **Fix:** Resolved a critical issue where the AI-powered "Practice" mode would frequently fail or time out. The quiz size has been reduced from 10 to 5 questions to create a lighter, faster API request.
- **Improvement:** Added validation to ensure only cards with valid English words are used to generate quizzes, preventing errors and improving stability.

## [5.0.3] - Data Persistence Fix
- **Fix:** Resolved a critical data loss bug where recent edits to a flashcard could be overwritten by an automated cloud sync. A new timestamp-based sync logic has been implemented. Now, when syncing, the app compares the local and cloud versions of a card and always keeps the one that was most recently updated, ensuring no work is ever lost.

## [5.0.2] - Practice Mode Fix
- **Fix:** Resolved a major issue where the "Practice" feature would not work if the user had fewer than 4 "new" cards. The quiz generation logic is now more flexible, prioritizing new cards, then falling back to cards due for review, and finally using any available cards to ensure the feature is always accessible.

## [5.0.1] - Concurrency Fix & UI Polish
- **Fix:** Resolved a critical data integrity bug in the "All Cards" list where making rapid, consecutive changes to different cards could cause previous updates to be reverted. The inline completion logic now fetches the latest card data directly from the database to prevent race conditions.
- **UI/UX:** The loading spinner on the inline "Complete Card" button is now centered and more visually stable during the update process.

## [5.0.0] - "All Cards" Page Overhaul
- **Feature:** Added advanced sorting options to the "All Cards" list. Users can now sort by English (A-Z, Z-A), Persian (A-Z, Z-A), latest added, and cards that are missing audio.
- **Feature:** Implemented pagination for the "All Cards" list, displaying 100 cards per page to improve performance and usability for large collections.
- **Feature:** Introduced an inline "Complete Card" feature. Cards with missing information (audio, definition, etc.) now show visual indicators. A new "magic wand" button allows users to automatically fetch all missing details for a single card using AI and dictionary APIs directly from the list view, without needing to open the editor.
- **Improvement:** Added a `createdAt` timestamp to all new cards to enable more accurate sorting by "latest". A database migration ensures older cards have a fallback creation date.
