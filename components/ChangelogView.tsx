import React from 'react';

interface ChangelogViewProps {
  onBack: () => void;
}

const changelogText = `# Changelog

All notable changes to this project will be documented in this file.

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
- **Reliability:** Added a 5-second timeout for each word. If processing for a word gets stuck, it is automatically cancelled and the process moves to the next word.
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