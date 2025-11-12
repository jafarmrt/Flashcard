import React from 'react';

// Fix: Add 'ACHIEVEMENTS' to the View type to match App.tsx.
type View = 'LIST' | 'STUDY' | 'STATS' | 'FORM' | 'PRACTICE' | 'SETTINGS' | 'DECKS' | 'CHANGELOG' | 'BULK_ADD' | 'ACHIEVEMENTS' | 'PROFILE';

interface HeaderProps {
  onNavigate: (view: View) => void;
  onAddCard: () => void;
  isStudyDisabled: boolean;
  currentView: View;
}

const Header: React.FC<HeaderProps> = ({ onNavigate, onAddCard, isStudyDisabled, currentView }) => {
  const navButtonStyle = "px-3 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2";
  const activeStyle = "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100";
  const inactiveStyle = "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700";

  return (
    <header className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm shadow-sm sticky top-0 z-10">
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
              onClick={() => onNavigate('DECKS')}
              className={`${navButtonStyle} ${['LIST', 'DECKS', 'FORM', 'BULK_ADD'].includes(currentView) ? activeStyle : inactiveStyle}`}
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
              onClick={() => onNavigate('SETTINGS')}
              className={`${navButtonStyle} ${['SETTINGS', 'CHANGELOG', 'ACHIEVEMENTS', 'PROFILE'].includes(currentView) ? activeStyle : inactiveStyle}`}
            >
              Settings
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