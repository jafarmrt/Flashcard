import React from 'react';

export interface AutoFixStats {
  totalChecked: number;
  totalUpdated: number;
  audioAdded: number;
  definitionsAdded: number;
  examplesAdded: number;
  pronunciationsAdded: number;
  translationsAdded: number;
}

interface AutoFixReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: AutoFixStats | null;
}

export const AutoFixReportModal: React.FC<AutoFixReportModalProps> = ({ isOpen, onClose, stats }) => {
  if (!isOpen || !stats) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center backdrop-blur-sm animate-toast-in" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md m-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-indigo-600 p-6 text-center">
          <div className="mx-auto w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 14 9-5-9-5-9 5 9 5z"/><path d="m12 14-9-5-9-5-9 5 9 5z"/><path d="M12 14v7"/><path d="m5 16.5-3-1.72"/><path d="m19 16.5 3-1.72"/></svg>
          </div>
          <h2 className="text-2xl font-bold text-white">Auto-Fix Complete</h2>
          <p className="text-indigo-100">Your collection has been optimized.</p>
        </div>
        
        <div className="p-6">
          <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100 dark:border-slate-700">
             <div className="text-center flex-1 border-r border-slate-100 dark:border-slate-700">
                <p className="text-3xl font-bold text-slate-800 dark:text-slate-100">{stats.totalChecked}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">Checked</p>
             </div>
             <div className="text-center flex-1">
                <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">{stats.totalUpdated}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">Updated</p>
             </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-300 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span> Audio Added
                </span>
                <span className="font-mono font-medium text-slate-800 dark:text-slate-100">{stats.audioAdded}</span>
            </div>
            <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-300 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span> Definitions Added
                </span>
                <span className="font-mono font-medium text-slate-800 dark:text-slate-100">{stats.definitionsAdded}</span>
            </div>
            <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-300 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-500"></span> Examples Added
                </span>
                <span className="font-mono font-medium text-slate-800 dark:text-slate-100">{stats.examplesAdded}</span>
            </div>
             <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-300 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span> Pronunciations Added
                </span>
                <span className="font-mono font-medium text-slate-800 dark:text-slate-100">{stats.pronunciationsAdded}</span>
            </div>
             <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-300 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500"></span> Translations Added
                </span>
                <span className="font-mono font-medium text-slate-800 dark:text-slate-100">{stats.translationsAdded}</span>
            </div>
          </div>

          <button onClick={onClose} className="w-full mt-8 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-white font-semibold rounded-lg transition-colors">
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
};