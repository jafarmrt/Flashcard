import React, { useState, useEffect, useRef } from 'react';
import { Flashcard, Deck, Settings, StudySessionOptions, UserProfile, UserAchievement } from '../types';
import { db } from '../services/localDBService';
import { calculateLevel, calculateStreak, checkAndAwardAchievements } from '../services/gamificationService';
import { generateNewDailyGoals, updateGoalProgress } from '../services/dailyGoalsService';
import { ALL_ACHIEVEMENTS } from '../services/achievements';
import { callProxy } from '../services/apiService';
import { convertToCSV, parseCSV } from '../services/csvService';

// Types used within the hook and exported for the App component
export type View = 'LIST' | 'FORM' | 'STUDY' | 'STATS' | 'PRACTICE' | 'SETTINGS' | 'DECKS' | 'CHANGELOG' | 'BULK_ADD' | 'ACHIEVEMENTS' | 'PROFILE';
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
export type HealthStatus = 'ok' | 'error' | 'checking';
type FlashcardFormData = Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId' | 'isDeleted'>;
type User = { username: string };

const defaultSettings: Settings = {
    theme: 'system',
    defaultApiSource: 'free',
    bulkAddConcurrency: 3,
    bulkAddAiTimeout: 15,
    bulkAddDictTimeout: 5,
};

export const useAppLogic = () => {
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
  const [authLoading, setAuthLoading] = useState(false);
  const [appLoading, setAppLoading] = useState(true);

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

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

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
      const today = new Date().toISOString().split('T')[0];
      if (userProfile.lastStreakCheck === today) return;

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
      await db.delete().then(() => db.open());
      
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
    db.open().then(() => setDbStatus('ok')).catch(() => setDbStatus('error'));
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

    const visibleFlashcards = flashcards.filter(c => !c.isDeleted);
    let cardsToStudy = studyDeckId
      ? visibleFlashcards.filter(card => card.deckId === studyDeckId)
      : visibleFlashcards;

    switch (options.filter) {
      case 'new': cardsToStudy = cardsToStudy.filter(c => c.repetition === 0); break;
      case 'review': cardsToStudy = cardsToStudy.filter(c => c.repetition > 0 && c.dueDate <= todayISOString); break;
      case 'all-cards': break;
      case 'all-due': default: cardsToStudy = cardsToStudy.filter(c => c.dueDate <= todayISOString); break;
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
        setStudyDeckId(null);
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
          await db.delete().then(() => db.open());
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

  return {
      // State
      flashcards, decks, view, editingCard, toastMessage, isLoggedIn, currentUser, authLoading, appLoading,
      syncStatus, studyDeckId, studyCards, isStudySetupModalOpen, dbStatus, apiStatus,
      freeDictApiStatus, mwDictApiStatus, settings, userProfile, streak, earnedAchievements,
      previousViewRef,
      // Handlers
      setView, showToast, handleAddCard, handleEditCard, handleDeleteCard, handleSaveCard,
      handleSaveProfile, handleBulkSaveCards, handleSessionEnd, handleExportCSV, handleImportCSV,
      handleResetApp, handleStudyDeck, handleStartStudySession, setIsStudySetupModalOpen,
      handleNavigate, handleRenameDeck, handleDeleteDeck, handleLogin, handleRegister, handleLogout,
      updateSettings, handleCheckAchievements, handleGoalUpdate,
  };
};
