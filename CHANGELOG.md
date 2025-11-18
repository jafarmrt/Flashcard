# Changelog

All notable changes to this project will be documented in this file.

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
