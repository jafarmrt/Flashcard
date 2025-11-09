import React, { useState, useEffect } from 'react';

interface ChangelogViewProps {
  onBack: () => void;
}

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
        <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none bg-slate-50 dark:bg-slate-900/50 p-4 rounded-md overflow-x-auto h-96">
            <pre className="whitespace-pre-wrap font-sans text-sm">
                {changelog}
            </pre>
        </div>
      )}
      <div className="text-center mt-6">
        <button onClick={onBack} className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-md hover:bg-indigo-700 transition-colors">
          Back
        </button>
      </div>
    </div>
  );
};
