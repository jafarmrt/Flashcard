import React, { useState, useEffect, useRef } from 'react';
import { Flashcard, Deck, Settings, StudySessionOptions, UserProfile, UserAchievement, ExtractedWordCard, StudyLog, TextDoc } from '../types';
import { db } from '../services/localDBService';
import { calculateLevel, calculateStreak, checkAndAwardAchievements } from '../services/gamificationService';
import { generateNewDailyGoals, updateGoalProgress, reviewGoalId } from '../services/dailyGoalsService';
import { availableFreezes, dayString, daysToFreeze, MAX_HELD_FREEZES } from '../services/streakService';
import { CHUNK_COMPLETE_XP, DEFAULT_DAILY_REVIEW_GOAL, isChestSection } from '../services/xpRules';
import { completeChunk, createTextDoc } from '../services/textLibrary';
import { ALL_ACHIEVEMENTS } from '../services/achievements';
import { AUTH_REQUIRED_EVENT, callProxy } from '../services/apiService';
import { applyIncomingSettings, toSyncedSettings } from '../services/settingsSync';
import { convertToCSV, parseCSV } from '../services/csvService';
import { freeEnrich, FreeEnrichment } from '../services/freeExtractionService';
import { 
  generatePersianDetails,
} from '../services/geminiService';
import {
  fetchFromFreeDictionary,
  fetchFromMerriamWebster,
  fetchAudioData,
  DictionaryResult
} from '../services/dictionaryService';
import { AutoFixStats } from '../components/AutoFixReportModal';

// Types used within the hook and exported for the App component
export type View = 'TODAY' | 'ME' | 'TEXTS' | 'READER' | 'LIST' | 'FORM' | 'STUDY' | 'STATS' | 'PRACTICE' | 'SETTINGS' | 'DECKS' | 'CHANGELOG' | 'BULK_ADD' | 'ACHIEVEMENTS' | 'PROFILE' | 'AI_EXTRACT';
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
export type HealthStatus = 'ok' | 'error' | 'checking';
type FlashcardFormData = Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId' | 'isDeleted' | 'createdAt' | 'updatedAt'>;
type User = { username: string };

export type StudyMode = 'flip' | 'type';
export interface SessionSummary { xp: number; reviews: number }

// Settings are kept in localStorage; read the review goal straight from there so
// it is right even before the settings state has loaded.
const savedReviewGoal = (): number => {
  try {
    const saved = JSON.parse(localStorage.getItem('appSettings') || '{}');
    const goal = Number(saved.dailyReviewGoal);
    return goal > 0 ? goal : DEFAULT_DAILY_REVIEW_GOAL;
  } catch {
    return DEFAULT_DAILY_REVIEW_GOAL;
  }
};

const readSavedSettings = (): Partial<Settings> => {
  try {
    return JSON.parse(localStorage.getItem('appSettings') || '{}');
  } catch {
    return {};
  }
};

const defaultSettings: Settings = {
    theme: 'system',
    defaultApiSource: 'free',
    bulkAddConcurrency: 3,
    bulkAddAiTimeout: 15,
    bulkAddDictTimeout: 5,
    dailyReviewGoal: DEFAULT_DAILY_REVIEW_GOAL,
};

