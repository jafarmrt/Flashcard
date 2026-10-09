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
import { applicableRows, cardStamp, deckStamp, newStudyLogs, profileStamp, stampMap, syncFingerprint } from '../services/syncState';
import { isDue, isNewCard } from '../services/srsService';
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

// The account last signed in on this browser, so the app opens offline.
const LAST_USER_KEY = 'lc_last_user';

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
  // Fingerprint of the data as of the last finished sync: the automatic sync
  // runs only when the data differs from it (reloading the merged data used to
  // start a new sync every 2 seconds, forever).
  const lastSyncedFingerprint = useRef<string | null>(null);
  const syncInFlight = useRef(false);
  const syncAgain = useRef(false);
  const lastSyncAt = useRef(0);
  const signedInUser = useRef<string | null>(null);
  // Bumped for every study session, so a new session starts with fresh counters.
  const [studySessionId, setStudySessionId] = useState(0);

  const signIn = (username: string) => {
    signedInUser.current = username;
    setCurrentUser({ username });
    localStorage.setItem(LAST_USER_KEY, username);
  };

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
    
    return { cards: allCards, decks: allDecks, texts: allTexts, logs: allLogs, profile, achievements: allAchievements };
  };
  
  // Reads everything from the database: React state can be a step behind
  // right after a save.
  const handleCheckAchievements = async (quizScore?: { score: number, total: number }) => {
    const profile = await db.userProfile.get(1);
    if (!profile) return;
    const newAchievements = await checkAndAwardAchievements({
        allCards: (await db.flashcards.toArray()).filter(c => !c.isDeleted),
        allDecks: await db.decks.toArray(),
        studyLogs: await db.studyHistory.toArray(),
        userProfile: profile,
        earnedAchievements: await db.userAchievements.toArray(),
        quizScore,
    }).catch(error => {
        console.error('Achievement check failed:', error);
        return [];
    });

    if (newAchievements.length > 0) {
        setEarnedAchievements(prev => [...prev.filter(a => !newAchievements.some(n => n.achievementId === a.achievementId)), ...newAchievements]);
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


  // Read, change and write the profile in one transaction, so two updates at
  // the same moment (quiz XP and its goal, say) never overwrite each other.
  const updateProfile = async (change: (p: UserProfile) => UserProfile): Promise<{ before: UserProfile; after: UserProfile } | null> => {
    let result: { before: UserProfile; after: UserProfile } | null = null;
    await (db as any).transaction('rw', db.userProfile, async () => {
      const before = await db.userProfile.get(1);
      if (!before) return;
      const after: UserProfile = { ...change(before), profileLastUpdated: new Date().toISOString() };
      await db.userProfile.put(after);
      result = { before, after };
    });
    if (result) setUserProfile((result as { after: UserProfile }).after);
    return result;
  };

  const awardXP = async (points: number, message?: string) => {
    const result = await updateProfile(p => {
      const xp = (p.xp || 0) + points;
      return { ...p, xp, level: calculateLevel(xp).level };
    });
    if (!result) return;
    if (result.after.level > result.before.level) {
        showToast(`Level Up! You reached Level ${result.after.level}! 🎉`);
    } else if (message) {
        showToast(message);
    }
    handleCheckAchievements();
  };

  const handleGoalUpdate = async (type: 'STUDY' | 'QUIZ' | 'STREAK', value: number, isXpOverride = false) => {
    if (isXpOverride) {
        await awardXP(value);
        return;
    }
    // A new day starts a new goal, even when the app stayed open past midnight.
    const stored = await db.userProfile.get(1);
    if (stored) await checkAndRefreshDailyGoals(stored, streak);

    let progress: ReturnType<typeof updateGoalProgress> | null = null;
    const result = await updateProfile(p => {
      if (!p.dailyGoals) return p;
      progress = updateGoalProgress(type, value, p);
      return progress.updatedProfile;
    });
    if (!result || !progress) return;
    const { xpGained, newlyCompletedGoals } = progress as ReturnType<typeof updateGoalProgress>;

    if (xpGained > 0) await awardXP(xpGained);

    newlyCompletedGoals.forEach(goal => {
        setTimeout(() => showToast(`Goal Complete: ${goal.description} (+${goal.xp} XP)`), 500);
    });

    if (result.after.dailyGoals?.allCompleteAwarded && !result.before.dailyGoals?.allCompleteAwarded) {
        setTimeout(() => showToast(`All goals complete! Bonus +50 XP! ✨`), newlyCompletedGoals.length > 0 ? 1000 : 500);
    }
  };

  // Once a day, after the first reviews of the day: a bonus for keeping the
  // streak going (2 days or more).
  const checkStreakBonus = async () => {
      const today = dayString(new Date());
      const profile = await db.userProfile.get(1);
      if (!profile || profile.lastStreakCheck === today) return;
      const logs = await db.studyHistory.toArray();
      if (!logs.some(l => l.date === today)) return;
      const newStreak = calculateStreak(logs, profile.frozenDates);
      await updateProfile(p => ({ ...p, lastStreakCheck: today }));
      if (newStreak >= 2) await awardXP(newStreak * 10, `Streak Bonus: ${newStreak} days! 🔥`);
      await handleGoalUpdate('STREAK', newStreak);
  };

  // Take settings changed on another device, keeping this device's AI key.
  const adoptCloudSettings = (incoming?: Partial<Settings>) => {
    const merged = applyIncomingSettings(readSavedSettings(), incoming);
    if (!merged) return;
    localStorage.setItem('appSettings', JSON.stringify(merged));
    setSettings({ ...defaultSettings, ...merged } as Settings);
  };

  const handleSync = async () => {
    if (!signedInUser.current) return;
    await mergeWithCloud();
  };

  // Remember what the data looked like after a sync, so the automatic sync
  // knows nothing changed since.
  const rememberSynced = (fresh: Awaited<ReturnType<typeof fetchData>>) => {
    lastSyncedFingerprint.current = syncFingerprint({
      cards: fresh.cards, decks: fresh.decks, texts: fresh.texts, profile: fresh.profile,
      achievements: fresh.achievements, settingsUpdatedAt: readSavedSettings().updatedAt,
    });
  };

  // Send everything in this browser to the account and take back the merged
  // result. Nothing local is dropped: the server merges, it never replaces.
  // Rows edited here while the request was in flight keep their local version
  // and go out with the next sync.
  const mergeWithCloud = async () => {
    if (syncInFlight.current) { syncAgain.current = true; return; }
    syncInFlight.current = true;
    setSyncStatus('syncing');
    try {
        const allCards = await db.flashcards.toArray();
        const allDecks = await db.decks.toArray();
        const allStudyHistory = await db.studyHistory.toArray();
        const profile = await db.userProfile.get(1);
        const allAchievements = await db.userAchievements.toArray();
        const allTexts = await db.texts.toArray();
        const sent = {
            cards: stampMap(allCards, cardStamp),
            decks: stampMap(allDecks, deckStamp),
            texts: stampMap(allTexts, cardStamp),
            profile: profileStamp(profile),
        };

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
        let skipped = 0;
        if (mergedData) {
            await (db as any).transaction('rw', [db.decks, db.flashcards, db.studyHistory, db.userProfile, db.userAchievements, db.texts], async () => {
                const decks = applicableRows<Deck>(mergedData.decks, sent.decks, stampMap(await db.decks.toArray(), deckStamp));
                const cards = applicableRows<Flashcard>(mergedData.cards, sent.cards, stampMap(await db.flashcards.toArray(), cardStamp));
                const textRows = applicableRows<TextDoc>(mergedData.texts, sent.texts, stampMap(await db.texts.toArray(), cardStamp));
                skipped = decks.skipped + cards.skipped + textRows.skipped;
                if (decks.rows.length) await db.decks.bulkPut(decks.rows);
                if (cards.rows.length) await db.flashcards.bulkPut(cards.rows);
                if (textRows.rows.length) await db.texts.bulkPut(textRows.rows);
                const logs = newStudyLogs(await db.studyHistory.toArray(), mergedData.studyHistory);
                if (logs.length) await db.studyHistory.bulkAdd(logs);
                if (mergedData.userProfile) {
                    if (profileStamp(await db.userProfile.get(1)) === sent.profile) await db.userProfile.put(mergedData.userProfile);
                    else skipped++;
                }
                if (mergedData.userAchievements) await db.userAchievements.bulkPut(mergedData.userAchievements);
            });
            adoptCloudSettings(mergedData.settings);
            const fresh = await fetchData();
            if (skipped === 0) rememberSynced(fresh);
            else lastSyncedFingerprint.current = null; // local edits still to send
        }
        lastSyncAt.current = Date.now();
        setSyncStatus('synced');
    } catch (error) {
        console.error('Sync failed:', error);
        setSyncStatus('error');
    } finally {
        syncInFlight.current = false;
        if (syncAgain.current) {
            syncAgain.current = false;
            setTimeout(() => handleSync(), 0);
        }
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
            if (studyHistory) await db.studyHistory.bulkAdd(newStudyLogs([], studyHistory));
            if (userProfile) await db.userProfile.put(userProfile);
            if (userAchievements) await db.userAchievements.bulkPut(userAchievements);
        });
        adoptCloudSettings(response.data.settings);
      }
      rememberSynced(await fetchData());
      lastSyncAt.current = Date.now();
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
        const startSignedIn = async (username: string) => {
            signIn(username);
            setIsLoggedIn(true);
            await (db as any).open();
            await fetchData();
        };
        try {
            const { username } = await callProxy('auth-session', {});
            if (username) await startSignedIn(username);
            else localStorage.removeItem(LAST_USER_KEY);
        } catch (e) {
            console.error('Could not check the session:', e);
            // No connection (common on a filtered or cut network): open this
            // browser's own cards; the next sync signs in or asks to.
            const lastUser = localStorage.getItem(LAST_USER_KEY);
            if (lastUser && e instanceof TypeError) {
                await startSignedIn(lastUser);
                setSyncStatus('error');
            }
        }
        setAppLoading(false);
    };

    checkSession();

    const onAuthRequired = () => {
        signedInUser.current = null;
        setIsLoggedIn(false);
        setCurrentUser(null);
        showToast('Your session has expired. Please sign in again.');
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);

    // Pick up changes made on another device when coming back to the app or
    // back online, at most once a minute.
    const syncWhenBack = () => {
        if (document.visibilityState !== 'visible' || !signedInUser.current) return;
        if (Date.now() - lastSyncAt.current < 60_000) return;
        handleSync();
    };
    document.addEventListener('visibilitychange', syncWhenBack);
    window.addEventListener('online', syncWhenBack);
    
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
    return () => {
        window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
        document.removeEventListener('visibilitychange', syncWhenBack);
        window.removeEventListener('online', syncWhenBack);
    };
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

    const fingerprint = syncFingerprint({
        cards: flashcards, decks, texts, profile: userProfile, achievements: earnedAchievements, settingsUpdatedAt: settings.updatedAt,
    });
    if (fingerprint === lastSyncedFingerprint.current) return;

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
      const newDeck: Deck = { id: crypto.randomUUID(), name: trimmedDeckName, updatedAt: new Date().toISOString() };
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
        id: crypto.randomUUID(),
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
        const newDeck: Deck = { id: crypto.randomUUID(), name: trimmedDeckName, updatedAt: new Date().toISOString() };
        await db.decks.add(newDeck);
        deck = newDeck;
    }

    const now = new Date().toISOString();
    const newCards: Flashcard[] = cardsToSave.map((cardData, index) => ({
        ...cardData,
        id: crypto.randomUUID(),
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
      const newDeck: Deck = { id: crypto.randomUUID(), name: trimmedDeckName, updatedAt: new Date().toISOString() };
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
    await checkStreakBonus();
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
        allDecks.filter(d => !d.isDeleted).forEach(d => deckNameMap.set(d.name.toLowerCase(), d));
        
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
                const newDeck: Deck = { id: crypto.randomUUID(), name: deckName, updatedAt: new Date().toISOString() };
                deckNameMap.set(lowerDeckName, newDeck);
                newDecks.push(newDeck);
                deck = newDeck;
            }

            const now = new Date().toISOString();
            const newCard: Flashcard = {
                id: crypto.randomUUID(),
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
        const skippedRows = parsedData.length - newCards.length;
        showToast(skippedRows > 0
            ? `${newCards.length} cards imported; ${skippedRows} row(s) skipped (no front or back).`
            : `${newCards.length} cards imported successfully!`);
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
    const deckId = deckIdOverride !== undefined ? deckIdOverride : studyDeckId;

    const visibleFlashcards = sourceCards.filter(c => !c.isDeleted);
    let cardsToStudy = deckId
      ? visibleFlashcards.filter(card => card.deckId === deckId)
      : visibleFlashcards;

    switch (options.filter) {
      case 'new': 
        cardsToStudy = cardsToStudy.filter(isNewCard);
        break;
      case 'review': 
        cardsToStudy = cardsToStudy.filter(c => !isNewCard(c) && isDue(c));
        break;
      case 'all-cards': 
        break;
      case 'all-due': 
      default: 
        cardsToStudy = cardsToStudy.filter(c => isDue(c));
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
    setStudySessionId(id => id + 1);
    setIsStudySetupModalOpen(false);
    setView('STUDY');
    return true;
  };

  // "Start review" on the Today screen: every due card, no setup dialog.
  const startQuickReview = (mode: StudyMode = 'flip', limit = 0, sourceCards: Flashcard[] = flashcards) => {
    setStudyMode(mode);
    const due = sourceCards.filter(c => !c.isDeleted && isDue(c));
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
      const result = await updateProfile(p => (availableFreezes(p.streakFreezesEarned, p.frozenDates) < MAX_HELD_FREEZES
        ? { ...p, streakFreezesEarned: (p.streakFreezesEarned || 0) + 1 }
        : p));
      if (result && result.after.streakFreezesEarned !== result.before.streakFreezesEarned) {
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
    const name = newName.trim();
    if (!name) return;
    const existingDeck = decks.find(d => !d.isDeleted && d.id !== deckId && d.name.trim().toLowerCase() === name.toLowerCase());
    if (existingDeck) {
        showToast('A deck with this name already exists.');
        return;
    }
    await db.decks.update(deckId, { name, updatedAt: new Date().toISOString() });
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
          await db.decks.update(deckId, { isDeleted: true, updatedAt: now });
      });
      await fetchData(); 
      showToast('Deck and its cards deleted successfully!');
    } catch (error) {
        console.error("Failed to delete deck:", error);
        showToast("Error: Could not delete the deck.");
    }
  };

  // Cards made before signing in (or with an older version that kept them
  // only in this browser) must survive signing in.
  const hasLocalData = async () => (await db.flashcards.count()) + (await db.texts.count()) > 0;

  const handleLogin = async (username: string, password: string) => {
      setAuthLoading(true);
      try {
          const res = await callProxy('auth-login', { username, password });
          const user = { username: res.username || username };
          signIn(user.username);
          if (await hasLocalData()) await mergeWithCloud();
          else await loadDataFromCloud(user.username);
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
          signIn(user.username);
          if (await hasLocalData()) await mergeWithCloud();
          else await fetchData();
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
        localStorage.removeItem(LAST_USER_KEY);
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
      syncStatus, studyDeckId, studyCards, studySessionId, isStudySetupModalOpen, studyMode, studyLogs, texts, activeTextId, activeChunk, dbStatus, apiStatus,
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