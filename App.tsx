import React, { useState, useEffect, useRef } from 'react';
import { Flashcard, Deck, Settings, StudySessionOptions, UserProfile, UserAchievement } from './types';
import { db } from './services/localDBService';
import { calculateLevel, calculateStreak, checkAndAwardAchievements } from './services/gamificationService';
import { ALL_ACHIEVEMENTS } from './services/achievements';
import Header from './components/Header';
import FlashcardList from './components/FlashcardList';
import FlashcardForm from './components/FlashcardForm';
import { StudyView } from './components/StudyView';
import { StatsView } from './components/StatsView';
import { PracticeView } from './components/ConversationView';
import Toast from './components/Toast';
import DeckList from './components/DeckList';
import { ChangelogView } from './components/ChangelogView';
import SettingsView from './components/SettingsView';
import { BulkAddView } from './components/BulkAddView';
import { StudySetupModal } from './components/StudySetupModal';
import { AchievementsView } from './components/AchievementsView';
import { ProfileView } from './components/ProfileView';

type View = 'LIST' | 'FORM' | 'STUDY' | 'STATS' | 'PRACTICE' | 'SETTINGS' | 'DECKS' | 'CHANGELOG' | 'BULK_ADD' | 'ACHIEVEMENTS' | 'PROFILE';
type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
type HealthStatus = 'ok' | 'error' | 'checking';
type FlashcardFormData = Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId' | 'isDeleted'>;

// --- API Helper ---
const callProxy = async (action: 'sync-save' | 'sync-load' | 'sync-merge' | 'ping' | 'ping-free-dict' | 'ping-mw' | 'gemini-generate' | 'dictionary-free' | 'dictionary-mw', payload: object) => {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Request failed');
    }
    return response.json();
};


// --- SyncView Component (Now nested inside Settings) ---
export const SyncView: React.FC<{ 
    syncKey: string;
    onSwitchProfile: (newKey: string) => void;
    onSyncNow: () => void;
    syncStatus: SyncStatus;
    lastSyncDate: string | null;
    showToast: (message: string) => void;
}> = ({ syncKey, onSwitchProfile, onSyncNow, syncStatus, lastSyncDate, showToast }) => {
  const [pendingKey, setPendingKey] = useState(syncKey);

  useEffect(() => {
    setPendingKey(syncKey);
  }, [syncKey]);

  const generateNewKey = () => {
    const adjectives = ['happy', 'blue', 'green', 'brave', 'calm', 'bright', 'clever', 'eager', 'gentle', 'gold', 'silver', 'red'];
    const nouns = ['ocean', 'river', 'fox', 'lion', 'tiger', 'mountain', 'forest', 'cat', 'dog', 'whale', 'sky'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 100);
    const newKey = `${adj}-${noun}-${num}`;
    setPendingKey(newKey);
    showToast('New Profile Key generated!');
  };

  const handleSwitch = () => {
    if (!pendingKey) {
      showToast('Please enter or generate a Profile Key.');
      return;
    }
    if (pendingKey === syncKey) {
        showToast('To switch, please enter a different profile key.');
        return;
    }
    if (confirm('Switching profiles will ERASE all data on this device and replace it with data from the new profile. Are you sure?')) {
      onSwitchProfile(pendingKey);
    }
  };
  
  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newKey = e.target.value.toLowerCase().replace(/\s+/g, '-');
      setPendingKey(newKey);
  }

  const getStatusText = () => {
    switch(syncStatus) {
        case 'syncing': return { text: 'Syncing profile...', icon: '🔄', color: 'text-slate-500 dark:text-slate-400 animate-pulse' };
        case 'synced': return { text: `Profile synced`, icon: '✅', color: 'text-green-600 dark:text-green-400' };
        case 'error': return { text: 'Sync failed. Check connection.', icon: '⚠️', color: 'text-red-600 dark:text-red-400' };
        default: return { text: 'Changes are saved locally.', icon: '🏠', color: 'text-slate-500 dark:text-slate-400' };
    }
  }
  
  const {text, icon, color} = getStatusText();

  return (
    <div className="bg-slate-100 dark:bg-slate-900/50 p-6 rounded-lg space-y-6 border border-slate-200 dark:border-slate-700">
        <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">Profile Sync</h3>
        <p className="text-slate-600 dark:text-slate-400 text-sm">
            Your profile is automatically saved to the cloud. Use your key to access your profile on other devices.
        </p>

        {/* Section 1: Current Profile */}
        <div className="space-y-4">
            <div>
                <label htmlFor="sync-key" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Your Profile Key</label>
                <div className="mt-1 flex gap-2">
                    <input 
                        type="text" 
                        id="sync-key"
                        value={pendingKey}
                        onChange={handleKeyChange}
                        className="flex-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm"
                        placeholder="enter-or-generate-a-key"
                    />
                    <button onClick={() => navigator.clipboard.writeText(pendingKey)} className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-200 dark:hover:bg-slate-600">Copy</button>
                </div>
                 {!pendingKey && (
                    <button onClick={generateNewKey} className="mt-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                        Don't have a key? Generate one.
                    </button>
                )}
            </div>
             <button 
                onClick={onSyncNow} 
                disabled={syncStatus === 'syncing' || !pendingKey} 
                className="w-full flex justify-center items-center gap-2 px-4 py-3 text-sm font-medium text-white bg-green-600 hover:bg-green-700 border border-transparent rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Save Profile to Cloud
            </button>
            
            <div className="text-center text-sm text-slate-500 dark:text-slate-400">
                <p className={`font-medium ${color}`}>{icon} {text}</p>
                {syncStatus === 'synced' && lastSyncDate && <p className="text-xs mt-1">Last save: {lastSyncDate}</p>}
            </div>
        </div>
        
        {/* Section 2: Switch Profile */}
        <div className="border-t border-slate-200 dark:border-slate-700 pt-6 space-y-4">
            <h4 className="text-md font-medium text-slate-800 dark:text-slate-100">Switch to a Different Profile</h4>
            <p className="text-sm text-slate-600 dark:text-slate-400">
                To load a different profile, enter its key above and click the button below. <strong className="text-red-500">Warning: This will replace all local data.</strong>
            </p>
            <button 
                onClick={handleSwitch} 
                disabled={!pendingKey || pendingKey === syncKey} 
                className="w-full flex justify-center items-center gap-2 px-4 py-3 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 border border-transparent rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Switch & Overwrite Data
            </button>
        </div>
    </div>
  );
};


