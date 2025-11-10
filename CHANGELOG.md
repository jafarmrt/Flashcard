# Changelog

All notable changes to this project will be documented in this file.

## [2.0.8] - Mobile UI Fix

-   **Fix:** Resolved a layout bug in the "All Cards" list where the audio playback button was not visible on mobile devices. The text content was not truncating correctly, pushing the action buttons off-screen. The button is now always visible.

## [2.0.7] - Study Session Stability

-   **Fix:** Resolved a bug in the "Study" view where the flashcard would unexpectedly change or reset shortly after the session started. This was caused by the background cloud sync refreshing the component's data. The study session is now properly isolated and will no longer be interrupted.

## [2.0.6] - Reliable Audio Source

-   **Fix:** Replaced the unreliable AI-based audio generation with a direct integration to the Free Dictionary API. This provides faster, more consistent pronunciation audio and resolves the persistent bugs related to the Text-to-Speech model.

## [2.0.5] - Audio Generation Voice Fix

-   **Fix:** Resolved a persistent audio generation failure by switching the Text-to-Speech voice from 'Zephyr' to 'Kore'. 'Zephyr' is intended for the real-time Live API, and its use with the standard TTS model caused the API to return no audio data. Using the compatible 'Kore' voice ensures audio is now generated correctly.

## [2.0.4] - Audio Generation Syntax Fix

-   **Fix:** Resolved a critical syntax error in the audio generation service (`new new DataView()`) that was causing all audio processing to fail. This fix ensures that pronunciation audio is now reliably generated and playable.

## [2.0.3] - Audio Generation Hotfix

-   **Fix:** Addressed a persistent issue where pronunciation audio failed to generate. The request to the Text-to-Speech AI model has been made more explicit to ensure it correctly interprets single-word inputs, resolving the bug.

## [2.0.2] - Critical AI Proxy Fix

-   **Fix:** Resolved a critical bug in the server-side proxy that caused all AI content generation (both text details and audio) to fail. The proxy was incorrectly structuring requests to the Gemini API. This has been fixed, and all AI features are now fully functional.

## [2.0.1] - Audio Playback Fix

-   **Fix:** Resolved a bug where the audio playback button was not appearing on flashcards. The server proxy was sending a malformed request to the Text-to-Speech API. This has been corrected, and audio will now be generated successfully for new and AI-updated cards.

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