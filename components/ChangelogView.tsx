import React from 'react';

interface ChangelogViewProps {
  onBack: () => void;
}

const changelogText = `# Changelog

All notable changes to this project will be documented in this file.

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
- **Improvement:** Added a \`createdAt\` timestamp to all new cards to enable more accurate sorting by "latest". A database migration ensures older cards have a fallback creation date.

## [4.9.6] - Code Refactoring & Maintainability
- **Refactor:** Restructured the main application component (\`App.tsx\`) for improved maintainability and scalability. Core business logic, state management, and side effects were extracted into a dedicated custom hook (\`useAppLogic\`).
- **Improvement:** Utility functions (API calls, CSV handling) and smaller UI components were moved into separate, organized files. This architectural enhancement makes the codebase cleaner, easier to navigate, and simplifies future updates.

## [4.9.5] - Data Sync & UI Fixes
- **Fix:** Resolved a critical data sync bug that could cause daily goal progress to be reset when using the app across multiple devices or sessions. The cloud merge logic now correctly handles and preserves daily goal data.
- **UI/UX:** Corrected the label on the "Back" button on the **Stats** page. It now accurately reads "Back to Decks" to match its behavior, eliminating user confusion.

## [4.9.4] - Critical Data Persistence Fix
- **Fix:** Resolved a critical bug that caused user data loss (including study history, daily goals, streak, and XP) after an application update. The local database versioning logic was flawed, causing tables to be deleted during schema upgrades. The database migration process has been corrected to ensure all existing user data is preserved across all future updates.

## [4.9.3] - Improved Card Sorting
- **UI/UX:** The "All Cards" list now defaults to sorting alphabetically by the English word (front of the card). This provides a more intuitive and organized view for users browsing their entire collection. The option to sort by other columns remains available.

## [4.9.2] - Bulk Add Resiliency & Control
- **Improvement:** Cards in the Bulk Add process are now considered successful and can be saved even if the audio fetch fails, as long as essential details (translation, definition) are retrieved.
- **Feature:** Added a "Retry All Failed" button to the review screen, allowing users to re-process all words that encountered an error without starting over.
- **Improvement:** The individual retry logic for specific parts (Dictionary, AI, Audio) is now more robust. A successful partial retry will now correctly update the overall status of the word, allowing it to be saved.

## [4.9.1] - Context-Aware Navigation
- **Improvement:** The card editor form is now context-aware. After saving or canceling, the app will return you to your previous screen ("Decks" or "All Cards") instead of always navigating back to the "Decks" view. This creates a more intuitive and seamless user flow.

## [4.9.0] - Interactive Bulk Add Review
- **Feature:** Users can now directly see and edit the Persian translation and notes for successfully processed words in the Bulk Add review screen. This provides greater control over the final card content before saving, reducing the need for later edits.
- **UI/UX:** The review list is now more compact, showing the translation next to the original word, making it easier to scan.

## [4.8.0] - Bulk Add Audio & Stability Fix
- **Fix:** Resolved a critical bug preventing audio pronunciation from being downloaded in the Bulk Add feature. Audio requests are now routed through a secure proxy to bypass browser CORS restrictions.
- **Fix:** Fixed an issue where the Bulk Add process would hang indefinitely if an error occurred (especially with audio fetching). The processing logic is now more robust and ensures the process always completes, correctly reporting success or failure for each word.

## [4.7.0] - Bulk Add Inspector & Smart Retry
- **Feature:** Added a new "Inspector" to the Bulk Add review screen. Users can now click on any word to see a detailed breakdown of the data fetching process, including which APIs were used (Dictionary, AI, Audio) and the success or failure status of each.
- **Feature:** Implemented a "Smart Retry" system. If a specific part of the process fails for a word (e.g., AI times out but the dictionary lookup succeeds), a retry button will appear next to that specific part. This allows users to re-fetch only the missing data without losing the information that was already successfully retrieved.
- **Improvement:** Error messages in the Bulk Add view are now much more specific, showing the exact reason for failure (e.g., "Word not found," "AI timed out") to help diagnose issues.

## [4.6.0] - Bulk Add Enhancements & Configuration
- **Feature:** Words that fail during the Bulk Add process can now be retried individually or all at once. Failed words can also be manually removed from the list, giving users full control over the process.
- **Feature:** Added a new section in Settings to customize the Bulk Add feature. Users can now control the processing speed and reliability by adjusting the number of concurrent requests (1-3) and setting custom timeouts for the AI and Dictionary APIs.

## [4.5.0] - Stability & Polish
- **Performance:** Improved database performance by adding an index to a frequently queried field. This makes loading data, especially on the **Stats** page, significantly faster for users with a large number of cards.
- **UI/UX:** Implemented a skeleton loader for the **Stats** page. Instead of a simple "Loading..." message, the app now displays an animated placeholder that mimics the page layout, creating a smoother and more professional user experience.
- **Fix:** Resolved a minor UI bug on the **All Cards** screen where very long deck names could disrupt the layout. Long names are now gracefully truncated with an ellipsis.

## [4.4.1] - UI Polish & Version Fix
- **Fix:** Corrected the application version number displayed on the **Settings** page, which had not been updated in the previous release. It now accurately reflects the latest version.
- **UI/UX:** Improved the tooltip on the **Stats** page's activity heatmap. Hovering over a day now shows the full, unambiguous date (e.g., "Friday, July 26, 2024"), making it much easier to identify specific days and their activity levels.

## [4.4.0] - Stats Page Overhaul & Bug Fix
- **Feature:** Revamped the **Stats** page to provide more meaningful and actionable insights.
- **UI/UX:** Replaced the simple 7-day bar chart with a comprehensive 90-day **Activity Heatmap**, offering a clearer long-term view of study consistency.
- **Feature:** Introduced a new **"Knowledge Breakdown"** section, which includes:
    - **Difficult Cards:** The existing list, but now more accurate.
    - **Review Soon:** A new list showing cards due in the next 7 days.
    - **Mastered Cards:** A new list showcasing cards with a review interval greater than 30 days.
- **Fix:** Resolved a critical bug where deleted cards were incorrectly appearing in the "Difficult Cards" list. The calculation now correctly filters out deleted cards, ensuring the data is accurate.

## [4.3.3] - Theme & Settings UI Fixes
- **Fix:** Resolved a critical bug where the theme switcher (Light/Dark/System) was not functional. Added the required \`darkMode: 'class'\` configuration for Tailwind CSS, enabling the theme toggle to work as intended.
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
    - A subtle`;


