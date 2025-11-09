import React from 'react';

type View = 'LIST' | 'STUDY' | 'STATS' | 'FORM' | 'PRACTICE' | 'SYNC' | 'DECKS';
type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

interface HeaderProps {
  onNavigate: (view: View) => void;
  onAddCard: () => void;
  isStudyDisabled: boolean;
  currentView: View;
  syncStatus: SyncStatus;
}

const SyncStatusIcon: React.FC<{ status: SyncStatus }> = ({ status }) => {
    switch (status) {
        case 'syncing':
            return <svg className="animate-spin h-4 w-4 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>;
        case 'synced':
            return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-green-500"><path d="M20 6 9 17l-5-5"/></svg>;
        case 'error':
            return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;
        default:
            return null;
    }
}


const Header: React.FC<HeaderProps> = ({ onNavigate, onAddCard, isStudyDisabled, currentView, syncStatus }) => {
  const navButtonStyle = "px-3 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2";
  const activeStyle = "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100";
  const inactiveStyle = "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700";

  return (
    <header className="bg-white dark:bg-slate-800/50 backdrop-blur-sm shadow-sm sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex-shrink-0 flex items-center gap-3 cursor-pointer" onClick={() => onNavigate('DECKS')}>
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-indigo-500">
              <rect width="32" height="32" rx="6" fill="currentColor"/>
              <path d="M12 10C12 8.89543 12.8954 8 14 8H20C21.1046 8 22 8.89543 22 10V14C22 15.1046 21.1046 16 20 16H18" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M10 16C10 14.8954 10.8954 14 12 14H18C19.1046 14 20 14.8954 20 16V20C20 21.1046 19.1046 22 18 22H12C10.8954 22 10 21.1046 10 20V16Z" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Lingua Cards</h1>
          </div>
          {/* Desktop Navigation - Hidden on mobile */}
          <div className="hidden md:flex items-center space-x-2 sm:space-x-4">
            <button
              onClick={() => onNavigate('LIST')}
              className={`${navButtonStyle} ${currentView === 'LIST' || currentView === 'FORM' ? activeStyle : inactiveStyle}`}
            >
              All Cards
            </button>
            <button
              onClick={() => onNavigate('DECKS')}
              className={`${navButtonStyle} ${currentView === 'DECKS' ? activeStyle : inactiveStyle}`}
            >
              Decks
            </button>
            <button
              onClick={() => onNavigate('STUDY')}
              disabled={isStudyDisabled}
              className={`${navButtonStyle} ${currentView === 'STUDY' ? activeStyle : inactiveStyle} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Study
            </button>
            <button
              onClick={() => onNavigate('PRACTICE')}
              disabled={isStudyDisabled}
              className={`${navButtonStyle} ${currentView === 'PRACTICE' ? activeStyle : inactiveStyle} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Practice
            </button>
             <button
              onClick={() => onNavigate('STATS')}
              className={`${navButtonStyle} ${currentView === 'STATS' ? activeStyle : inactiveStyle}`}
            >
              Stats
            </button>
            <button
              onClick={() => onNavigate('SYNC')}
              className={`${navButtonStyle} ${currentView === 'SYNC' ? activeStyle : inactiveStyle}`}
            >
              <span>Sync</span>
              <SyncStatusIcon status={syncStatus} />
            </button>
            <button
              onClick={onAddCard}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>Add Card</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;