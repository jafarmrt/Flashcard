import React, { useState, useEffect, useRef } from 'react';
import { Flashcard, Deck, Settings, StudySessionOptions, UserProfile, UserAchievement } from './types';
import { db } from './services/localDBService';
import { calculateLevel, calculateStreak, checkAndAwardAchievements } from './services/gamificationService';
import { generateNewDailyGoals, updateGoalProgress } from './services/dailyGoalsService';
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
import { AuthView } from './components/AuthView';

type View = 'LIST' | 'FORM' | 'STUDY' | 'STATS' | 'PRACTICE' | 'SETTINGS' | 'DECKS' | 'CHANGELOG' | 'BULK_ADD' | 'ACHIEVEMENTS' | 'PROFILE';
type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
type HealthStatus = 'ok' | 'error' | 'checking';
type FlashcardFormData = Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId' | 'isDeleted'>;
type User = { username: string };

// --- API Helper ---
const callProxy = async (action: 'auth-register' | 'auth-login' | 'sync-load' | 'sync-merge' | 'ping' | 'ping-free-dict' | 'ping-mw' | 'gemini-generate' | 'dictionary-free' | 'dictionary-mw', payload: object) => {
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
    bulkAddConcurrency: 3,
    bulkAddAiTimeout: 15,
    bulkAddDictTimeout: 5,
};

