

# Changelog

All notable changes to this project will be documented in this file.

## [4.3.3] - Theme & Settings UI Fixes
- **Fix:** Resolved a critical bug where the theme switcher (Light/Dark/System) was not functional. Added the required `darkMode: 'class'` configuration for Tailwind CSS, enabling the theme toggle to work as intended.
- **UI/UX:** Improved the visual contrast of active options on the Settings page. The selected theme and default dictionary buttons now have a distinct, high-contrast style in dark mode, making the current selection clear.

## [4.3.2] - Settings UI Contrast Fix
- **Fix:** Corrected a visual bug in the Settings page where the active theme and dictionary options were nearly invisible in dark mode due to low color contrast. The selected option is now clearly highlighted with a lighter background, making it easy to see the current choice.

## [4.3.1] - Settings UI Fixes
- **Fix:** Resolved a critical bug where the theme switcher (Light/Dark/System) was not functional. Replaced the static Tailwind CSS file with the modern JIT CDN script to correctly enable dark mode class variants.
- **UI/UX:** Improved the visual contrast of active options in the Settings page. The selected theme and default dictionary buttons now have a distinct, high-contrast style in dark mode, making the current selection clear.

## [4.3.0] - Profile Page Revamp
- **Feature:** Revamped the **User Profile** page to create a more engaging and rewarding experience.
- **UI/UX:** Replaced the plain "Recent Activity" log with a new **"Recent Achievements"** section. This visually highlights the user's latest unlocked medals, making their accomplishments more prominent.
- **UI/UX:** Added a convenient "View All" button to the new achievements section, allowing users to navigate directly to their full collection of medals from their profile.
- **Improvement:** This change shifts the focus of the profile from a simple activity list to a showcase of the user's progress and milestones.

## [4.2.0] - UI Refresh & Dashboard
- **Feature:** Introduced a major UI/UX refresh for the main "Decks" screen to create a more modern, engaging, and informative user experience.
- **UI/UX:** Replaced the separate gamification widgets with a single, consolidated **Dashboard** header. This new component neatly organizes the Study Streak, Level/XP Progress, and a summary of Daily Goals into one sleek, at-a-glance view.
- **UI/UX:** Redesigned the **Deck Cards** to be more visually appealing and functional. Each card now features:
    - A subtle background gradient for more depth.
    - A new **progress bar** that clearly shows the number of cards due for review in that deck.
- **Improvement:** The overall layout of the main screen is now cleaner, more professional, and does a better job of highlighting the user's progress and daily tasks.

## [4.1.0] - Gamification: Daily Goals
- **Feature:** Introduced a new **Daily Goals** system to enhance user engagement and provide short-term motivation.
- **UI/UX:** Added a new "Today's Goals" widget to the main "Decks" screen, displaying three randomly assigned goals for the user to complete each day (e.g., "Review 10 cards," "Complete a quiz").
- **Gamification:** Users now earn bonus XP for completing each goal, with an additional special bonus for completing all goals in a single day.
- **Logic:** The system automatically refreshes goals every 24 hours and tracks progress as users interact with the app.

## [4.0.2] - Toast Notification Visibility Fix
- **Fix:** Resolved a critical UI bug where toast notifications (e.g., for achievements, updates) were hidden behind the bottom navigation bar on mobile devices.
- **Improvement:** Notifications are now responsively positioned. They appear centered above the bottom navigation on mobile for clear visibility and remain in the bottom-right corner on desktop.

## [4.0.1] - Dictionary Selection UI Fix
- **Fix:** Resolved a bug on mobile devices where the "Default Dictionary" dropdown would close unexpectedly when trying to select an option.
- **Improvement:** Replaced the dropdown with a more stable and user-friendly button group, improving the user experience on all devices and creating a more consistent design on the Settings page.

## [4.0.0] - User Authentication System
- **Major Feature:** Replaced the "Profile Sync Key" system with a standard **username and password authentication system**. This provides a more traditional, secure, and user-friendly way to manage accounts.
- **UI/UX:** Added a new **Login and Registration screen** that greets users when they first open the app.
- **Data Storage:** All cloud data (decks, cards, progress) is now securely tied to a user's account, not a shareable key.
- **Improvement:** Removed the "Profile Sync" section from the Settings page and replaced it with a simpler "Account" section showing the currently logged-in user and a "Logout" button.
- **Security:** Data is now properly namespaced per user on the backend, preventing any potential data crossover between accounts.

