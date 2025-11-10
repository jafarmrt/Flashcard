# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - Quizzes & Imports

-   **Feature:** Revamped "Practice" view into a multiple-choice quiz. Every 6 hours, the app generates 10 questions based on your cards to test your knowledge.
-   **Feature:** Added CSV Import functionality. You can now import your flashcards from a CSV file, making it easy to add cards in bulk.
-   **Feature:** Added a system health indicator in the footer to show the status of the database and API connections.
-   **UI/UX:** Added a speaker icon to play audio directly from the "All Cards" list.
-   **UI/UX:** Improved the in-app changelog viewer to correctly format and display version history.
-   **Fix:** Ensured deck names are unique and handled case-insensitively during creation and import to prevent duplicates.

## [1.8.0] - In-App Changelog

-   **Feature:** Added an in-app changelog viewer, accessible from the footer, to allow users to track version history and new features directly within the application.
-   **Chore:** Bumped application version.

## [1.7.1] - Sync Hotfix

-   **Fix:** Improved cloud sync logic to prevent infinite loops and unnecessary data refreshes, resolving issues with the UI jumping or showing a continuous loading spinner.
-   **Chore:** Minor UI adjustments and stability improvements.

## [1.7.0] - Cloud Sync & Proxy

-   **Feature:** Introduced Automatic Cloud Sync. Data is now saved to the cloud and synchronized across devices using a unique Sync Key.
-   **Security:** Implemented a secure server-side proxy using Vercel Serverless Functions to protect the API key. All API calls are now routed through `/api/proxy`.
-   **Tech:** Integrated Vercel KV (Redis) for cloud data storage.

## [1.6.0] - Stats View

-   **Feature:** Added a "Stats" view to provide users with insights into their learning progress.
-   **Stats Features:**
    -   Study Streak: Tracks consecutive days of study.
    -   7-Day Activity Chart: Visualizes review counts over the last week.
    -   Difficult Cards: Lists cards frequently marked as "Again".
-   **DB:** Added a `studyHistory` table to the local database to log review sessions.

## [1.5.0] - Conversation Practice

-   **Feature:** Introduced "Conversation Practice" view.
-   **AI:** Users can now engage in a text-based chat with a Gemini-powered AI tutor that uses vocabulary from their flashcards.

## [1.4.0] - Type-in-Answer Mode

-   **Feature:** Enhanced the "Study" view with a new "Type the Answer" mode.
-   **Tech:** Implemented Levenshtein distance algorithm to allow for minor typos in user answers.

## [1.3.0] - Advanced AI Tools

-   **Feature:** Added more AI-powered learning tools to the flashcard form.
    -   **Pronunciation Feedback:** Users can record themselves saying a word and receive AI feedback on their pronunciation.
    -   **Grammar Explanation:** An "Explain Grammar" button provides a simple, Persian explanation of the example sentence's grammar.
-   **Permissions:** Added `microphone` permission to `metadata.json`.

## [1.2.0] - Audio Pronunciation

-   **Feature:** Integrated Text-to-Speech (TTS) functionality.
-   **AI:** Each AI-generated card now includes a playable audio pronunciation of the English word, powered by Gemini TTS.

## [1.1.0] - Deck Management

-   **Feature:** Implemented Deck Management.
    -   Users can now create, rename, and delete decks.
    -   A new "Decks" view was added to browse all decks.
    -   Cards are now associated with specific decks.

## [1.0.0] - Initial Release

-   **Core:** Basic flashcard CRUD (Create, Read, Update, Delete) functionality.
-   **Storage:** Local-first data storage using IndexedDB (via Dexie.js).
-   **Learning:** Spaced Repetition System (SRS) for scheduling card reviews.
-   **AI:** "AI Generate Details" feature to automatically populate card fields using Gemini.
-   **PWA:** Basic Progressive Web App support for offline access.