const renderChangelog = (text: string) => {
  const lines = text.split('\n');
  const elements = [];
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(<ul key={`ul-${elements.length}`} className="list-disc pl-6 space-y-1 my-4">{listItems}</ul>);
      listItems = [];
    }
  };

  lines.forEach((line, index) => {
    if (line.startsWith('## [')) {
      flushList();
      elements.push(<h2 key={index} className="text-xl font-bold mt-6 mb-2 border-b border-slate-200 dark:border-slate-700 pb-2">{line.substring(3).trim()}</h2>);
    } else if (line.match(/^-\s+\*\*/)) {
      const content = line.substring(line.indexOf('**') + 2).replace(/\*\*:/, ':');
      const parts = content.split(':');
      const label = parts[0];
      const description = parts.slice(1).join(':');
      listItems.push(
        <li key={index}>
          <strong className="font-semibold text-slate-800 dark:text-slate-100">{label}:</strong>
          <span className="text-slate-600 dark:text-slate-300">{description}</span>
        </li>
      );
    } else if (line.trim() === '') {
      flushList();
    } else {
        if (line.startsWith('# ')) {
            flushList();
            elements.push(<h1 key={index} className="text-3xl font-bold mb-4">{line.substring(2)}</h1>);
        } else if (listItems.length === 0) { // Don't treat blank lines within lists as paragraphs
             elements.push(<p key={index} className="text-slate-600 dark:text-slate-400">{line}</p>);
        }
    }
  });

  flushList(); // Add any remaining list items
  return elements;
};


export const ChangelogView: React.FC<ChangelogViewProps> = ({ onBack }) => {
  return (
    <div className="max-w-3xl mx-auto bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4 text-slate-800 dark:text-slate-100">Version History</h2>
      <div className="prose dark:prose-invert max-w-none bg-slate-50 dark:bg-slate-900/50 p-4 rounded-md h-96 overflow-y-auto">
          {renderChangelog(changelogText)}
      </div>
      <div className="text-center mt-6">
        <button onClick={onBack} className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-md hover:bg-indigo-700 transition-colors">
          Back to Settings
        </button>
      </div>
    </div>
  );
};