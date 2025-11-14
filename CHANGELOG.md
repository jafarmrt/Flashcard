

# Changelog

All notable changes to this project will be documented in this file.

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
    - A subtle--- START OF FILE components/ChangelogView.tsx ---

import React from 'react';

interface ChangelogViewProps {
  onBack: () => void;
}

const changelogText = `# Changelog

All notable changes to this project will be documented in this file.

## [3.4.0] - Comprehensive Cloud Sync Fix
- **Fix:** Resolved a critical data synchronization bug where user progress (study streak, XP, level, and achievements) was not synced between devices. The sync logic has been completely overhauled to include \`studyHistory\`, \`userProfile\`, and \`userAchievements\` data in addition to cards and decks.
- **Improvement:** The server-side merge logic is now more intelligent, combining study logs from all devices and ensuring the user profile with the most progress (highest XP) is kept, preventing data loss.
- **Result:** A user's entire application state, including their vital study streak, is now consistent across all devices linked with the same sync key.

## [3.3.1] - Localization Fix
- **Fix:** Translated the names and descriptions of all achievements from Persian to English to match the application's primary language.

## [3.3.0] - Gamification: Achievements & Badges
- **Feature:** Introduced a comprehensive achievements system to reward user milestones.
- **Achievements:** Added a variety of unlockable medals for goals like maintaining a study streak, creating cards, leveling up, mastering a deck, and getting a perfect quiz score.
- **UI/UX:** Created a new "Achievements" page, accessible from Settings, to display all possible medals and show which ones have been earned.
- **Notifications:** Users now receive a toast notification when they unlock a new achievement, providing immediate positive feedback.
- **Database:** Added a new \`userAchievements\` table to the local database to store progress.

## [3.2.0] - Gamification: XP, Levels & Streaks
- **Feature:** Introduced the first phase of gamification to make learning more engaging.
- **XP & Levels:** Users now earn Experience Points (XP) for completing activities like studying cards, creating new cards, and finishing practice quizzes. Gaining XP increases your user level.
- **UI/UX:** Added a new progress bar and level indicator on the main "Decks" screen to visualize your learning journey.
- **Streak Display:** The daily study streak is now prominently displayed with a flame icon on the main screen to provide daily motivation.
- **Database:** Added a new \`userProfile\` table to the local database to store gamification progress.

## [3.1.1] - Theme Switching Fix
- **Fix:** Resolved a critical bug where the theme switcher (Light/Dark/System) in the Settings page was not working. The application's Tailwind CSS configuration was missing the necessary \`darkMode: 'class'\` setting, which prevented the theme from being applied correctly.
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
- **Performance:** Switched to a faster AI model ('gemini-2.5-flash') for quiz generation, making the feature significantly more responsive and reliable.

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
`;


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