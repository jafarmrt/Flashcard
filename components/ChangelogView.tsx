import React, { useState, useEffect } from 'react';

interface ChangelogViewProps {
  onBack: () => void;
}

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
  const [changelog, setChangelog] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/CHANGELOG.md')
      .then(response => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.text();
      })
      .then(text => {
        setChangelog(text);
        setLoading(false);
      })
      .catch(error => {
        console.error('Failed to fetch changelog:', error);
        setChangelog('Could not load version history. Please check your connection and try again.');
        setLoading(false);
      });
  }, []);

  return (
    <div className="max-w-3xl mx-auto bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4 text-slate-800 dark:text-slate-100">Version History</h2>
      {loading ? (
        <p className="text-slate-500 dark:text-slate-400">Loading...</p>
      ) : (
        <div className="prose dark:prose-invert max-w-none bg-slate-50 dark:bg-slate-900/50 p-4 rounded-md h-96 overflow-y-auto">
            {renderChangelog(changelog)}
        </div>
      )}
      <div className="text-center mt-6">
        <button onClick={onBack} className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-md hover:bg-indigo-700 transition-colors">
          Back to Settings
        </button>
      </div>
    </div>
  );
};