const convertToCSV = (cards: Flashcard[], decks: Deck[]): string => {
  const decksById = new Map(decks.map(deck => [deck.id, deck.name]));
  
  const headers = [
    'front', 'back', 'deckName', 'pronunciation', 'partOfSpeech', 
    'definition', 'exampleSentenceTarget', 'notes'
  ];

  const escapeCSV = (value: string | string[] | undefined): string => {
    if (value === undefined || value === null) return '';
    // Handle array fields by joining them with a semicolon
    let str = Array.isArray(value) ? value.join('; ') : String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      str = `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = cards.map(card => {
    const rowData = {
      front: card.front,
      back: card.back,
      deckName: decksById.get(card.deckId) || 'Unknown',
      pronunciation: card.pronunciation,
      partOfSpeech: card.partOfSpeech,
      definition: card.definition,
      exampleSentenceTarget: card.exampleSentenceTarget,
      notes: card.notes,
    };
    return headers.map(header => escapeCSV(rowData[header as keyof typeof rowData])).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
};

const parseCSV = (csvText: string): Record<string, string>[] => {
    const rows: Record<string, string>[] = [];
    const regex = /(".*?"|[^",\r\n]+)(?=\s*,|\s*$)/g;
    const lines = csvText.trim().split('\n');
    if (lines.length < 1) return [];

    const headers = (lines.shift()?.match(regex) || []).map(h => h.replace(/"/g, '').trim());

    for (const line of lines) {
        if (!line.trim()) continue;
        const values = (line.match(regex) || []).map(v => v.replace(/"/g, '').trim());
        if (values.length === headers.length) {
            const entry = headers.reduce((obj, header, index) => {
                obj[header] = values[index];
                return obj;
            }, {} as Record<string, string>);
            rows.push(entry);
        }
    }
    return rows;
};


const FloatingActionButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    onClick={onClick}
    className="md:hidden fixed bottom-20 right-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg animate-fab-in"
    aria-label="Add new card"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  </button>
);

const BottomNav: React.FC<{ 
  currentView: View; 
  onNavigate: (view: View) => void;
  isStudyDisabled: boolean;
}> = ({ currentView, onNavigate, isStudyDisabled }) => {
  const navItems = [
    { view: 'DECKS' as View, label: 'Decks', icon: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> },
    { view: 'STUDY' as View, label: 'Study', icon: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>, disabled: isStudyDisabled },
    { view: 'PRACTICE' as View, label: 'Practice', icon: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>, disabled: isStudyDisabled },
    { view: 'SETTINGS' as View, label: 'Settings', icon: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg> },
  ];
  
  const isActive = (view: View) => {
      if (view === 'DECKS' && ['LIST', 'DECKS', 'FORM', 'BULK_ADD'].includes(currentView)) return true;
      if (view === 'SETTINGS' && ['SETTINGS', 'CHANGELOG', 'ACHIEVEMENTS', 'PROFILE'].includes(currentView)) return true;
      return currentView === view;
  }

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex justify-around z-20">
      {navItems.map(item => (
        <button 
          key={item.label}
          onClick={() => onNavigate(item.view)}
          disabled={item.disabled}
          className={`flex flex-col items-center justify-center p-2 w-full text-xs transition-colors ${isActive(item.view) ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'} disabled:opacity-40`}
        >
          {item.icon}
          <span className="mt-1">{item.label}</span>
        </button>
      ))}
    </nav>
  );
};