## [3.5.3] - Navigation Improvement
- **Improvement:** Clarified the main navigation by removing the "All Cards" button from the header. The "Decks" view is now the clear starting point for managing your content. The flat "All Cards" list is still accessible via a button on the Decks screen, creating a more intuitive and hierarchical user flow.

## [3.5.2] - Critical Profile Sync Fix
- **Fix:** Resolved a critical data loss bug where user profile information (name, bio) would disappear after being saved. The issue was caused by an incorrect cloud sync logic that discarded text changes if the user's XP hadn't increased. The sync mechanism has been rebuilt to use a timestamp, ensuring that the most recently edited profile data is always preserved across all devices.

## [3.5.1] - Profile Editor Fix
- **Fix:** Resolved a critical bug in the user profile editor where input fields would clear unexpectedly while typing. This was caused by the auto-sync feature refreshing data in the background. The form now correctly preserves user input during an edit session.

## [3.5.0] - User Profiles
- **Feature:** Introduced User Profiles. Users can now add their first name, last name, and a short biography.
- **Feature:** Each sync key now represents a unique user profile. This allows multiple users to use the same application on different devices by simply changing their Profile Key.
- **UI/UX:** Added a new "Profile" page, accessible from Settings, to view and edit user details, see progress statistics (Level, XP, Streak), and review recent activity.
- **Improvement:** The "Cloud Sync" feature has been rebranded as "Profile Sync". The UI now makes it clear that loading a new key will switch the active user profile, replacing all local data. This creates a robust multi-user experience.

## [3.4.0] - Comprehensive Cloud Sync Fix
- **Fix:** Resolved a critical data synchronization bug where user progress (study streak, XP, level, and achievements) was not synced between devices. The sync logic has been completely overhauled to include `studyHistory`, `userProfile`, and `userAchievements` data in addition to cards and decks.
- **Improvement:** The server-side merge logic is now more intelligent, combining study logs from all devices and ensuring the user profile with the most progress (highest XP) is kept, preventing data loss.
- **Result:** A user's entire application state, including their vital study streak, is now consistent across all devices linked with the same sync key.

## [3.3.1] - Localization Fix
- **Fix:** Translated the names and descriptions of all achievements from Persian to English to match the application's primary language.

## [3.3.0] - Gamification: Achievements & Badges
- **Feature:** Introduced a comprehensive achievements system to reward user milestones.
- **Achievements:** Added a variety of unlockable medals for goals like maintaining a study streak, creating cards, leveling up, mastering a deck, and getting a perfect quiz score.
- **UI/UX:** Created a new "Achievements" page, accessible from Settings, to display all possible medals and show which ones have been earned.
- **Notifications:** Users now receive a toast notification when they unlock a new achievement, providing immediate positive feedback.
- **Database:** Added a new `userAchievements` table to the local database to store progress.

## [3.2.0] - Gamification: XP, Levels & Streaks
- **Feature:** Introduced the first phase of gamification to make learning more engaging.
- **XP & Levels:** Users now earn Experience Points (XP) for completing activities like studying cards, creating new cards, and finishing practice quizzes. Gaining XP increases your user level.
- **UI/UX:** Added a new progress bar and level indicator on the main "Decks" screen to visualize your learning journey.
- **Streak Display:** The daily study streak is now prominently displayed with a flame icon on the main screen to provide daily motivation.
- **Database:** Added a new `userProfile` table to the local database to store gamification progress.

## [3.1.1] - Theme Switching Fix
- **Fix:** Resolved a critical bug where the theme switcher (Light/Dark/System) in the Settings page was not working. The application's Tailwind CSS configuration was missing the necessary `darkMode: 'class'` setting, which prevented the theme from being applied correctly.
- **Improvement:** The 'System' theme option is now more responsive. It will now automatically update the app's theme in real-time if the user changes their operating system's theme, without requiring a page refresh.

## [3.1.0] - Settings & Reliability
- **Fix:** Resolved a critical bug where the in-app changelog failed to load due to a network error. The changelog content is now embedded directly into the app for instant and reliable offline access.