const App: React.FC = () => {
  // App State
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [view, setView] = useState<View>('DECKS');
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const previousViewRef = useRef<View>('DECKS');
  
  // Auth State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false); // For login/register spinners
  const [appLoading, setAppLoading] = useState(true); // For initial session check

  // Sync State
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');

  // Study State
  const [studyDeckId, setStudyDeckId] = useState<string | null>(null);
  const [studyCards, setStudyCards] = useState<Flashcard[]>([]);
  const [isStudySetupModalOpen, setIsStudySetupModalOpen] = useState(false);
  
  // Health & Settings
  const [dbStatus, setDbStatus] = useState<HealthStatus>('checking');
  const [apiStatus, setApiStatus] = useState<HealthStatus>('checking');
  const [freeDictApiStatus, setFreeDictApiStatus] = useState<HealthStatus>('checking');
  const [mwDictApiStatus, setMwDictApiStatus] = useState<HealthStatus>('checking');
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  
  // Gamification State
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [streak, setStreak] = useState(0);
  const [earnedAchievements, setEarnedAchievements] = useState<UserAchievement[]>([]);

  
  const isInitialMount = useRef(true);

  const checkAndRefreshDailyGoals = async (profile: UserProfile, currentStreak: number) => {
    const today = new Date().toISOString().split('T')[0];
    if (!profile.dailyGoals || profile.dailyGoals.date !== today) {
        const newGoals = generateNewDailyGoals(currentStreak);
        const updatedProfile: UserProfile = {
            ...profile,
            dailyGoals: {
                date: today,
                goals: newGoals,
                allCompleteAwarded: false
            }
        };
        await db.userProfile.put(updatedProfile);
        return updatedProfile;
    }
    return profile;
  };

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
    
    const allLogs = await db.studyHistory.toArray();
    const currentStreak = calculateStreak(allLogs);
    setStreak(currentStreak);
    
    if (profile) {
      profile = await checkAndRefreshDailyGoals(profile, currentStreak);
    }
    setUserProfile(profile);
    
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
    // Refetch profile to ensure we have the latest XP
    const currentProfile = await db.userProfile.get(1);
    if (!currentProfile) return;

    const newXp = currentProfile.xp + points;
    const { level } = calculateLevel(newXp);
    
    const updatedProfile: UserProfile = { ...currentProfile, xp: newXp, level };
    
    if (level > currentProfile.level) {
        showToast(`Level Up! You reached Level ${level}! 🎉`);
    } else if (message) {
        showToast(message);
    }
    
    await db.userProfile.put(updatedProfile);
    setUserProfile(updatedProfile);
    handleCheckAchievements(); // Check for level-based achievements
  };

  const handleGoalUpdate = async (type: 'STUDY' | 'QUIZ' | 'STREAK', value: number) => {
    const currentProfile = await db.userProfile.get(1);
    if (!currentProfile?.dailyGoals) return;

    const { updatedProfile: profileWithGoalProgress, xpGained, newlyCompletedGoals } = updateGoalProgress(type, value, currentProfile);
    
    const updatedProfile = {
        ...profileWithGoalProgress,
        profileLastUpdated: new Date().toISOString()
    };

    // Save progress first
    await db.userProfile.put(updatedProfile);
    setUserProfile(updatedProfile);

    // Then award XP if any was gained
    if (xpGained > 0) {
        await awardXP(xpGained);
    }

    // Show toasts for specific goal completions
    newlyCompletedGoals.forEach(goal => {
        setTimeout(() => showToast(`Goal Complete: ${goal.description} (+${goal.xp} XP)`), 500);
    });

    if (updatedProfile.dailyGoals.allCompleteAwarded && !currentProfile.dailyGoals.allCompleteAwarded) {
        setTimeout(() => showToast(`All goals complete! Bonus +50 XP! ✨`), newlyCompletedGoals.length > 0 ? 1000 : 500);
    }
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
      handleGoalUpdate('STREAK', newStreak);
      
      const updatedProfile = { ...userProfile, lastStreakCheck: today };
      await db.userProfile.put(updatedProfile);
      setUserProfile(updatedProfile);
  };

  const handleSync = async () => {
    if (!currentUser?.username) return;

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
        const response = await callProxy('sync-merge', { username: currentUser.username, data: localData });
        
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
        setSyncStatus('synced');
    } catch (error) {
        console.error('Sync failed:', error);
        setSyncStatus('error');
    }
};

  const loadDataFromCloud = async (username: string) => {
    if (!username) return;
    setSyncStatus('syncing');
    try {
      await db.delete().then(() => db.open()); // Clear local DB before loading
      
      const response = await callProxy('sync-load', { username });
      if (response.data) {
        const { decks, cards, studyHistory, userProfile, userAchievements } = response.data;
        await db.transaction('rw', [db.decks, db.flashcards, db.studyHistory, db.userProfile, db.userAchievements], async () => {
            if (decks) await db.decks.bulkPut(decks);
            if (cards) await db.flashcards.bulkPut(cards);
            if (studyHistory) await db.studyHistory.bulkPut(studyHistory);
            if (userProfile) await db.userProfile.put(userProfile);
            if (userAchievements) await db.userAchievements.bulkPut(userAchievements);
        });
      }
      await fetchData(); // Refresh state from DB
      setSyncStatus('synced');
      showToast('Profile loaded successfully!');
    } catch (error) {
      console.error("Failed to load from cloud", error);
      showToast('Failed to load profile. Please try again.');
      setSyncStatus('error');
    }
  };
  
  // Effect for initial session check
  useEffect(() => {
    const checkSession = async () => {
        const savedUser = sessionStorage.getItem('currentUser');
        if (savedUser) {
            const user: User = JSON.parse(savedUser);
            setCurrentUser(user);
            setIsLoggedIn(true);
            await db.open();
            await fetchData();
        }
        setAppLoading(false);
    };

    checkSession();
    
    // Load settings
    const savedSettings = localStorage.getItem('appSettings');
    if (savedSettings) {
        setSettings(prev => ({...prev, ...JSON.parse(savedSettings)}));
    }
    
    // Health Checks
    const checkApis = async () => {
        try { await callProxy('ping', {}); setApiStatus('ok'); } catch (e) { setApiStatus('error'); }
        try { await callProxy('ping-free-dict', {}); setFreeDictApiStatus('ok'); } catch (e) { setFreeDictApiStatus('error'); }
        try { await callProxy('ping-mw', {}); setMwDictApiStatus('ok'); } catch (e) { setMwDictApiStatus('error'); }
    }
    checkApis();
    db.open().then(() => setDbStatus('ok')).catch(() => setDbStatus('error'));

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
    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [settings.theme]);


  // Effect for debounced auto-syncing
  useEffect(() => {
    if (isInitialMount.current || !isLoggedIn) {
        setSyncStatus('idle');
        isInitialMount.current = false;
        return;
    };
    setSyncStatus('syncing'); 
    const handler = setTimeout(() => handleSync(), 2000);
    return () => clearTimeout(handler);
  }, [flashcards, decks, userProfile, earnedAchievements, isLoggedIn]);


  const updateSettings = (newSettings: Partial<Settings>) => {
      setSettings(prev => {
          const updated = { ...prev, ...newSettings };
          localStorage.setItem('appSettings', JSON.stringify(updated));
          return updated;
      })
  }

  const handleAddCard = () => {
    previousViewRef.current = view;
    setEditingCard(null);
    setView('FORM');
  };

  const handleEditCard = (card: Flashcard) => {
    previousViewRef.current = view;
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
    setView(previousViewRef.current);
  };

  const handleSaveProfile = async (profileData: Partial<UserProfile>) => {
    if (!userProfile) return;
    const updatedProfile = { 
      ...userProfile, 
      ...profileData,
      profileLastUpdated: new Date().toISOString()
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
      handleGoalUpdate('STUDY', updatedCardsFromSession.length);
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
      if(confirm("Are you sure you want to reset the application? All local decks and cards for this account will be permanently deleted. This action cannot be undone.")) {
          await db.delete();
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
        break;
      case 'all-due':
      default:
        cardsToStudy = cardsToStudy.filter(c => c.dueDate <= todayISOString);
        break;
    }
    
    for (let i = cardsToStudy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cardsToStudy[i], cardsToStudy[j]] = [cardsToStudy[j], cardsToStudy[i]];
    }
    
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
    await fetchData();
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

  // --- Auth Handlers ---
  const handleLogin = async (username: string, password: string) => {
      setAuthLoading(true);
      try {
          await callProxy('auth-login', { username, password });
          const user = { username };
          setCurrentUser(user);
          sessionStorage.setItem('currentUser', JSON.stringify(user));
          await loadDataFromCloud(username);
          setIsLoggedIn(true);
          showToast(`Welcome back, ${username}!`);
      } catch(e) {
          showToast((e as Error).message || 'Login failed.');
      } finally {
          setAuthLoading(false);
      }
  };

  const handleRegister = async (username: string, password: string) => {
      setAuthLoading(true);
      try {
          await callProxy('auth-register', { username, password });
          const user = { username };
          setCurrentUser(user);
          sessionStorage.setItem('currentUser', JSON.stringify(user));
          await db.delete().then(() => db.open()); // Start with a fresh DB
          await fetchData();
          setIsLoggedIn(true);
          showToast(`Account created! Welcome, ${username}!`);
      } catch (e) {
          showToast((e as Error).message || 'Registration failed.');
      } finally {
          setAuthLoading(false);
      }
  };

  const handleLogout = () => {
    if(confirm("Are you sure you want to log out?")) {
        sessionStorage.removeItem('currentUser');
        window.location.reload();
    }
  };


  // --- Render Logic ---
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
        return <PracticeView cards={visibleFlashcards} awardXP={awardXP} onQuizComplete={(score) => {
            handleCheckAchievements(score);
            handleGoalUpdate('QUIZ', 1);
        }} />;
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
            currentUser={currentUser}
            onLogout={handleLogout}
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
            onCancel={() => setView(previousViewRef.current)} 
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
        return <ProfileView 
            userProfile={userProfile} 
            streak={streak} 
            onSave={handleSaveProfile} 
            onBack={() => setView('SETTINGS')}
            earnedAchievements={earnedAchievements}
            onNavigateToAchievements={() => setView('ACHIEVEMENTS')}
        />;
      case 'BULK_ADD':
        return <BulkAddView 
            onSave={handleBulkSaveCards}
            onCancel={() => setView('DECKS')} 
            showToast={showToast}
            defaultApiSource={settings.defaultApiSource}
            concurrency={settings.bulkAddConcurrency || 3}
            aiTimeout={settings.bulkAddAiTimeout || 15}
            dictTimeout={settings.bulkAddDictTimeout || 2.5}
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
  
  if (appLoading) {
      return (
          <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-900">
              <div className="text-xl font-medium text-slate-600 dark:text-slate-300">Loading Lingua Cards...</div>
          </div>
      );
  }

  if (!isLoggedIn) {
      return <AuthView onLogin={handleLogin} onRegister={handleRegister} isLoading={authLoading} />
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