export const useAppLogic = () => {
  // App State
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [view, setView] = useState<View>('TODAY');
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const previousViewRef = useRef<View>('TODAY');
  
  // Auth State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [appLoading, setAppLoading] = useState(true);

  // Sync State
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');

  // Study State
  const [studyDeckId, setStudyDeckId] = useState<string | null>(null);
  const [studyCards, setStudyCards] = useState<Flashcard[]>([]);
  const [isStudySetupModalOpen, setIsStudySetupModalOpen] = useState(false);
  const [studyMode, setStudyMode] = useState<StudyMode>('flip');
  const [studyLogs, setStudyLogs] = useState<StudyLog[]>([]);

  // Reading path State
  const [texts, setTexts] = useState<TextDoc[]>([]);
  const [activeTextId, setActiveTextId] = useState<string | null>(null);
  const [activeChunk, setActiveChunk] = useState(0);
  
  // Auto-Fix State
  const [autoFixProgress, setAutoFixProgress] = useState<{ current: number, total: number } | null>(null);
  const [autoFixReport, setAutoFixReport] = useState<AutoFixStats | null>(null);
  const cancelAutoFixRef = useRef(false);

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
  // Set while a sync reloads the merged data, so that reload does not start
  // another sync (which used to repeat every 2 seconds).
  const reloadingFromSync = useRef(false);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const checkAndRefreshDailyGoals = async (profile: UserProfile, currentStreak: number) => {
    // Fix: Use local date string (YYYY-MM-DD) instead of UTC to prevent goals from resetting
    // when the user is in a timezone where it is still today, but UTC is tomorrow.
    const today = new Date().toLocaleDateString('en-CA'); // 'en-CA' gives YYYY-MM-DD format locally
    
    const target = savedReviewGoal();
    const goals = profile.dailyGoals;
    const sameDay = goals?.date === today;
    // A changed goal applies at once unless today's goal is already done.
    const goalChanged = sameDay && goals!.goals[0]?.id !== reviewGoalId(target) && !goals!.goals[0]?.isComplete;
    if (!goals || !sameDay || goalChanged) {
        const newGoals = generateNewDailyGoals(currentStreak, target);
        if (goalChanged && goals!.goals[0]?.type === 'STUDY') {
            newGoals[0].progress = Math.min(goals!.goals[0].progress, target);
        }
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
    const allTexts = await db.texts.toArray();
    setTexts(allTexts);
    setFlashcards(allCards);
    setDecks(allDecks);
    setEarnedAchievements(allAchievements);

    let profile = await db.userProfile.get(1);
    if (!profile) {
      profile = { id: 1, xp: 0, level: 1, lastStreakCheck: '', firstName: '', lastName: '', bio: '', profileLastUpdated: new Date().toISOString() };
      await db.userProfile.add(profile);
    }
    
    const allLogs = await db.studyHistory.toArray();
    setStudyLogs(allLogs);

    // Spend held streak freezes on days missed since the last study day.
    const frozen = profile.frozenDates || [];
    const toFreeze = daysToFreeze(
      new Set(allLogs.map(l => l.date)), new Set(frozen),
      availableFreezes(profile.streakFreezesEarned, frozen), dayString(new Date()),
    );
    if (toFreeze.length > 0) {
      profile = { ...profile, frozenDates: [...frozen, ...toFreeze], profileLastUpdated: new Date().toISOString() };
      await db.userProfile.put(profile);
      const days = toFreeze.length;
      setTimeout(() => showToast(days === 1 ? 'محافظ زنجیره یک روز غیبت را پوشاند.' : `محافظ زنجیره ${days} روز غیبت را پوشاند.`), 800);
    }

    const currentStreak = calculateStreak(allLogs, profile.frozenDates);
    setStreak(currentStreak);
    
    if (profile) {
      profile = await checkAndRefreshDailyGoals(profile, currentStreak);
    }
    setUserProfile(profile);
    
    return { cards: allCards, decks: allDecks, logs: allLogs, profile, achievements: allAchievements };
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
    handleCheckAchievements();
  };

  const handleGoalUpdate = async (type: 'STUDY' | 'QUIZ' | 'STREAK', value: number, isXpOverride = false) => {
    if (isXpOverride) {
        await awardXP(value);
        return;
    }
    const currentProfile = await db.userProfile.get(1);
    if (!currentProfile?.dailyGoals) return;

    const { updatedProfile: profileWithGoalProgress, xpGained, newlyCompletedGoals } = updateGoalProgress(type, value, currentProfile);
    
    const updatedProfile = {
        ...profileWithGoalProgress,
        profileLastUpdated: new Date().toISOString()
    };
    await db.userProfile.put(updatedProfile);
    setUserProfile(updatedProfile);

    if (xpGained > 0) await awardXP(xpGained);

    newlyCompletedGoals.forEach(goal => {
        setTimeout(() => showToast(`Goal Complete: ${goal.description} (+${goal.xp} XP)`), 500);
    });

    if (updatedProfile.dailyGoals.allCompleteAwarded && !currentProfile.dailyGoals.allCompleteAwarded) {
        setTimeout(() => showToast(`All goals complete! Bonus +50 XP! ✨`), newlyCompletedGoals.length > 0 ? 1000 : 500);
    }
  };

  const checkStreakBonus = async () => {
      if (!userProfile) return;
      // Fix: Use local date for streak check as well to maintain consistency with daily goals
      const today = new Date().toLocaleDateString('en-CA'); 
      if (userProfile.lastStreakCheck === today) return;

      const logs = await db.studyHistory.toArray();
      const newStreak = calculateStreak(logs, userProfile.frozenDates);

      if (newStreak > streak) {
          await awardXP(newStreak * 10, `Streak Bonus: ${newStreak} days! 🔥`);
      }
      handleGoalUpdate('STREAK', newStreak);
      
      const updatedProfile = { ...userProfile, lastStreakCheck: today };
      await db.userProfile.put(updatedProfile);
      setUserProfile(updatedProfile);
  };

  // Take settings changed on another device, keeping this device's AI key.
  const adoptCloudSettings = (incoming?: Partial<Settings>) => {
    const merged = applyIncomingSettings(readSavedSettings(), incoming);
    if (!merged) return;
    localStorage.setItem('appSettings', JSON.stringify(merged));
    setSettings({ ...defaultSettings, ...merged } as Settings);
  };

  const handleSync = async () => {
    if (!currentUser?.username) return;

    setSyncStatus('syncing');
    try {
        // Fix: Read directly from the database to ensure the latest data is synced,
        // preventing race conditions with React state.
        const allCards = await db.flashcards.toArray();
        const allDecks = await db.decks.toArray();
        const allStudyHistory = await db.studyHistory.toArray();
        const profile = await db.userProfile.get(1);
        const allAchievements = await db.userAchievements.toArray();
        const allTexts = await db.texts.toArray();

        const localData = {
            texts: allTexts,
            decks: allDecks,
            cards: allCards,
            studyHistory: allStudyHistory,
            userProfile: profile,
            userAchievements: allAchievements,
            settings: toSyncedSettings(readSavedSettings()),
        };

        const response = await callProxy('sync-merge', { data: localData });
        
        const { data: mergedData } = response;
        if (mergedData) {
            await (db as any).transaction('rw', [db.decks, db.flashcards, db.studyHistory, db.userProfile, db.userAchievements, db.texts], async () => {
                // Bug Fix: Do NOT clear tables here. Clearing tables wipes out any changes made locally 
                // while the network request was in flight (the "Reversion" bug).
                // We use bulkPut which updates existing items and adds new ones.
                // Since 'sync-merge' handles the logic of what is deleted (via isDeleted flags),
                // this is safe and prevents data loss.
                
                if (mergedData.decks) await db.decks.bulkPut(mergedData.decks);
                if (mergedData.cards) await db.flashcards.bulkPut(mergedData.cards);
                if (mergedData.studyHistory) await db.studyHistory.bulkPut(mergedData.studyHistory);
                if (mergedData.userProfile) await db.userProfile.put(mergedData.userProfile);
                if (mergedData.userAchievements) await db.userAchievements.bulkPut(mergedData.userAchievements);
                if (mergedData.texts) await db.texts.bulkPut(mergedData.texts);
            });
            adoptCloudSettings(mergedData.settings);
            reloadingFromSync.current = true;
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
      await (db as any).delete().then(() => (db as any).open());
      
      const response = await callProxy('sync-load', {});
      if (response.data) {
        const { decks, cards, studyHistory, userProfile, userAchievements, texts } = response.data;
        await (db as any).transaction('rw', [db.decks, db.flashcards, db.studyHistory, db.userProfile, db.userAchievements, db.texts], async () => {
            if (texts) await db.texts.bulkPut(texts);
            if (decks) await db.decks.bulkPut(decks);
            if (cards) await db.flashcards.bulkPut(cards);
            if (studyHistory) await db.studyHistory.bulkPut(studyHistory);
            if (userProfile) await db.userProfile.put(userProfile);
            if (userAchievements) await db.userAchievements.bulkPut(userAchievements);
        });
        adoptCloudSettings(response.data.settings);
      }
      await fetchData();
      setSyncStatus('synced');
      showToast('Profile loaded successfully!');
    } catch (error) {
      console.error("Failed to load from cloud", error);
      showToast('Failed to load profile. Please try again.');
      setSyncStatus('error');
    }
  };
  
  useEffect(() => {
    // The server knows who is signed in from its HttpOnly session cookie.
    const checkSession = async () => {
        try {
            const { username } = await callProxy('auth-session', {});
            if (username) {
                setCurrentUser({ username });
                setIsLoggedIn(true);
                await (db as any).open();
                await fetchData();
            }
        } catch (e) {
            console.error('Could not check the session:', e);
        }
        setAppLoading(false);
    };

    checkSession();

    const onAuthRequired = () => {
        setIsLoggedIn(false);
        setCurrentUser(null);
        showToast('Your session has expired. Please sign in again.');
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    
    const savedSettings = localStorage.getItem('appSettings');
    if (savedSettings) {
        setSettings(prev => ({...prev, ...JSON.parse(savedSettings)}));
    }
    
    const checkApis = async () => {
        try { await callProxy('ping', {}); setApiStatus('ok'); } catch (e) { setApiStatus('error'); }
        try { await callProxy('ping-free-dict', {}); setFreeDictApiStatus('ok'); } catch (e) { setFreeDictApiStatus('error'); }
        try { await callProxy('ping-mw', {}); setMwDictApiStatus('ok'); } catch (e) { setMwDictApiStatus('error'); }
    }
    checkApis();
    (db as any).open().then(() => setDbStatus('ok')).catch(() => setDbStatus('error'));
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

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


  useEffect(() => {
    if (isInitialMount.current || !isLoggedIn) {
        setSyncStatus('idle');
        isInitialMount.current = false;
        return;
    };
    
    // Fix: Do NOT trigger auto-sync if Auto-Fix is currently running.
    // This prevents the sync logic from interfering with the rapid local DB updates.
    if (autoFixProgress) {
        return;
    }

    if (reloadingFromSync.current) {
        reloadingFromSync.current = false;
        return;
    }

    setSyncStatus('syncing'); 
    const handler = setTimeout(() => handleSync(), 2000);
    return () => clearTimeout(handler);
  }, [flashcards, decks, userProfile, earnedAchievements, texts, isLoggedIn, autoFixProgress, settings.updatedAt]); // Added autoFixProgress dependency


  const updateSettings = (changes: Partial<Settings>) => {
      const newSettings = { ...changes, updatedAt: new Date().toISOString() };
      if (newSettings.dailyReviewGoal !== undefined) {
          // Save first so the goal refresh below already sees the new value.
          const saved = JSON.parse(localStorage.getItem('appSettings') || '{}');
          localStorage.setItem('appSettings', JSON.stringify({ ...saved, ...newSettings }));
          if (isLoggedIn) fetchData();
      }
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
    await db.flashcards.update(id, { isDeleted: true, updatedAt: new Date().toISOString() });
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
    // Explicitly use Map/Set to avoid array inference issues in loops/complex logic if needed,
    // but for simple lookup find() is fine.
    let deck = allDecks.find(d => d.name.toLowerCase() === trimmedDeckName.toLowerCase() && !d.isDeleted);

    if (!deck) {
      const newDeck: Deck = { id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, name: trimmedDeckName };
      await db.decks.add(newDeck);
      deck = newDeck;
    }
    
    if (editingCard) {
      const updatedCard: Flashcard = { 
        ...editingCard, 
        ...cardData, 
        deckId: deck!.id, 
        updatedAt: new Date().toISOString() 
      };
      await db.flashcards.put(updatedCard);
      showToast('Card updated successfully!');
    } else {
      const now = new Date().toISOString();
      const newCard: Flashcard = {
        ...cardData,
        id: Date.now().toString(),
        deckId: deck!.id,
        repetition: 0,
        easinessFactor: 2.5,
        interval: 0,
        createdAt: now,
        updatedAt: now,
        dueDate: now,
      };
      await db.flashcards.add(newCard);
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

    const now = new Date().toISOString();
    const newCards: Flashcard[] = cardsToSave.map((cardData, index) => ({
        ...cardData,
        id: `${Date.now()}-${index}`,
        deckId: deck!.id,
        repetition: 0,
        easinessFactor: 2.5,
        interval: 0,
        createdAt: now,
        updatedAt: now,
        dueDate: now,
    }));

    if (newCards.length > 0) {
        await db.flashcards.bulkAdd(newCards);
    }
    
    await fetchData();
    handleCheckAchievements();
    showToast(`${newCards.length} cards added to "${trimmedDeckName}"!`);
    setView('DECKS');
  };

  const handleSaveExtractedCards = async (cardsToSave: ExtractedWordCard[], deckName: string, options: { stay?: boolean } = {}) => {
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

    const now = new Date().toISOString();
    const newCards: Flashcard[] = cardsToSave.map((cardData) => ({
      id: crypto.randomUUID(),
      deckId: deck!.id,
      front: cardData.front,
      back: cardData.back,
      pronunciation: cardData.pronunciation || '',
      partOfSpeech: cardData.partOfSpeech || '',
      definition: cardData.definition || [],
      exampleSentenceTarget: cardData.exampleSentenceTarget || [],
      notes: cardData.notes || '',
      kind: cardData.kind,
      sourceSentence: cardData.sourceSentence,
      collocations: cardData.collocations || [],
      grammarPattern: cardData.grammarPattern,
      practicePrompt: cardData.practicePrompt,
      audioSrc: cardData.audioSrc,
      repetition: 0,
      easinessFactor: 2.5,
      interval: 0,
      createdAt: now,
      updatedAt: now,
      dueDate: now,
    }));

    if (newCards.length > 0) {
      await db.flashcards.bulkAdd(newCards);
    }

    await fetchData();
    handleCheckAchievements();
    if (options.stay) {
      showToast(`${newCards.length} کارت به «${trimmedDeckName}» اضافه شد.`);
      return;
    }
    showToast(`${newCards.length} cards added to "${trimmedDeckName}"!`);
    setView('DECKS');
  };

  const handleSessionEnd = async (updatedCardsFromSession: Flashcard[], summary: SessionSummary = { xp: 0, reviews: 0 }, next: 'home' | 'more' = 'home') => {
    if (updatedCardsFromSession.length > 0) {
      const now = new Date().toISOString();
      const cardsToUpdate = updatedCardsFromSession.map(c => ({ ...c, updatedAt: now }));
      await db.flashcards.bulkPut(cardsToUpdate);
    }
    // XP is added once per session so an undone answer never counts.
    if (summary.xp > 0) await awardXP(summary.xp);
    if (summary.reviews > 0) await handleGoalUpdate('STUDY', summary.reviews);
    const fresh = await fetchData();
    handleCheckAchievements();
    if (next === 'more') {
      startQuickReview(studyMode, 10, fresh.cards);
      return;
    }
    setView('TODAY');
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
      const blob = new Blob([`\uFEFF${csvData}`], { type: 'text/csv;charset=utf-8;' });
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
        // Explicitly type the Map to ensure deck retrieval is strongly typed and avoid 'unknown' errors
        const deckNameMap = new Map<string, Deck>();
        allDecks.forEach(d => deckNameMap.set(d.name.toLowerCase(), d));
        
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
                const newDeck: Deck = { id: `${Date.now()}-${rowCount}`, name: deckName };
                deckNameMap.set(lowerDeckName, newDeck);
                newDecks.push(newDeck);
                deck = newDeck;
            }

            const now = new Date().toISOString();
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
                createdAt: now,
                updatedAt: now,
                dueDate: now,
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
          await (db as any).delete();
          localStorage.removeItem('appSettings');
          window.location.reload();
      }
  }

  const handleStudyDeck = (deckId: string) => {
    setStudyDeckId(deckId);
    setIsStudySetupModalOpen(true);
  };
  
  const handleStartStudySession = (options: StudySessionOptions, deckIdOverride?: string | null, sourceCards: Flashcard[] = flashcards) => {
    checkStreakBonus();
    const deckId = deckIdOverride !== undefined ? deckIdOverride : studyDeckId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISOString = today.toISOString();

    const visibleFlashcards = sourceCards.filter(c => !c.isDeleted);
    let cardsToStudy = deckId
      ? visibleFlashcards.filter(card => card.deckId === studyDeckId)
      : visibleFlashcards;

    switch (options.filter) {
      case 'new': 
        // Fix: Stricter check for new cards
        cardsToStudy = cardsToStudy.filter(c => c.repetition === 0 && c.interval === 0); 
        break;
      case 'review': 
        cardsToStudy = cardsToStudy.filter(c => (c.repetition > 0 || c.interval > 0) && c.dueDate <= todayISOString); 
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
        return false;
    }

    setStudyCards(cardsToStudy);
    setIsStudySetupModalOpen(false);
    setView('STUDY');
    return true;
  };

  // "Start review" on the Today screen: every due card, no setup dialog.
  const startQuickReview = (mode: StudyMode = 'flip', limit = 0, sourceCards: Flashcard[] = flashcards) => {
    setStudyMode(mode);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const due = sourceCards.filter(c => !c.isDeleted && new Date(c.dueDate) <= endOfToday);
    if (due.length === 0) {
      showToast('امروز کارت موعددار نداری. می‌توانی مرور آزاد را انتخاب کنی.');
      setStudyDeckId(null);
      setIsStudySetupModalOpen(true);
      setView('TODAY');
      return;
    }
    setStudyDeckId(null);
    handleStartStudySession({ filter: 'all-due', limit }, null, sourceCards);
  };

  const openStudySetup = (mode: StudyMode = 'flip') => {
    setStudyMode(mode);
    setStudyDeckId(null);
    setIsStudySetupModalOpen(true);
  };

  // --- Reading path ---

  const saveText = async (doc: TextDoc) => {
    await db.texts.put(doc);
    setTexts(prev => [...prev.filter(t => t.id !== doc.id), doc]);
  };

  const handleCreateText = async (title: string, text: string) => {
    const doc = createTextDoc(title, text);
    if (doc.chunks.length === 0) {
      showToast('متن خالی است.');
      return;
    }
    await saveText(doc);
    setActiveTextId(doc.id);
    setView('TEXTS');
  };

  const handleOpenText = (textId: string | null) => {
    setActiveTextId(textId);
    setView('TEXTS');
  };

  const handleOpenChunk = (textId: string, index: number) => {
    setActiveTextId(textId);
    setActiveChunk(index);
    setView('READER');
  };

  const handleDeleteText = async (textId: string) => {
    const doc = texts.find(t => t.id === textId);
    if (!doc) return;
    await saveText({ ...doc, isDeleted: true, updatedAt: new Date().toISOString() });
    setActiveTextId(null);
  };

  const handleCompleteChunk = async (textId: string, index: number) => {
    const doc = texts.find(t => t.id === textId);
    if (!doc) return;
    const { doc: updated, firstTime } = completeChunk(doc, index);
    if (!firstTime) {
      setView('TEXTS');
      return;
    }
    await saveText(updated);
    await awardXP(CHUNK_COMPLETE_XP, `بخش ${index + 1} تمام شد. +${CHUNK_COMPLETE_XP} امتیاز`);
    if (isChestSection(index)) {
      const profile = await db.userProfile.get(1);
      if (profile && availableFreezes(profile.streakFreezesEarned, profile.frozenDates) < MAX_HELD_FREEZES) {
        const withFreeze = { ...profile, streakFreezesEarned: (profile.streakFreezesEarned || 0) + 1, profileLastUpdated: new Date().toISOString() };
        await db.userProfile.put(withFreeze);
        setUserProfile(withFreeze);
        setTimeout(() => showToast('صندوق جایزه: یک محافظ زنجیره گرفتی.'), 1200);
      }
    }
    setView('TEXTS');
  };

  const handleNavigate = (newView: View) => {
    if (newView === 'STUDY') {
        setStudyDeckId(null);
        setIsStudySetupModalOpen(true);
    } else if (newView === 'LIST' && view !== 'LIST') {
        setView('DECKS');
    } else {
        setView(newView);
    }
  }

  const handleRenameDeck = async (deckId: string, newName: string) => {
    const existingDeck: Deck | undefined = decks.find(d => d.name.toLowerCase() && newName.toLowerCase() && !d.isDeleted);
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
      const now = new Date().toISOString();
      await (db as any).transaction('rw', db.flashcards, db.decks, async () => {
          if (cardIdsToSoftDelete.length > 0) {
              await db.flashcards.where('id').anyOf(cardIdsToSoftDelete).modify({ isDeleted: true, updatedAt: now });
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

  const handleLogin = async (username: string, password: string) => {
      setAuthLoading(true);
      try {
          const res = await callProxy('auth-login', { username, password });
          const user = { username: res.username || username };
          setCurrentUser(user);
          await loadDataFromCloud(user.username);
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
          const res = await callProxy('auth-register', { username, password });
          const user = { username: res.username || username };
          setCurrentUser(user);
          await (db as any).delete().then(() => (db as any).open());
          await fetchData();
          setIsLoggedIn(true);
          showToast(`Account created! Welcome, ${username}!`);
      } catch (e) {
          showToast((e as Error).message || 'Registration failed.');
      } finally {
          setAuthLoading(false);
      }
  };

  const handleLogout = async () => {
    if(confirm("Are you sure you want to log out?")) {
        await callProxy('auth-logout', {}).catch(e => console.error('Logout request failed:', e));
        window.location.reload();
    }
  };

  // Return type used to aggregate stats
  const aiRequestOptions = () => ({
    aiProvider: settings.aiProvider || 'gemini',
    aiBaseUrl: settings.aiBaseUrl || undefined,
    customApiKey: settings.customApiKey || undefined,
    model: settings.aiModel || undefined,
  });

  const handleCompleteCardDetails = async (cardId: string, options: { silent?: boolean } = {}): Promise<{
    success: boolean;
    updates: { audio: boolean; def: boolean; ex: boolean; pron: boolean; trans: boolean };
  }> => {
    const cardToComplete = await db.flashcards.get(cardId);
    const updates = { audio: false, def: false, ex: false, pron: false, trans: false };
    
    if (!cardToComplete) {
        if (!options.silent) showToast("Card not found.");
        return { success: false, updates };
    }

    try {
        const fetcher = settings.defaultApiSource === 'free' ? fetchFromFreeDictionary : fetchFromMerriamWebster;
        const details: DictionaryResult = await fetcher(cardToComplete.front).catch(() => ({
             pronunciation: '', partOfSpeech: '', definitions: [], exampleSentences: [], audioUrl: undefined
        }));
        
        let audioUrl: string | undefined = cardToComplete.audioSrc;
        if (details.audioUrl && !audioUrl) {
           audioUrl = details.audioUrl;
           updates.audio = true;
        }
        
        // Common expressions and a free translation come from free dictionaries (no AI needed).
        let enrichment: FreeEnrichment | null = null;
        const needsCollocations = cardToComplete.kind !== 'grammar' && !(cardToComplete.collocations && cardToComplete.collocations.length > 0);
        if (needsCollocations || !cardToComplete.back) {
            enrichment = await freeEnrich(cardToComplete.front).catch(() => null);
        }

        let persianDetails = { back: cardToComplete.back, notes: cardToComplete.notes };
        if (!cardToComplete.back || !cardToComplete.notes) {
             try {
                const ai = await generatePersianDetails(cardToComplete.front, aiRequestOptions());
                persianDetails = { back: cardToComplete.back || ai.back, notes: cardToComplete.notes || ai.notes };
             } catch (e) {
                 console.error("AI Generation failed during complete, using free translation:", e);
                 persianDetails = { back: cardToComplete.back || enrichment?.translation || '', notes: cardToComplete.notes || '' };
             }
             if (persianDetails.back && persianDetails.back !== cardToComplete.back) updates.trans = true;
        }

        if (!cardToComplete.pronunciation && details.pronunciation) updates.pron = true;
        if ((!cardToComplete.definition || cardToComplete.definition.length === 0) && details.definitions.length > 0) updates.def = true;
        if ((!cardToComplete.exampleSentenceTarget || cardToComplete.exampleSentenceTarget.length === 0) && details.exampleSentences.length > 0) updates.ex = true;

        const updatedCard: Flashcard = {
            ...cardToComplete,
            pronunciation: cardToComplete.pronunciation || details.pronunciation,
            partOfSpeech: cardToComplete.partOfSpeech || details.partOfSpeech,
            definition: (cardToComplete.definition && cardToComplete.definition.length > 0) ? cardToComplete.definition : details.definitions,
            exampleSentenceTarget: (cardToComplete.exampleSentenceTarget && cardToComplete.exampleSentenceTarget.length > 0) ? cardToComplete.exampleSentenceTarget : details.exampleSentences,
            audioSrc: audioUrl,
            back: persianDetails.back,
            notes: persianDetails.notes || '',
            collocations: needsCollocations && enrichment?.collocations.length ? enrichment.collocations : cardToComplete.collocations,
            updatedAt: new Date().toISOString()
        };

        await db.flashcards.put(updatedCard);
        
        // Performance Fix: Surgically update the state instead of re-fetching everything.
        setFlashcards(prev => prev.map(c => c.id === updatedCard.id ? updatedCard : c));

        if (!options.silent) showToast(`Card "${cardToComplete.front}" updated!`);
        return { success: true, updates };

    } catch (error) {
        console.error("Failed to complete card details:", error);
        if (!options.silent) showToast(`Could not complete details for "${cardToComplete.front}".`);
        return { success: false, updates };
    }
  };

  const handleAutoFixCards = async () => {
    cancelAutoFixRef.current = false;
    const incompleteCards = flashcards.filter(c => 
        !c.isDeleted && (
            !c.audioSrc || 
            !c.definition || c.definition.length === 0 ||
            !c.exampleSentenceTarget || c.exampleSentenceTarget.length === 0 ||
            !c.pronunciation ||
            !c.back ||
            !c.notes
        )
    );

    if (incompleteCards.length === 0) {
        showToast("All cards are already complete!");
        return;
    }

    setAutoFixProgress({ current: 0, total: incompleteCards.length });

    const stats: AutoFixStats = {
        totalChecked: incompleteCards.length,
        totalUpdated: 0,
        audioAdded: 0,
        definitionsAdded: 0,
        examplesAdded: 0,
        pronunciationsAdded: 0,
        translationsAdded: 0,
    };

    for (let i = 0; i < incompleteCards.length; i++) {
        if (cancelAutoFixRef.current) {
            break;
        }
        const card = incompleteCards[i];
        const result = await handleCompleteCardDetails(card.id, { silent: true });
        
        if (result.success) {
            const u = result.updates;
            if (u.audio || u.def || u.ex || u.pron || u.trans) {
                stats.totalUpdated++;
                if (u.audio) stats.audioAdded++;
                if (u.def) stats.definitionsAdded++;
                if (u.ex) stats.examplesAdded++;
                if (u.pron) stats.pronunciationsAdded++;
                if (u.trans) stats.translationsAdded++;
            }
        }
        setAutoFixProgress({ current: i + 1, total: incompleteCards.length });
    }

    setAutoFixProgress(null);
    // Set report to trigger modal
    if (!cancelAutoFixRef.current) {
        setAutoFixReport(stats);
    } else {
        showToast("Auto-fix stopped.");
    }
  };

  const handleStopAutoFix = () => {
      cancelAutoFixRef.current = true;
  };
  
  const handleCloseAutoFixReport = () => {
      setAutoFixReport(null);
  }

  return {
      // State
      flashcards, decks, view, editingCard, toastMessage, isLoggedIn, currentUser, authLoading, appLoading,
      syncStatus, studyDeckId, studyCards, isStudySetupModalOpen, studyMode, studyLogs, texts, activeTextId, activeChunk, dbStatus, apiStatus,
      freeDictApiStatus, mwDictApiStatus, settings, userProfile, streak, earnedAchievements,
      previousViewRef, autoFixProgress, autoFixReport,
      // Handlers
      setView, showToast, handleAddCard, handleEditCard, handleDeleteCard, handleSaveCard,
      handleSaveProfile, handleBulkSaveCards, handleSessionEnd, handleExportCSV, handleImportCSV,
      handleResetApp, handleStudyDeck, handleStartStudySession, setIsStudySetupModalOpen,
      handleNavigate, handleRenameDeck, handleDeleteDeck, handleLogin, handleRegister, handleLogout,
      updateSettings, handleCheckAchievements, handleGoalUpdate, handleCompleteCardDetails,
      handleAutoFixCards, handleStopAutoFix, handleCloseAutoFixReport, handleSaveExtractedCards,
      startQuickReview, openStudySetup, setStudyMode, handleCreateText, handleOpenText, handleOpenChunk,
      handleDeleteText, handleCompleteChunk
  };
};