## [3.0.2] - Cram Mode
- **Feature:** Added a new **"Study All Cards"** option in the Study Setup screen. This allows users to review all cards in a deck, regardless of their due date. This is perfect for cramming before a test or when you want to review everything.

## [3.0.1] - Bulk Add Reliability
- **Improvement:** Increased the processing timeout for each word in the "Bulk Add" feature from 7 seconds to 1 minute. This significantly improves the success rate for creating cards, especially on slower network connections or with more complex words.

## [3.0.0] - Gamification & Enhanced Study Experience
- **Feature:** Added **Customizable Study Sessions**. Before starting a study session, users can now access a setup screen with the following options:
    - **Filter Cards:** Choose to study only "New Cards", only "Review Cards", or all cards that are "All Due Today".
    - **Session Size:** Set a maximum number of cards to review in a single session.
- **Improvement:** This feature gives users more control over their learning, allowing for shorter, more focused study sessions tailored to their needs.

## [2.3.7] - Practice Quiz Gameplay Fix
- **Fix:** Corrected an issue in the "Practice" quiz where the context sentence, which often contained the answer, was shown before the user selected an option. The context is now revealed only after an answer is submitted, improving the quality of the quiz.

## [2.3.6] - Practice Quiz Timeout Fix
- **Fix:** Resolved a persistent timeout error in the "Practice" feature. The AI prompt for generating quiz questions was overly complex, causing delays.
- **Improvement:** The AI prompt has been simplified to be more direct, reducing processing time.
- **Performance:** Switched to a faster AI model (`gemini-2.5-flash`) for quiz generation, making the feature significantly more responsive and reliable.

## [2.3.5] - Bulk Add Timeout & Parallelism Fix
- **Fix:** Resolved a critical bug in the "Bulk Add" feature where all words would fail with a timeout error. The root cause was that API calls were being made sequentially (one after another), which took too long. The logic has been re-engineered to run the dictionary and AI API calls in parallel (at the same time), which drastically speeds up the process for each word.
- **Improvement:** The overall timeout for each word has been increased from 5 to 7 seconds as a safety buffer, making the feature more resilient to slow network conditions.
- **Result:** This change dramatically increases the success rate of the feature, making it reliable and functional as intended.

## [2.3.4] - Bulk Add Reliability & Speed
- **Feature:** Overhauled the "Bulk Add" feature to be significantly faster and more reliable.
- **Performance:** Implemented concurrent processing to fetch data for up to 3 words simultaneously, dramatically reducing the total time for large lists.
- **Reliability:** Added a 5-second timeout for each word. If a word's processing gets stuck, it is automatically cancelled and the process moves to the next word.
- **Reliability:** Implemented a smart dictionary fallback. If the primary dictionary API doesn't respond within 2.5 seconds, the system automatically tries the secondary API.
- **UI/UX:** The UI now provides much clearer feedback during processing, showing the status of each word (e.g., loading, done, timeout, error).
- **UI/UX:** At the end of the process, a summary report is shown, informing the user of how many cards were created successfully and how many failed.

## [2.3.3] - Cloud Sync Data Integrity Fix
- **Fix:** Resolved a critical data integrity bug in the cloud sync feature where deleted cards and decks could reappear. The server-side merge logic was flawed, allowing devices with old data to "undelete" items. The logic is now "deletion-aware," ensuring that once an item is deleted, it stays deleted across all synced devices. This prevents "ghost" cards from appearing in the Study view and ensures data consistency.

## [2.3.2] - Data Consistency Fix
- **Fix:** Resolved a critical data consistency bug where deleting a deck would not reliably delete all of its associated cards. This caused "ghost" cards to appear in the Study view even after they were supposed to be deleted. The deletion logic now correctly reads from the database within an atomic transaction to ensure all cards are removed, preventing this issue.

## [2.3.1] - Bulk Add Fix
- **Fix:** Resolved a critical bug in the "Bulk Add" feature where the view would get stuck on the initial input screen after clicking "Process Words". The UI now correctly transitions through the processing and review steps.