const defaultSettings: Settings = {
    theme: 'system',
    defaultApiSource: 'free',
};

const App: React.FC = () => {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [view, setView] = useState<View>('DECKS');
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [syncKey, setSyncKey] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(null);
  const [studyDeckId, setStudyDeckId] = useState<string | null>(null);
  const [studyCards, setStudyCards] = useState<Flashcard[]>([]);
  const [isStudySetupModalOpen, setIsStudySetupModalOpen] = useState(false);
  const [dbStatus, setDbStatus] = useState<HealthStatus>('checking');
  const [apiStatus, setApiStatus] = useState<HealthStatus>('checking');
  const [freeDictApiStatus, setFreeDictApiStatus] = useState<HealthStatus>('checking');
  const [mwDictApiStatus, setMwDictApiStatus] = useState<HealthStatus>('checking');
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [streak, setStreak] = useState(0);
  const [earnedAchievements, setEarnedAchievements] = useState<UserAchievement[]>([]);

  
  const isInitialMount = useRef(true);

  const fetchData = async () => {
    const allCards = await db.flashcards.toArray();
    const allDecks = await db.decks.toArray();
    const allAchievements = await db.userAchievements.toArray();
    setFlashcards(allCards);
    setDecks(allDecks);
    setEarnedAchievements(allAchievements);

    let profile = await db.userProfile.get(1);
    if (!profile) {
      profile = { id: 1, xp: 0, level: 1, lastStreakCheck: '', firstName: '', lastName: '', bio: '', profileLastUpdated: new Date().toISOString() };
      await db.userProfile.add(profile);
    }
    setUserProfile(profile);

    const allLogs = await db.studyHistory.toArray();
    setStreak(calculateStreak(allLogs));
    
    return { cards: allCards, decks: allDecks, logs: allLogs, profile, achievements: allAchievements };
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };
  
  const handleCheckAchievements = async (quizScore?: { score: number, total: number }) => {
    if (!userProfile) return;
    const studyLogs = await db.studyHistory.toArray();
    const newAchievements = await checkAndAwardAchievements({
        allCards: flashcards,
        allDecks: decks,
        studyLogs,
        userProfile,
        earnedAchievements,
        quizScore,
    });

    if (newAchievements.length > 0) {
        setEarnedAchievements(prev => [...prev, ...newAchievements]);
        newAchievements.forEach(ua => {
            const achievementData = ALL_ACHIEVEMENTS.find(a => a.id === ua.achievementId);
            if (achievementData) {
                setTimeout(() => {
                  showToast(`Achievement Unlocked: ${achievementData.name} ${achievementData.icon}`);
                }, 500);
            }
        });
    }
  };


  const awardXP = async (points: number, message?: string) => {
    if (!userProfile) return;
    const newXp = userProfile.xp + points;
    const { level } = calculateLevel(newXp);
    
    const updatedProfile: UserProfile = { ...userProfile, xp: newXp, level };
    
    if (level > userProfile.level) {
        showToast(`Level Up! You reached Level ${level}! 🎉`);
    } else {
        showToast(message || `+${points} XP ✨`);
    }
    
    await db.userProfile.put(updatedProfile);
    setUserProfile(updatedProfile);
    handleCheckAchievements(); // Check for level-based achievements
  };

  const checkStreakBonus = async () => {
      if (!userProfile) return;
      const today = new Date().toISOString().split('T')[0];
      if (userProfile.lastStreakCheck === today) return; // Already checked today

      const logs = await db.studyHistory.toArray();
      const newStreak = calculateStreak(logs);

      if (newStreak > streak) {
          await awardXP(newStreak * 10, `Streak Bonus: ${newStreak} days! 🔥`);
      }
      
      const updatedProfile = { ...userProfile, lastStreakCheck: today };
      await db.userProfile.put(updatedProfile);
      setUserProfile(updatedProfile);
  };

  const handleSync = async (isManual = false) => {
    if (!syncKey) {
        if (isManual) showToast("No profile key set. Cannot sync.");
        return;
    }
    setSyncStatus('syncing');
    try {
        const allStudyHistory = await db.studyHistory.toArray();
        const localData = { 
            decks, 
            cards: flashcards,
            studyHistory: allStudyHistory,
            userProfile,
            userAchievements: earnedAchievements,
        };
        const response = await callProxy('sync-merge', { syncKey, data: localData });
        
        const { data: mergedData } = response;
        if (mergedData) {
            await db.transaction('rw', [db.decks, db.flashcards, db.studyHistory, db.userProfile, db.userAchievements], async () => {
                await db.decks.clear();
                await db.flashcards.clear();
                await db.studyHistory.clear();
                await db.userProfile.clear();
                await db.userAchievements.clear();
                
                if (mergedData.decks) await db.decks.bulkPut(mergedData.decks);
                if (mergedData.cards) await db.flashcards.bulkPut(mergedData.cards);
                if (mergedData.studyHistory) await db.studyHistory.bulkPut(mergedData.studyHistory);
                if (mergedData.userProfile) await db.userProfile.put(mergedData.userProfile);
                if (mergedData.userAchievements) await db.userAchievements.bulkPut(mergedData.userAchievements);
            });
            await fetchData();
        }
        const now = new Date();
        localStorage.setItem('lastSyncDate', now.toISOString());
        setLastSyncDate(now.toLocaleString());
        setSyncStatus('synced');
        if (isManual) {
            showToast('Profile synced with cloud!');
        }
    } catch (error) {
        console.error('Sync failed:', error);
        setSyncStatus('error');
        if (isManual) {
            showToast('Sync failed. Check connection.');
        }
    }
};

  const handleLoadFromCloud = async (key: string) => {
    if (!key) return;

    setSyncStatus('syncing');
    try {
      const response = await callProxy('sync-load', { syncKey: key });
      if (response.data) {
        const { decks, cards, studyHistory, userProfile, userAchievements } = response.data;
        // Fix: Pass tables as an array to db.transaction to avoid exceeding argument limits.
        await db.transaction('rw', [db.decks, db.flashcards, db.studyHistory, db.userProfile, db.userAchievements], async () => {
            await db.decks.clear();
            await db.flashcards.clear();
            await db.studyHistory.clear();
            await db.userProfile.clear();
            await db.userAchievements.clear();
            
            if (decks) await db.decks.bulkPut(decks);
            if (cards) await db.flashcards.bulkPut(cards);
            if (studyHistory) await db.studyHistory.bulkPut(studyHistory);
            if (userProfile) await db.userProfile.put(userProfile);
            if (userAchievements) await db.userAchievements.bulkPut(userAchievements);
        });
        await fetchData(); // Refresh state from DB
        showToast('Profile loaded successfully from cloud!');
        setSyncStatus('synced');
      } else {
        showToast('No cloud data found for this profile. Starting fresh.');
        setSyncStatus('idle');
      }
    } catch (error) {
      console.error("Failed to load from cloud", error);
      showToast('Failed to load profile from cloud. Using local data.');
      setSyncStatus('error');
    }
  };
  
  // Effect for initial load and health checks
  useEffect(() => {
    const savedKey = localStorage.getItem('syncKey') || '';
    setSyncKey(savedKey);
    const lastSync = localStorage.getItem('lastSyncDate');
     if (lastSync) {
      setLastSyncDate(new Date(lastSync).toLocaleString());
    }
    
    // Load settings
    const savedSettings = localStorage.getItem('appSettings');
    if (savedSettings) {
        setSettings(JSON.parse(savedSettings));
    }

    const initialLoad = async () => {
        await db.open(); // Ensure DB is open
        await fetchData();
        if (savedKey) {
          await handleLoadFromCloud(savedKey);
        }
        setDbStatus(db.isOpen() ? 'ok' : 'error');
    };
    initialLoad().then(() => {
        isInitialMount.current = false;
    });

    const checkGeminiApi = async () => {
      try {
        await callProxy('ping', {});
        setApiStatus('ok');
      } catch (e) {
        setApiStatus('error');
      }
    };
    checkGeminiApi();

    const checkFreeDictApi = async () => {
      try {
        await callProxy('ping-free-dict', {});
        setFreeDictApiStatus('ok');
      } catch (e) {
        setFreeDictApiStatus('error');
      }
    };
    checkFreeDictApi();
    
    const checkMwDictApi = async () => {
      try {
        await callProxy('ping-mw', {});
        setMwDictApiStatus('ok');
      } catch (e) {
        setMwDictApiStatus('error');
      }
    };
    checkMwDictApi();

  }, []);

  // Effect for applying theme
  useEffect(() => {
    const root = window.document.documentElement;

    const applyTheme = () => {
      const isDark =
        settings.theme === 'dark' ||
        (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('dark', isDark);
    };

    applyTheme();

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', applyTheme);

    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, [settings.theme]);


  // Effect for debounced auto-syncing with MERGE strategy
  useEffect(() => {
    if (isInitialMount.current || !syncKey) {
        setSyncStatus('idle');
        return;
    };

    // Immediately show that changes are waiting to be synced.
    setSyncStatus('syncing'); 

    const handler = setTimeout(() => handleSync(false), 2000); // 2-second debounce delay

    return () => {
      clearTimeout(handler);
    };
  }, [flashcards, decks, syncKey, userProfile, earnedAchievements]);

  const handleSwitchProfile = async (newKey: string) => {
    await db.delete();
    localStorage.clear();
    localStorage.setItem('syncKey', newKey);
    window.location.reload();
  };
  
  const updateSettings = (newSettings: Partial<Settings>) => {
      setSettings(prev => {
          const updated = { ...prev, ...newSettings };
          localStorage.setItem('appSettings', JSON.stringify(updated));
          return updated;
      })
  }

  const handleAddCard = () => {
    setEditingCard(null);
    setView('FORM');
  };

  const handleEditCard = (card: Flashcard) => {
    setEditingCard(card);
    setView('FORM');
  };

  const handleDeleteCard = async (id: string) => {
    await db.flashcards.update(id, { isDeleted: true });
    await fetchData();
    showToast('Card deleted successfully!');
  };

  const handleSaveCard = async (cardData: FlashcardFormData, deckName: string) => {
    const trimmedDeckName = deckName.trim();
    if (!trimmedDeckName) {
      showToast('Deck name cannot be empty.');
      return;
    }
    
    const allDecks = await db.decks.toArray();
    let deck = allDecks.find(d => d.name.toLowerCase() === trimmedDeckName.toLowerCase() && !d.isDeleted);

    if (!deck) {
      const newDeck: Deck = { id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, name: trimmedDeckName };
      await db.decks.add(newDeck);
      deck = newDeck;
    }
    
    if (editingCard) {
      const updatedCard: Flashcard = { ...editingCard, ...cardData, deckId: deck!.id };
      await db.flashcards.put(updatedCard);
      showToast('Card updated successfully!');
    } else {
      const newCard: Flashcard = {
        ...cardData,
        id: Date.now().toString(),
        deckId: deck!.id,
        repetition: 0,
        easinessFactor: 2.5,
        interval: 0,
        dueDate: new Date().toISOString(),
      };
      await db.flashcards.add(newCard);
      await awardXP(2, 'New Card Added!');
      showToast('Card added successfully!');
    }
    await fetchData();
    handleCheckAchievements();
    setEditingCard(null);
    setView('DECKS');
  };

  const handleSaveProfile = async (profileData: Partial<UserProfile>) => {
    if (!userProfile) return;
    const updatedProfile = { 
      ...userProfile, 
      ...profileData,
      profileLastUpdated: new Date().toISOString() // Add/update the timestamp on every save
    };
    await db.userProfile.put(updatedProfile);
    setUserProfile(updatedProfile);
    showToast("Profile updated successfully!");
  };
  
  const handleBulkSaveCards = async (cardsToSave: FlashcardFormData[], deckName: string) => {
    const trimmedDeckName = deckName.trim();
    if (!trimmedDeckName) {
        showToast('Deck name cannot be empty.');
        return;
    }

    const allDecks = await db.decks.toArray();
    let deck = allDecks.find(d => d.name.toLowerCase() === trimmedDeckName.toLowerCase() && !d.isDeleted);

    if (!deck) {
        const newDeck: Deck = { id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, name: trimmedDeckName };
        await db.decks.add(newDeck);
        deck = newDeck;
    }

    const newCards: Flashcard[] = cardsToSave.map((cardData, index) => ({
        ...cardData,
        id: `${Date.now()}-${index}`,
        deckId: deck!.id,
        repetition: 0,
        easinessFactor: 2.5,
        interval: 0,
        dueDate: new Date().toISOString(),
    }));

    if (newCards.length > 0) {
        await db.flashcards.bulkAdd(newCards);
        await awardXP(newCards.length * 2);
    }
    
    await fetchData();
    handleCheckAchievements();
    showToast(`${newCards.length} cards added to "${trimmedDeckName}"!`);
    setView('DECKS');
};

  const handleSessionEnd = async (updatedCardsFromSession: Flashcard[]) => {
    if (updatedCardsFromSession.length > 0) {
      await db.flashcards.bulkPut(updatedCardsFromSession);
    }
    await fetchData();
    handleCheckAchievements();
    setView('DECKS');
    showToast('Study session complete. Progress saved!');
  };

  const handleExportCSV = () => {
    try {
      const date = new Date().toISOString().split('T')[0];
      const a = document.createElement('a');
      document.body.appendChild(a);
      a.style.display = 'none';
      
      const cardsToExport = flashcards.filter(c => !c.isDeleted);

      if (cardsToExport.length === 0) {
        showToast('No cards to export.');
        return;
      }
      const csvData = convertToCSV(cardsToExport, decks);
      const blob = new Blob([`\uFEFF${csvData}`], { type: 'text/csv;charset=utf-8;' }); // Add BOM for Excel
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `lingua-cards-export-${date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('All cards exported as CSV!');

      document.body.removeChild(a);
    } catch (error) {
        console.error('Export failed:', error);
        showToast('Export failed.');
    }
  };

  const handleImportCSV = async (csvText: string) => {
    if (!csvText) {
        showToast('Import file is empty.');
        return;
    }

    try {
        const parsedData = parseCSV(csvText);
        if (parsedData.length === 0) {
            showToast('No valid card data found in the file.');
            return;
        }

        const allDecks = await db.decks.toArray();
        const deckNameMap = new Map(allDecks.map(d => [d.name.toLowerCase(), d]));
        const newDecks: Deck[] = [];
        const newCards: Flashcard[] = [];
        let rowCount = 0;

        for (const row of parsedData) {
            rowCount++;
            if (!row.front || !row.back) {
                console.warn(`Skipping row ${rowCount}: missing 'front' or 'back' value.`);
                continue;
            }

            const deckName = row.deckName?.trim() || 'Imported Deck';
            const lowerDeckName = deckName.toLowerCase();
            let deck = deckNameMap.get(lowerDeckName);

            if (!deck) {
                const newDeck = { id: `${Date.now()}-${rowCount}`, name: deckName };
                deckNameMap.set(lowerDeckName, newDeck);
                newDecks.push(newDeck);
                deck = newDeck;
            }

            const newCard: Flashcard = {
                id: `${Date.now()}-${rowCount}`,
                deckId: deck.id,
                front: row.front,
                back: row.back,
                pronunciation: row.pronunciation || '',
                partOfSpeech: row.partOfSpeech || '',
                definition: row.definition?.split(';').map(s => s.trim()) || [],
                exampleSentenceTarget: row.exampleSentenceTarget?.split(';').map(s => s.trim()) || [],
                notes: row.notes || '',
                repetition: 0,
                easinessFactor: 2.5,
                interval: 0,
                dueDate: new Date().toISOString(),
            };
            newCards.push(newCard);
        }

        if (newDecks.length > 0) await db.decks.bulkAdd(newDecks);
        if (newCards.length > 0) await db.flashcards.bulkAdd(newCards);
        
        await fetchData();
        handleCheckAchievements();
        showToast(`${newCards.length} cards imported successfully!`);
        setView('DECKS');

    } catch (error) {
        console.error("CSV Import failed:", error);
        showToast("Failed to import CSV. Please check file format.");
    }
  };
  
  const handleResetApp = async () => {
      if(confirm("Are you sure you want to reset the application? All local decks and cards will be permanently deleted. This action cannot be undone.")) {
          await db.delete();
          // Also clear sync key from local storage
          localStorage.removeItem('syncKey');
          localStorage.removeItem('lastSyncDate');
          localStorage.removeItem('appSettings');
          window.location.reload();
      }
  }

  const handleStudyDeck = (deckId: string) => {
    setStudyDeckId(deckId);
    setIsStudySetupModalOpen(true);
  };
  
  const handleStartStudySession = (options: StudySessionOptions) => {
    checkStreakBonus();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISOString = today.toISOString();

    let cardsToStudy = studyDeckId
      ? visibleFlashcards.filter(card => card.deckId === studyDeckId)
      : visibleFlashcards;

    // Apply filters from the modal
    switch (options.filter) {
      case 'new':
        cardsToStudy = cardsToStudy.filter(c => c.repetition === 0);
        break;
      case 'review':
        cardsToStudy = cardsToStudy.filter(c => c.repetition > 0 && c.dueDate <= todayISOString);
        break;
      case 'all-cards':
        // No filter applied, study all cards in the selected scope
        break;
      case 'all-due':
      default:
        cardsToStudy = cardsToStudy.filter(c => c.dueDate <= todayISOString);
        break;
    }
    
    // Shuffle the filtered cards
    for (let i = cardsToStudy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cardsToStudy[i], cardsToStudy[j]] = [cardsToStudy[j], cardsToStudy[i]];
    }
    
    // Apply card limit
    if (options.limit > 0) {
      cardsToStudy = cardsToStudy.slice(0, options.limit);
    }
    
    if (cardsToStudy.length === 0) {
        showToast("No cards match your selected criteria.");
        return;
    }

    setStudyCards(cardsToStudy);
    setIsStudySetupModalOpen(false);
    setView('STUDY');
  };

  const handleNavigate = (newView: View) => {
    if (newView === 'STUDY') {
        setStudyDeckId(null); // This means "Study All Decks"
        setIsStudySetupModalOpen(true);
    } else if (newView === 'LIST' && view !== 'LIST') {
        setView('DECKS');
    } else {
        setView(newView);
    }
  }

  const handleRenameDeck = async (deckId: string, newName: string) => {
    const existingDeck: Deck | undefined = decks.find(d => d.name.toLowerCase() === newName.toLowerCase() && !d.isDeleted);
    if (existingDeck && existingDeck.id !== deckId) {
        showToast('A deck with this name already exists.');
        return;
    }

    await db.decks.update(deckId, { name: newName });
    await fetchData(); // Re-fetch to update state and trigger sync
    showToast('Deck renamed successfully!');
  };

  const handleDeleteDeck = async (deckId: string) => {
    try {
      const cardsInDeck = await db.flashcards.where('deckId').equals(deckId).toArray();
      const cardIdsToSoftDelete = cardsInDeck.map(card => card.id);
      await db.transaction('rw', db.flashcards, db.decks, async () => {
          if (cardIdsToSoftDelete.length > 0) {
              await db.flashcards.where('id').anyOf(cardIdsToSoftDelete).modify({ isDeleted: true });
          }
          await db.decks.update(deckId, { isDeleted: true });
      });
      await fetchData(); 
      showToast('Deck and its cards deleted successfully!');
    } catch (error) {
        console.error("Failed to delete deck:", error);
        showToast("Error: Could not delete the deck.");
    }
  };

  const visibleFlashcards = flashcards.filter(c => !c.isDeleted);
  const visibleDecks = decks.filter(d => !d.isDeleted);
  
  const cardsForSetupModal = studyDeckId 
    ? visibleFlashcards.filter(c => c.deckId === studyDeckId)
    : visibleFlashcards;


  const renderContent = () => {
    switch (view) {
      case 'STUDY':
        return <StudyView cards={studyCards} onExit={handleSessionEnd} awardXP={awardXP} />;
      case 'PRACTICE':
        return <PracticeView cards={visibleFlashcards} awardXP={awardXP} onQuizComplete={handleCheckAchievements} />;
      case 'SETTINGS':
        return <SettingsView 
            settings={settings}
            onUpdateSettings={updateSettings}
            onExportCSV={handleExportCSV}
            onImportCSV={handleImportCSV}
            onResetApp={handleResetApp}
            onNavigateToChangelog={() => setView('CHANGELOG')}
            onNavigateToAchievements={() => setView('ACHIEVEMENTS')}
            onNavigateToProfile={() => setView('PROFILE')}
            syncView={
                <SyncView 
                    syncKey={syncKey} 
                    onSwitchProfile={handleSwitchProfile}
                    onSyncNow={() => handleSync(true)}
                    syncStatus={syncStatus} 
                    lastSyncDate={lastSyncDate}
                    showToast={showToast}
                />
            }
          />
       case 'DECKS':
        return <DeckList 
            decks={visibleDecks} 
            cards={visibleFlashcards} 
            onStudyDeck={handleStudyDeck}
            onRenameDeck={handleRenameDeck}
            onDeleteDeck={handleDeleteDeck}
            onViewAllCards={() => setView('LIST')}
            onBulkAdd={() => setView('BULK_ADD')}
            userProfile={userProfile}
            streak={streak}
        />;
      case 'FORM':
        const editingCardDeckName = visibleDecks.find(d => d.id === editingCard?.deckId)?.name || '';
        return <FlashcardForm 
            card={editingCard} 
            decks={visibleDecks} 
            onSave={handleSaveCard} 
            onCancel={() => setView('DECKS')} 
            initialDeckName={editingCardDeckName} 
            showToast={showToast}
            defaultApiSource={settings.defaultApiSource}
        />;
      case 'STATS':
        return <StatsView onBack={() => setView('DECKS')} />;
      case 'CHANGELOG':
        return <ChangelogView onBack={() => setView('SETTINGS')} />;
      case 'ACHIEVEMENTS':
        return <AchievementsView earnedAchievements={earnedAchievements} onBack={() => setView('SETTINGS')} />;
      case 'PROFILE':
        return <ProfileView userProfile={userProfile} streak={streak} onSave={handleSaveProfile} onBack={() => setView('SETTINGS')} />;
      case 'BULK_ADD':
        return <BulkAddView 
            onSave={handleBulkSaveCards}
            onCancel={() => setView('DECKS')} 
            showToast={showToast}
            defaultApiSource={settings.defaultApiSource}
        />;
      case 'LIST':
      default:
        return <FlashcardList cards={visibleFlashcards} decks={visibleDecks} onEdit={handleEditCard} onDelete={handleDeleteCard} onBackToDecks={() => setView('DECKS')} />;
    }
  };
  
  const StatusIndicator: React.FC<{ status: HealthStatus, label: string }> = ({ status, label }) => {
    const color = status === 'ok' ? 'bg-green-500' : status === 'error' ? 'bg-red-500' : 'bg-yellow-500';
    const pulse = status === 'checking' ? 'animate-pulse' : '';
    return <div className="flex items-center gap-1.5" title={`${label}: ${status}`}><div className={`w-2 h-2 rounded-full ${color} ${pulse}`}></div><span>{label}</span></div>
  }

  return (
    <div className="min-h-screen font-sans flex flex-col">
      <Header 
        onNavigate={handleNavigate} 
        onAddCard={handleAddCard}
        isStudyDisabled={visibleFlashcards.length === 0}
        currentView={view}
      />
      <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full pb-24 md:pb-8">
        {renderContent()}
      </main>
      
      <StudySetupModal 
        isOpen={isStudySetupModalOpen}
        onClose={() => setIsStudySetupModalOpen(false)}
        onStart={handleStartStudySession}
        cards={cardsForSetupModal}
      />

      {['LIST', 'DECKS'].includes(view) && <FloatingActionButton onClick={handleAddCard} />}
      <BottomNav currentView={view} onNavigate={handleNavigate} isStudyDisabled={visibleFlashcards.length === 0} />
      
      {toastMessage && <Toast message={toastMessage} />}
      <footer className="text-center py-4 pb-20 md:pb-4 text-xs text-slate-400 dark:text-slate-500">
         <div className="flex justify-center items-center gap-4 mb-2">
            <StatusIndicator status={dbStatus} label="DB"/>
            <StatusIndicator status={apiStatus} label="AI API"/>
            <StatusIndicator status={freeDictApiStatus} label="Free Dict."/>
            <StatusIndicator status={mwDictApiStatus} label="MW Dict."/>
         </div>
          <p>&copy; {new Date().getFullYear()} Lingua Cards. All Rights Reserved.</p>
      </footer>
    </div>
  );
};

export default App;