## [2.3.0] - Bulk Word Import
- **Feature:** Added a new "Bulk Add" feature accessible from the Decks screen.
- **UI/UX:** Users can now paste a list of words to automatically create multiple flashcards at once.
- **AI:** The bulk add process automatically fetches Persian translations, definitions, pronunciation, and audio for each word, with a progress indicator and review step.

## [2.2.3] - Critical Crash Fix

-   **Fix:** Resolved a critical crash (`.map is not a function` or `.join is not a function`) that occurred in the "Study" view and the "Edit Card" form. The app now correctly handles legacy flashcard data where `exampleSentenceTarget` or `definition` fields were saved as a string instead of an array. This ensures backward compatibility and prevents the app from crashing when viewing or editing older cards.

## [2.2.2] - Critical Stability Fixes

-   **Fix:** Resolved a critical crash (`definition.map is not a function`) in the "Study" view and "Edit Card" form. The app now correctly handles legacy flashcard data where the `definition` field was a string instead of an array, preventing crashes and ensuring backward compatibility.
-   **Fix:** Corrected the Service Worker registration process, which was failing to install due to a misconfiguration. This ensures PWA offline capabilities function correctly.
-   **Fix:** Removed references to non-existent PWA icon files (`icon-192x192.png`, etc.) that were causing 404 errors and contributing to the service worker failure.

## [2.2.1] - Study View Hang Fix

-   **Fix:** Resolved a critical bug where the "Study" view would get stuck on the "Loading..." screen indefinitely if the user attempted to study an empty deck or if no cards were currently due. The logic now correctly handles this scenario and shows the "You're all caught up!" message.

## [2.2.0] - Centralized Settings & Customization

-   **Feature:** Added a comprehensive "Settings" page to centralize application configuration and data management.
-   **Feature:** Added theme customization. Users can now choose between Light, Dark, and System themes.
-   **Feature:** Users can now set a default dictionary API source (Free Dictionary or Merriam-Webster) for new cards.
-   **UI/UX:** Consolidated Import/Export and Cloud Sync functionality into the Settings page to declutter the main interface.
-   **UI/UX:** Updated main navigation on both desktop and mobile to link to the new Settings page.
-   **Feature:** Added a "Danger Zone" to the settings for resetting all local application data.

## [2.1.3] - Study View Reliability Fix

-   **Fix:** Resolved a critical race condition that caused the "Study" view to fail or hang on startup. The component now waits for the flashcard data to be fully loaded before initializing the study session, ensuring it starts reliably every time.

## [2.1.2] - Study Session Fix

-   **Fix:** Resolved a critical bug in the "Study" view where the session would end prematurely if a card was marked as 'Again'. The logic now correctly handles the updated queue length, ensuring cards marked for repetition are properly reviewed within the same session.

## [2.1.1] - Study Performance Fix

-   **Fix:** Resolved a major performance issue that caused the application to hang or freeze when entering the "Study" view with a large number of cards. The logic for finding due cards has been optimized to avoid slow date calculations in a loop, making the study session start instantly.

## [2.1.0] - Dictionary APIs & Offline Audio

-   **Feature:** Separated data sources for more control. Card details (definition, pronunciation, etc.) are now fetched from reliable dictionary APIs, while AI is focused on generating Persian translations and notes.
-   **Feature:** Added support for two dictionary sources: the free `dictionaryapi.dev` and the Merriam-Webster API. Users can choose their preferred source in the card creation form.
-   **Feature:** Audio is now saved for offline use. The app downloads the pronunciation audio file once and stores it in the local database, allowing for instant, offline playback.
-   **Feature:** Added a new "Dict. API" status indicator in the footer to show the health of the dictionary services.
-   **UI/UX:** The card creation form has been updated with separate buttons to "Fetch Details" from a dictionary and "Generate Persian with AI".
-   **Fix:** Resolved a layout bug where the audio playback button in the "All Cards" list was not visible on mobile devices. The button is now always visible.

## [2.0.9] - Bug Fixes

-   **Fix:** Re-enabled Gemini Text-to-Speech for audio generation, replacing the dictionary API which was failing to provide audio URLs. The audio play button in the card list is now functional again.
-   **Fix:** Resolved an issue where the in-app changelog would fail to load. The changelog file is now cached by the service worker, making it available offline and ensuring it loads reliably.

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