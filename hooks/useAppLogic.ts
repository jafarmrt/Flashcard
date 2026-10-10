import React, { useState, useEffect, useRef } from 'react';
import { Flashcard, Deck, Settings, StudySessionOptions, UserProfile, UserAchievement, ExtractedWordCard, StudyLog, Source, Chapter, ChapterText, Occurrence, KnownWord } from '../types';
import { db } from '../services/localDBService';
import { calculateLevel, calculateStreak, checkAndAwardAchievements } from '../services/gamificationService';
import { generateNewDailyGoals, updateGoalProgress, reviewGoalId } from '../services/dailyGoalsService';
import { availableFreezes, dayString, daysToFreeze, MAX_HELD_FREEZES } from '../services/streakService';
import { DEFAULT_DAILY_REVIEW_GOAL, isChestSection, SECTION_GOAL_REVIEWS } from '../services/xpRules';
import { buildSource, cardIndex, cardsInText, chaptersOf, findCard, markChunkDone, migrateTexts, newOccurrence, sectionReward, SourceInput } from '../services/library';
import { cardsOfSource, pickBookReview } from '../services/readingStats';
import { normalizeTerm } from '../services/vocabMerge';
import { forgetRows, newKnownWord } from '../services/knownWords';
import { ALL_ACHIEVEMENTS } from '../services/achievements';
import { aiRequestOptions } from '../services/aiSettings';
import { AUTH_REQUIRED_EVENT, callProxy } from '../services/apiService';
import { applicableRows, cardStamp, deckStamp, newStudyLogs, profileStamp, stampMap, syncFingerprint } from '../services/syncState';
import {
  confirmReceived, confirmSent, freshSyncState, isEmptyOutgoing, LocalData, markAllSynced, nextLogCursor, nextOutgoing,
  SyncState, SYNC_TABLES, SyncTable, usableSyncState, withLocalAudio,
} from '../services/syncClient';
import { isDue, isNewCard } from '../services/srsService';
import { applyIncomingSettings, toSyncedSettings } from '../services/settingsSync';
import { applyServerKeys, localKeyEntries, stampKeyChanges } from '../services/keySync';
import { convertToCSV, downloadCSV, parseCollocations, parseCSV, parseKind, splitList } from '../services/csvService';
import { freeEnrich, FreeEnrichment } from '../services/freeExtractionService';
import { 
  generatePersianDetails, parseLevel,
} from '../services/geminiService';
import { applyDictionarySettings } from '../services/dictSettings';
import { DictionaryResult, lookupDictionary } from '../services/dictionaryService';
import { AutoFixStats } from '../components/AutoFixReportModal';
import { fa } from '../components/common/ui';

// Types used within the hook and exported for the App component
export type View = 'TODAY' | 'ME' | 'TEXTS' | 'READER' | 'LIST' | 'FORM' | 'STUDY' | 'STATS' | 'PRACTICE' | 'SETTINGS' | 'DECKS' | 'CHANGELOG' | 'BULK_ADD' | 'ACHIEVEMENTS' | 'PROFILE' | 'AI_EXTRACT' | 'USAGE';
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

// A fetch that never reached the server (no connection, filtered network).
const isNetworkError = (error: unknown) => error instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
export type HealthStatus = 'ok' | 'error' | 'checking';
type FlashcardFormData = Omit<Flashcard, 'id' | 'repetition' | 'easinessFactor' | 'interval' | 'dueDate' | 'deckId' | 'isDeleted' | 'createdAt' | 'updatedAt'>;
type User = { username: string };

export type StudyMode = 'flip' | 'type' | 'cloze'; // cloze: the word left out of the book's sentence
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

// A short, readable reason for an error, e.g. "VersionError: ..." from the
// browser database or the server's own message.
const describeError = (e: unknown): string => {
  const err = e as { name?: string; message?: string; inner?: { name?: string; message?: string } };
  const inner = err?.inner?.message ? ` (${err.inner.name || 'Error'}: ${err.inner.message})` : '';
  const text = `${err?.name && err.name !== 'Error' ? `${err.name}: ` : ''}${err?.message || String(e)}${inner}`;
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
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
    bulkAddConcurrency: 3,
    bulkAddAiTimeout: 15,
    bulkAddDictTimeout: 5,
    dailyReviewGoal: DEFAULT_DAILY_REVIEW_GOAL,
};

// A new card from an extracted or looked-up term.
const cardFromExtracted = (cardData: ExtractedWordCard, deckId: string, now: Date): Flashcard => {
  const at = now.toISOString();
  return {
    id: crypto.randomUUID(),
    deckId,
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
    ...(cardData.grammarId ? { grammarId: cardData.grammarId } : {}),
    ...(cardData.level ? { level: cardData.level } : {}),
    ...(cardData.notInDictionary ? { notInDictionary: true } : {}),
    ...(cardData.origin ? { origin: cardData.origin } : {}),
    repetition: 0,
    easinessFactor: 2.5,
    interval: 0,
    createdAt: at,
    updatedAt: at,
    dueDate: at,
  };
};

export const useAppLogic = () => {
  // App State
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [view, setView] = useState<View>('TODAY');
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  // A card edited on top of the current screen (see openCardEditor)
  const [overlayEdit, setOverlayEdit] = useState<{ card: Flashcard; onDone?: (saved: Flashcard | null) => void } | null>(null);
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
  // The book a review was started from: its sentences come first in gaps.
  const [studySourceId, setStudySourceId] = useState<string | null>(null);
  const [studyLogs, setStudyLogs] = useState<StudyLog[]>([]);

  // Library State
  const [sources, setSources] = useState<Source[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [knownWords, setKnownWords] = useState<KnownWord[]>([]);
  // A section just finished: its cards, offered for a short review.
  const [sectionReview, setSectionReview] = useState<{ sourceId: string; chapterId: string; chunk: number; cardIds: string[] } | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
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
  // Every dictionary lookup, wherever it starts, uses the current choice.
  // Set during render (cheap, and in place before any effect or tap uses it).
  applyDictionarySettings(settings);
  
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
  // Where a study session goes back to when it ends.
  const sessionReturn = useRef<View>('TODAY');

  const lastSyncError = useRef('');

  const signIn = (username: string) => {
    signedInUser.current = username;
    setCurrentUser({ username });
    localStorage.setItem(LAST_USER_KEY, username);
  };

  // Toasts take turns, so one never hides another (a level-up arrives with
  // "chapter finished", a finished goal right after). One that others are
  // waiting for stays only long enough to be read, so an answer to a tap is
  // not held back.
  const TOAST_MS = 3000;
  const TOAST_MIN_MS = 1500;
  const toastQueue = useRef<string[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastShownAt = useRef(0);
  const nextToast = () => {
    const message = toastQueue.current.shift();
    setToastMessage(message ?? null);
    toastShownAt.current = Date.now();
    toastTimer.current = message === undefined ? null : setTimeout(nextToast, toastQueue.current.length ? TOAST_MIN_MS : TOAST_MS);
  };
  const showToast = (message: string) => {
    const queue = toastQueue.current;
    if (queue[queue.length - 1] === message) return;
    if (queue.length >= 3) queue.shift();
    queue.push(message);
    if (!toastTimer.current) {
      nextToast();
      return;
    }
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(nextToast, Math.max(0, TOAST_MIN_MS - (Date.now() - toastShownAt.current)));
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

  // Texts from before the library become one-chapter sources, once. Rows the
  // account already sent (the server moves the same texts the same way) are
  // left as they are; the old texts stay in their table as a backup.
  const migrateOldTexts = async () => {
    if (await db.meta.get('textsMigrated')) return;
    await (db as any).transaction('rw', [db.texts, db.decks, db.flashcards, db.sources, db.chapters, db.chapterTexts, db.occurrences, db.meta], async () => {
      if (await db.meta.get('textsMigrated')) return;
      const texts = await db.texts.toArray();
      if (texts.length > 0) {
        const moved = migrateTexts(texts, await db.decks.toArray(), await db.flashcards.toArray());
        const addMissing = async <T extends { id: string }>(table: any, rows: T[]) => {
          const have = new Set(((await table.bulkGet(rows.map(r => r.id))) as (T | undefined)[]).filter(Boolean).map(r => r!.id));
          const fresh = rows.filter(r => !have.has(r.id));
          if (fresh.length) await table.bulkPut(fresh);
        };
        await addMissing(db.sources, moved.sources);
        await addMissing(db.chapters, moved.chapters);
        await addMissing(db.chapterTexts, moved.chapterTexts.map(t => ({ ...t, uploaded: false })));
        await addMissing(db.occurrences, moved.occurrences);
      }
      await db.meta.put({ key: 'textsMigrated', value: new Date().toISOString() });
    });
  };

  const fetchData = async () => {
    try {
      await migrateOldTexts();
    } catch (error) {
      console.error('Moving old texts into the library failed:', error);
    }
    const allCards = await db.flashcards.toArray();
    const allDecks = await db.decks.toArray();
    const allAchievements = await db.userAchievements.toArray();
    const allSources = await db.sources.toArray();
    const allChapters = await db.chapters.toArray();
    const allOccurrences = await db.occurrences.toArray();
    const allKnown = await db.knownWords.toArray();
    setSources(allSources);
    setChapters(allChapters);
    setOccurrences(allOccurrences);
    setKnownWords(allKnown);
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
    
    return {
      cards: allCards, decks: allDecks, sources: allSources, chapters: allChapters, occurrences: allOccurrences,
      knownWords: allKnown, logs: allLogs, profile, achievements: allAchievements,
    };
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
        sources: await db.sources.toArray(),
        chapters: await db.chapters.toArray(),
        occurrences: await db.occurrences.toArray(),
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
                  showToast(`نشان تازه: ${achievementData.name} ${achievementData.icon}`);
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
    if (message) showToast(message);
    if (result.after.level > result.before.level) showToast(`به سطح ${fa(result.after.level)} رسیدی! 🎉`);
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
        setTimeout(() => showToast(`هدف امروز کامل شد. +${fa(goal.xp)} امتیاز`), 500);
    });

    if (result.after.dailyGoals?.allCompleteAwarded && !result.before.dailyGoals?.allCompleteAwarded) {
        setTimeout(() => showToast(`همهٔ هدف‌های امروز کامل شد! +${fa(50)} امتیاز ✨`), newlyCompletedGoals.length > 0 ? 1000 : 500);
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
      if (newStreak >= 2) await awardXP(newStreak * 10, `جایزهٔ زنجیرهٔ ${fa(newStreak)} روزه: +${fa(newStreak * 10)} امتیاز 🔥`);
      await handleGoalUpdate('STREAK', newStreak);
  };

  // Take settings changed on another device; the keys come apart (syncKeys).
  const adoptCloudSettings = (incoming?: Partial<Settings>) => {
    const merged = applyIncomingSettings(readSavedSettings(), incoming);
    if (!merged) return;
    localStorage.setItem('appSettings', JSON.stringify(merged));
    setSettings({ ...defaultSettings, ...merged } as Settings);
  };

  // Send this device's AI and dictionary keys and take the account's, so a
  // key typed on one device works on all of them.
  const syncKeys = async () => {
    const response = await callProxy('keys-sync', { keys: localKeyEntries(readSavedSettings()) });
    const change = applyServerKeys(readSavedSettings(), response?.keys);
    if (!change) return;
    const merged = { ...readSavedSettings(), ...change };
    localStorage.setItem('appSettings', JSON.stringify(merged));
    setSettings(prev => ({ ...prev, ...change }));
  };

  const handleSync = async () => {
    if (!signedInUser.current) return;
    await mergeWithCloud();
  };

  // Remember what the data looked like after a sync, so the automatic sync
  // knows nothing changed since.
  const rememberSynced = (fresh: Awaited<ReturnType<typeof fetchData>>) => {
    lastSyncedFingerprint.current = syncFingerprint({
      cards: fresh.cards, decks: fresh.decks, sources: fresh.sources, chapters: fresh.chapters, occurrences: fresh.occurrences,
      knownWords: fresh.knownWords, profile: fresh.profile, achievements: fresh.achievements, settingsUpdatedAt: readSavedSettings().updatedAt,
    });
  };

  const readLocal = async (): Promise<LocalData> => ({
    decks: await db.decks.toArray(),
    cards: await db.flashcards.toArray(),
    sources: await db.sources.toArray(),
    chapters: await db.chapters.toArray(),
    occurrences: await db.occurrences.toArray(),
    knownWords: await db.knownWords.toArray(),
    logs: await db.studyHistory.toArray(),
    profile: await db.userProfile.get(1),
    achievements: await db.userAchievements.toArray(),
    settings: toSyncedSettings(readSavedSettings()),
  });

  const SYNC_DB_TABLES: Record<SyncTable, any> = {
    decks: db.decks, cards: db.flashcards, sources: db.sources, chapters: db.chapters, occurrences: db.occurrences,
    knownWords: db.knownWords,
  };
  const stampOf = (table: SyncTable) => (table === 'decks' ? deckStamp : cardStamp) as (row: any) => string;

  // Chapter texts are uploaded once, apart from the sync, a few per sync.
  // A chapter the server refuses stays here and is tried again next time.
  const uploadChapterTexts = async () => {
    const pending = (await db.chapterTexts.toArray()).filter(t => !t.uploaded);
    if (pending.length === 0) return;
    const live = new Set((await db.chapters.toArray()).filter(c => !c.isDeleted).map(c => c.id));
    for (const text of pending.filter(t => live.has(t.id)).slice(0, 20)) {
      try {
        await callProxy('chapter-put', { id: text.id, sourceId: text.sourceId, chunks: text.chunks });
        await db.chapterTexts.update(text.id, { uploaded: true });
      } catch (error) {
        if (isNetworkError(error)) throw error;
        console.warn(`Uploading chapter ${text.id} failed:`, error);
      }
    }
  };

  // Send what changed here since the last sync and take what changed on
  // other devices, in rounds: each request carries a few hundred rows at
  // most, and a first download comes in pages. Rows edited here while a
  // request was out keep their local version and go with the next round.
  // `pullOnly` (a device signing in for the first time) takes the account as
  // it is.
  const mergeWithCloud = async (options: { pullOnly?: boolean } = {}) => {
    const user = signedInUser.current;
    if (!user) return;
    if (syncInFlight.current) { syncAgain.current = true; return; }
    syncInFlight.current = true;
    setSyncStatus('syncing');
    try {
        let state: SyncState = usableSyncState((await db.meta.get('sync'))?.value, user);
        if (options.pullOnly) state = markAllSynced(freshSyncState(user), await readLocal());
        await syncKeys();
        await uploadChapterTexts();

        let needPull = true;
        for (let round = 0; round < 40; round++) {
            const local = await readLocal();
            const out = nextOutgoing(local, state);
            if (isEmptyOutgoing(out) && !needPull) break;
            const before = Object.fromEntries(SYNC_TABLES.map(t => [t, stampMap(local[t] as any[], stampOf(t))])) as Record<SyncTable, Map<string, string>>;
            const profileBefore = profileStamp(local.profile);

            const response = await callProxy('sync', { since: state.rev, storeId: state.storeId, changes: out.changes });
            const changes = response.changes || {};
            state = response.reset ? { ...freshSyncState(user), storeId: response.storeId } : confirmSent(state, out);

            let maxBefore = 0;
            let maxAfter = 0;
            await (db as any).transaction('rw', [db.decks, db.flashcards, db.sources, db.chapters, db.occurrences, db.knownWords, db.studyHistory, db.userProfile, db.userAchievements], async () => {
                for (const table of SYNC_TABLES) {
                    const incoming = changes[table];
                    if (!Array.isArray(incoming) || incoming.length === 0) continue;
                    const current = await SYNC_DB_TABLES[table].toArray();
                    let { rows } = applicableRows<any>(incoming, before[table], stampMap(current, stampOf(table)));
                    if (table === 'cards') {
                        const byId = new Map<string, Flashcard>(current.map((c: Flashcard) => [c.id, c]));
                        rows = rows.map((c: Flashcard) => withLocalAudio(c, byId.get(c.id)));
                    }
                    if (rows.length) await SYNC_DB_TABLES[table].bulkPut(rows);
                    state = confirmReceived(state, table, rows);
                }
                const logs = await db.studyHistory.toArray();
                maxBefore = logs.reduce((m, l) => Math.max(m, l.id || 0), 0);
                const newLogs = newStudyLogs(logs, changes.studyHistory);
                if (newLogs.length) await db.studyHistory.bulkAdd(newLogs);
                maxAfter = newLogs.length ? (await db.studyHistory.toArray()).reduce((m, l) => Math.max(m, l.id || 0), 0) : maxBefore;
                if (changes.userProfile && profileStamp(await db.userProfile.get(1)) === profileBefore) {
                    await db.userProfile.put(changes.userProfile);
                    state = { ...state, profile: profileStamp(changes.userProfile) };
                }
                if (Array.isArray(changes.userAchievements) && changes.userAchievements.length) await db.userAchievements.bulkPut(changes.userAchievements);
            });
            if (changes.settings) {
                adoptCloudSettings(changes.settings);
                if (readSavedSettings().updatedAt === changes.settings.updatedAt) state = { ...state, settings: changes.settings.updatedAt };
            }
            state = {
                ...state,
                rev: response.rev,
                storeId: response.storeId,
                logCursor: response.reset ? 0 : nextLogCursor(state, out, maxBefore, maxAfter),
            };
            await db.meta.put({ key: 'sync', value: state });
            needPull = !!response.more || !!response.reset;
        }
        rememberSynced(await fetchData());
        lastSyncAt.current = Date.now();
        lastSyncError.current = '';
        setSyncStatus('synced');
    } catch (error) {
        console.error('Sync failed:', error);
        const offline = isNetworkError(error);
        setSyncStatus(offline ? 'offline' : 'error');
        // Say why, once per distinct reason, so a failure is never silent.
        const reason = describeError(error);
        if (!offline && reason !== lastSyncError.current) showToast(`همگام‌سازی ناموفق: ${reason}`);
        lastSyncError.current = offline ? '' : reason;
    } finally {
        syncInFlight.current = false;
        if (syncAgain.current) {
            syncAgain.current = false;
            setTimeout(() => handleSync(), 0);
        }
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
                setSyncStatus('offline');
            }
        }
        setAppLoading(false);
    };

    checkSession();

    const onAuthRequired = () => {
        signedInUser.current = null;
        setIsLoggedIn(false);
        setCurrentUser(null);
        showToast('نشست حسابت تمام شده؛ دوباره وارد شو.');
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
    (db as any).open().then(() => setDbStatus('ok')).catch((e: Error) => {
        console.error('Local database could not open:', e);
        setDbStatus('error');
        showToast(`پایگاه دادهٔ مرورگر باز نشد: ${describeError(e)}`);
    });
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
        cards: flashcards, decks, sources, chapters, occurrences, knownWords, profile: userProfile, achievements: earnedAchievements, settingsUpdatedAt: settings.updatedAt,
    });
    if (fingerprint === lastSyncedFingerprint.current) return;

    const handler = setTimeout(() => handleSync(), 2000);
    return () => clearTimeout(handler);
  }, [flashcards, decks, userProfile, earnedAchievements, sources, chapters, occurrences, knownWords, isLoggedIn, autoFixProgress, settings.updatedAt]);


  const updateSettings = (changes: Partial<Settings>) => {
      const newSettings = { ...changes, updatedAt: new Date().toISOString() };
      if (newSettings.dailyReviewGoal !== undefined) {
          // Save first so the goal refresh below already sees the new value.
          const saved = JSON.parse(localStorage.getItem('appSettings') || '{}');
          localStorage.setItem('appSettings', JSON.stringify({ ...saved, ...newSettings }));
          if (isLoggedIn) fetchData();
      }
      setSettings(prev => {
          const updated: Settings = { ...prev, ...newSettings };
          // A key typed or removed here is stamped, so it wins on the other devices.
          const keyStamps = stampKeyChanges(prev, updated);
          if (keyStamps) updated.keyStamps = keyStamps;
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
    showToast('کارت حذف شد.');
  };

  // The deck named in the card form, made when it does not exist yet.
  const deckForName = async (deckName: string): Promise<Deck> => {
    const trimmedDeckName = deckName.trim();
    const allDecks = await db.decks.toArray();
    const found = allDecks.find(d => d.name.toLowerCase() === trimmedDeckName.toLowerCase() && !d.isDeleted);
    if (found) return found;
    const newDeck: Deck = { id: crypto.randomUUID(), name: trimmedDeckName, updatedAt: new Date().toISOString() };
    await db.decks.add(newDeck);
    return newDeck;
  };

  // A card's new content over what the database holds now, so a review
  // answered while the form was open keeps its schedule.
  const saveCardEdits = async (card: Flashcard, cardData: FlashcardFormData, deckName: string): Promise<Flashcard | null> => {
    if (!deckName.trim()) {
      showToast('نام دسته خالی است.');
      return null;
    }
    const deck = await deckForName(deckName);
    const stored = (await db.flashcards.get(card.id)) || card;
    const now = new Date().toISOString();
    const updatedCard: Flashcard = {
      ...stored,
      ...cardData,
      deckId: deck.id,
      // A card the user corrected by hand is no longer flagged for review.
      ...((cardData.back || '').trim() ? { checkedAt: now } : {}),
      updatedAt: now,
    };
    await db.flashcards.put(updatedCard);
    showToast('کارت ذخیره شد.');
    return updatedCard;
  };

  const handleSaveCard = async (cardData: FlashcardFormData, deckName: string) => {
    if (!deckName.trim()) {
      showToast('نام دسته خالی است.');
      return;
    }
    if (editingCard) {
      if (!(await saveCardEdits(editingCard, cardData, deckName))) return;
    } else {
      const deck = await deckForName(deckName);
      const now = new Date().toISOString();
      const newCard: Flashcard = {
        ...cardData,
        origin: cardData.origin || { by: 'manual', at: now },
        id: crypto.randomUUID(),
        deckId: deck.id,
        repetition: 0,
        easinessFactor: 2.5,
        interval: 0,
        createdAt: now,
        updatedAt: now,
        dueDate: now,
      };
      await db.flashcards.add(newCard);
      showToast('کارت اضافه شد.');
    }
    await fetchData();
    handleCheckAchievements();
    setEditingCard(null);
    setView(previousViewRef.current);
  };

  // Editing a card on top of the current screen (a review, a book's check
  // list), so leaving the form returns to exactly where the user was.
  const openCardEditor = (card: Flashcard, onDone?: (saved: Flashcard | null) => void) => setOverlayEdit({ card, onDone });
  const closeCardEditor = () => {
    overlayEdit?.onDone?.(null);
    setOverlayEdit(null);
  };
  const saveOverlayEdit = async (cardData: FlashcardFormData, deckName: string) => {
    if (!overlayEdit) return;
    const saved = await saveCardEdits(overlayEdit.card, cardData, deckName);
    if (!saved) return;
    overlayEdit.onDone?.(saved);
    setOverlayEdit(null);
    await fetchData();
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
    showToast('نمایه ذخیره شد.');
  };
  
  const handleBulkSaveCards = async (cardsToSave: FlashcardFormData[], deckName: string) => {
    const trimmedDeckName = deckName.trim();
    if (!trimmedDeckName) {
        showToast('نام دسته خالی است.');
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
    showToast(`${fa(newCards.length)} کارت به «${trimmedDeckName}» اضافه شد.`);
    setView('DECKS');
  };

  const handleSaveExtractedCards = async (cardsToSave: ExtractedWordCard[], deckName: string, options: { stay?: boolean } = {}) => {
    const trimmedDeckName = deckName.trim();
    if (!trimmedDeckName) {
      showToast('نام دسته خالی است.');
      return;
    }

    const allDecks = await db.decks.toArray();
    let deck = allDecks.find(d => d.name.toLowerCase() === trimmedDeckName.toLowerCase() && !d.isDeleted);

    if (!deck) {
      const newDeck: Deck = { id: crypto.randomUUID(), name: trimmedDeckName, updatedAt: new Date().toISOString() };
      await db.decks.add(newDeck);
      deck = newDeck;
    }

    const now = new Date();
    const newCards: Flashcard[] = cardsToSave.map(cardData => cardFromExtracted(cardData, deck!.id, now));

    if (newCards.length > 0) {
      await db.flashcards.bulkAdd(newCards);
    }

    await fetchData();
    handleCheckAchievements();
    if (options.stay) {
      showToast(`${newCards.length} کارت به «${trimmedDeckName}» اضافه شد.`);
      return;
    }
    showToast(`${fa(newCards.length)} کارت به «${trimmedDeckName}» اضافه شد.`);
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
    setView(sessionReturn.current);
  };

  const handleExportCSV = () => {
    try {
      const cardsToExport = flashcards.filter(c => !c.isDeleted);
      if (cardsToExport.length === 0) {
        showToast('کارتی برای خروجی نیست.');
        return;
      }
      const date = new Date().toISOString().split('T')[0];
      downloadCSV(`lingua-cards-export-${date}.csv`, convertToCSV(cardsToExport, decks));
      showToast('همهٔ کارت‌ها در فایل CSV ذخیره شد.');
    } catch (error) {
        console.error('Export failed:', error);
        showToast('ساختن فایل خروجی ناموفق بود.');
    }
  };

  const handleImportCSV = async (csvText: string) => {
    if (!csvText) {
        showToast('فایل خالی است.');
        return;
    }
    try {
        const parsedData = parseCSV(csvText);
        if (parsedData.length === 0) {
            showToast('در فایل کارت درستی پیدا نشد.');
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
                definition: splitList(row.definition),
                exampleSentenceTarget: splitList(row.exampleSentenceTarget),
                notes: row.notes || '',
                kind: parseKind(row.kind),
                sourceSentence: row.sourceSentence || undefined,
                collocations: parseCollocations(row.collocations),
                grammarPattern: row.grammarPattern || undefined,
                practicePrompt: row.practicePrompt || undefined,
                ...(parseLevel(row.level) ? { level: parseLevel(row.level) } : {}),
                ...(row.grammarId?.trim() ? { grammarId: row.grammarId.trim() } : {}),
                origin: { by: 'import', at: now },
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
            ? `${fa(newCards.length)} کارت وارد شد؛ ${fa(skippedRows)} سطر بی‌واژه یا بی‌معنی کنار گذاشته شد.`
            : `${fa(newCards.length)} کارت وارد شد.`);
        setView('DECKS');

    } catch (error) {
        console.error("CSV Import failed:", error);
        showToast('خواندن فایل CSV ناموفق بود؛ قالب فایل را بررسی کن.');
    }
  };
  
  // Removes every card and deck from the account: each is marked deleted, so
  // the next sync takes the deletion to the server and to every device.
  const handleDeleteAllCards = async () => {
    const cardCount = await db.flashcards.filter(c => !c.isDeleted).count();
    if (!confirm(`همهٔ ${cardCount.toLocaleString('fa-IR')} کارت و همهٔ دسته‌ها از این حساب، روی سرور و همهٔ دستگاه‌ها پاک می‌شوند و برنمی‌گردند. کتاب‌ها و پیشرفت می‌مانند. ادامه می‌دهید؟`)) return;
    try {
      const now = new Date().toISOString();
      await (db as any).transaction('rw', db.flashcards, db.decks, async () => {
        await db.flashcards.filter(c => !c.isDeleted).modify({ isDeleted: true, updatedAt: now });
        await db.decks.filter(d => !d.isDeleted && d.id !== 'default').modify({ isDeleted: true, updatedAt: now });
      });
      await fetchData();
      showToast('همهٔ کارت‌ها پاک شد.');
      await handleSync();
    } catch (error) {
      console.error('Failed to delete all cards:', error);
      showToast(`پاک کردن کارت‌ها نشد: ${describeError(error)}`);
    }
  };

  const handleResetApp = async () => {
      if(confirm('همهٔ داده‌های همین مرورگر پاک می‌شود. آنچه روی سرور است در همگام‌سازی بعدی برمی‌گردد. ادامه می‌دهید؟')) {
          await (db as any).delete();
          localStorage.removeItem('appSettings');
          window.location.reload();
      }
  }

  const handleStudyDeck = (deckId: string) => {
    setStudyDeckId(deckId);
    setIsStudySetupModalOpen(true);
  };
  
  const handleStartStudySession = (options: StudySessionOptions, deckIdOverride?: string | null, sourceCards: Flashcard[] = flashcards, returnTo: View = 'TODAY') => {
    const deckId = deckIdOverride !== undefined ? deckIdOverride : studyDeckId;
    setStudySourceId(null);

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
        showToast('کارتی با این انتخاب پیدا نشد.');
        return false;
    }

    setStudyCards(cardsToStudy);
    setStudySessionId(id => id + 1);
    setIsStudySetupModalOpen(false);
    sessionReturn.current = returnTo;
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

  // --- Library ---

  // The deck named `name`, made when there is none.
  const deckNamed = async (name: string): Promise<Deck> => {
    const wanted = name.trim() || 'Reading';
    const found = (await db.decks.toArray()).find(d => !d.isDeleted && d.name.trim().toLowerCase() === wanted.toLowerCase());
    if (found) return found;
    const deck: Deck = { id: crypto.randomUUID(), name: wanted, updatedAt: new Date().toISOString() };
    await db.decks.add(deck);
    return deck;
  };

  // A book, article or text into the library; its words go to the deck of
  // its title.
  const handleAddSource = async (input: Omit<SourceInput, 'deckId'>): Promise<boolean> => {
    const built = buildSource({ ...input, deckId: '' });
    if (built.chapters.length === 0) {
      showToast('متن خالی است.');
      return false;
    }
    const deck = await deckNamed(built.source.title);
    const source = { ...built.source, deckId: deck.id };
    await (db as any).transaction('rw', [db.sources, db.chapters, db.chapterTexts], async () => {
      await db.sources.put(source);
      await db.chapters.bulkPut(built.chapters);
      await db.chapterTexts.bulkPut(built.texts.map(t => ({ ...t, uploaded: false })));
    });
    await fetchData();
    setActiveSourceId(source.id);
    setActiveChapterId(built.chapters.length === 1 ? built.chapters[0].id : null);
    setView('TEXTS');
    return true;
  };

  const handleOpenSource = (sourceId: string | null) => {
    setActiveSourceId(sourceId);
    const list = sourceId ? chaptersOf(sourceId, chapters) : [];
    setActiveChapterId(list.length === 1 ? list[0].id : null);
    setView('TEXTS');
  };

  const handleOpenChapter = (chapterId: string | null) => {
    setActiveChapterId(chapterId);
    setView('TEXTS');
  };

  // Opening a section remembers it as the place to continue from, on every device.
  const handleOpenChunk = async (chapter: Chapter, index: number) => {
    setSectionReview(null);
    setActiveSourceId(chapter.sourceId);
    setActiveChapterId(chapter.id);
    setActiveChunk(index);
    setView('READER');
    const source = await db.sources.get(chapter.sourceId);
    if (source && (source.position?.chapterId !== chapter.id || source.position?.chunk !== index)) {
      const updated: Source = { ...source, position: { chapterId: chapter.id, chunk: index }, updatedAt: new Date().toISOString() };
      await db.sources.put(updated);
      setSources(prev => prev.map(s => (s.id === updated.id ? updated : s)));
    }
  };

  // The source and its chapters leave the library; cards made from it stay.
  const handleDeleteSource = async (sourceId: string) => {
    const now = new Date().toISOString();
    await (db as any).transaction('rw', [db.sources, db.chapters, db.chapterTexts], async () => {
      await db.sources.update(sourceId, { isDeleted: true, updatedAt: now });
      const list = await db.chapters.where('sourceId').equals(sourceId).toArray();
      if (list.length) await db.chapters.bulkPut(list.map(c => ({ ...c, isDeleted: true, updatedAt: now })));
      await db.chapterTexts.where('sourceId').equals(sourceId).delete();
    });
    await fetchData();
    setActiveSourceId(null);
    setActiveChapterId(null);
  };

  // Finishing a section also notes the cards met in it again: a card with no
  // place in this book yet gets this sentence, so it shows in how many books
  // the word was seen.
  const handleCompleteChunk = async (chapterId: string, index: number) => {
    const chapter = await db.chapters.get(chapterId);
    if (!chapter) return;
    if (!markChunkDone(chapter, index).firstTime) {
      setView('TEXTS');
      return;
    }
    const offerReview = (placed: Occurrence[]) => {
      const live = new Set(placed.filter(o => !o.isDeleted && o.chapterId === chapterId && o.chunk === index).map(o => o.cardId));
      setSectionReview(live.size ? { sourceId: chapter.sourceId, chapterId, chunk: index, cardIds: Array.from(live) } : null);
    };
    const text = (await db.chapterTexts.get(chapterId))?.chunks[index] || '';
    const placed = new Set((await db.occurrences.where('sourceId').equals(chapter.sourceId).toArray()).filter(o => !o.isDeleted).map(o => o.cardId));
    const now = new Date();
    const seenAgain = cardsInText(text, (await db.flashcards.toArray()).filter(c => !placed.has(c.id)))
      .map(({ card, sentence }) => newOccurrence(card, chapter, index, sentence, now));
    // Marked done inside the write, from the stored chapter: a second tap on
    // "finish" while the first is saving must not award the section twice.
    const updated: Chapter | null = await (db as any).transaction('rw', [db.chapters, db.occurrences], async () => {
      const current = await db.chapters.get(chapterId);
      if (!current) return null;
      const done = markChunkDone(current, index);
      if (!done.firstTime) return null;
      await db.chapters.put(done.chapter);
      if (seenAgain.length) await db.occurrences.bulkPut(seenAgain);
      return done.chapter;
    });
    if (!updated) {
      setView('TEXTS');
      return;
    }
    setChapters(prev => prev.map(c => (c.id === updated.id ? updated : c)));
    if (seenAgain.length) setOccurrences(prev => [...prev.filter(o => !seenAgain.some(s => s.id === o.id)), ...seenAgain]);
    offerReview(await db.occurrences.where('chapterId').equals(chapterId).toArray());
    // The last section of a chapter, or of a book, earns a bonus on top.
    const { chapterDone, bookDone, xp } = sectionReward(updated, await db.sources.get(chapter.sourceId), await db.chapters.where('sourceId').equals(chapter.sourceId).toArray());
    const met = seenAgain.length ? `؛ ${fa(seenAgain.length)} واژهٔ کارت‌دار در این بخش دوباره دیده شد` : '';
    const message = bookDone
      ? `کتاب را تمام کردی! 🏁 +${fa(xp)} امتیاز`
      : chapterDone
        ? `فصل تمام شد! 📖 +${fa(xp)} امتیاز${met}`
        : `بخش ${fa(index + 1)} تمام شد. +${fa(xp)} امتیاز${met}`;
    await awardXP(xp, message);
    // Reading counts toward the daily goal.
    await handleGoalUpdate('STUDY', SECTION_GOAL_REVIEWS);
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

  // A chapter's text: from this browser, or from the server the first time
  // the chapter is opened on this device.
  const loadChapterText = async (chapterId: string): Promise<ChapterText> => {
    const local = await db.chapterTexts.get(chapterId);
    if (local) return local;
    const remote = await callProxy('chapter-get', { id: chapterId });
    const text: ChapterText = { id: remote.id, sourceId: remote.sourceId, chunks: remote.chunks, uploaded: true };
    await db.chapterTexts.put(text);
    return text;
  };

  // Cards picked while reading. A term that already has a card, in any deck
  // and in any form ("decided" for "decide"), gets this place added to it
  // instead of a second card.
  const handleSaveReaderCards = async (items: ExtractedWordCard[], chapterId: string, chunk: number, options: { quiet?: boolean } = {}) => {
    const chapter = await db.chapters.get(chapterId);
    let source = chapter ? await db.sources.get(chapter.sourceId) : undefined;
    if (!chapter || !source) throw new Error('This chapter is no longer in the library.');
    let deck = source.deckId ? await db.decks.get(source.deckId) : undefined;
    if (!deck || deck.isDeleted) {
      deck = await deckNamed(source.title);
      source = { ...source, deckId: deck.id, updatedAt: new Date().toISOString() };
      await db.sources.put(source);
    }
    const now = new Date();
    const index = cardIndex(await db.flashcards.toArray());
    const newCards: Flashcard[] = [];
    const places: Occurrence[] = [];
    let attached = 0;
    for (const item of items) {
      const existing = findCard(item.front, index);
      const card = existing || cardFromExtracted(item, deck.id, now);
      if (existing) attached++;
      else {
        newCards.push(card);
        index.set(normalizeTerm(card.front), card);
      }
      places.push(newOccurrence(card, chapter, chunk, item.sourceSentence, now));
    }
    const have = new Set(((await db.occurrences.bulkGet(places.map(p => p.id))) as (Occurrence | undefined)[]).filter(Boolean).map(o => o!.id));
    await (db as any).transaction('rw', [db.flashcards, db.occurrences], async () => {
      if (newCards.length) await db.flashcards.bulkAdd(newCards);
      const fresh = places.filter(p => !have.has(p.id));
      if (fresh.length) await db.occurrences.bulkPut(fresh);
    });
    await fetchData();
    handleCheckAchievements();
    if (!options.quiet) {
      const parts = [];
      if (newCards.length) parts.push(`${fa(newCards.length)} کارت تازه در «${deck.name}»`);
      if (attached) parts.push(`${fa(attached)} واژه که کارت داشت، این جمله را هم گرفت`);
      showToast(parts.join('؛ ') || 'چیزی برای ذخیره نبود.');
    }
    return { cardIds: places.map(p => p.cardId), added: newCards.length, attached };
  };

  // The "I know it" list: one tap and the term is never suggested again, in
  // any book, on any device.
  const handleMarkKnown = async (term: string) => {
    const key = normalizeTerm(term);
    if (!key) return;
    if ((await db.knownWords.where('term').equals(key).toArray()).some(r => !r.isDeleted)) return;
    const row = newKnownWord(key);
    await db.knownWords.put(row);
    setKnownWords(prev => [...prev, row]);
  };

  const handleUnmarkKnown = async (term: string) => {
    const gone = forgetRows(await db.knownWords.where('term').equals(normalizeTerm(term)).toArray(), term);
    if (gone.length === 0) return;
    await db.knownWords.bulkPut(gone);
    const byId = new Map(gone.map(r => [r.id, r]));
    setKnownWords(prev => prev.map(r => byId.get(r.id) || r));
  };

  // Cards the user looked at: confirmed as they are, or with a corrected
  // Persian meaning. Each is stamped checked, so it is not flagged again.
  const handleCheckCards = async (changes: { id: string; back?: string }[]) => {
    if (changes.length === 0) return;
    const now = new Date().toISOString();
    const found = await db.flashcards.bulkGet(changes.map(c => c.id));
    const updated: Flashcard[] = [];
    found.forEach((card, i) => {
      if (!card || card.isDeleted) return;
      const back = changes[i].back?.trim();
      updated.push({ ...card, ...(back ? { back } : {}), checkedAt: now, updatedAt: now });
    });
    if (updated.length === 0) return;
    await db.flashcards.bulkPut(updated);
    const byId = new Map(updated.map(c => [c.id, c]));
    setFlashcards(prev => prev.map(c => byId.get(c.id) || c));
  };

  // A short review of the cards of the section just finished, then back to
  // the book.
  const handleStartSectionReview = () => {
    if (!sectionReview) return;
    const ids = new Set(sectionReview.cardIds);
    setSectionReview(null);
    setStudyMode('flip');
    setStudyDeckId(null);
    handleStartStudySession({ filter: 'all-cards', limit: 0 }, null, flashcards.filter(c => ids.has(c.id)), 'TEXTS');
  };

  // Review the cards of one book or chapter: the due ones, or the weakest
  // when none is due. Back to the book afterwards.
  const handleStartSourceReview = (sourceId: string, chapterId?: string, mode: StudyMode = 'flip') => {
    const mine = cardsOfSource(occurrences, flashcards, sourceId, chapterId);
    if (mine.length === 0) {
      showToast(chapterId ? 'هنوز از این فصل کارتی نساخته‌ای.' : 'هنوز از این کتاب کارتی نساخته‌ای.');
      return;
    }
    const { cards: picked, due } = pickBookReview(mine);
    if (!due) showToast(`کارت موعدداری نمانده؛ ${fa(picked.length)} کارتِ ضعیف‌تر مرور می‌شود.`);
    setStudyMode(mode);
    setStudyDeckId(null);
    handleStartStudySession({ filter: 'all-cards', limit: 0 }, null, picked, 'TEXTS');
    setStudySourceId(sourceId);
  };

  // Any cards, by id (the hardest words on the stats page, say).
  const handleReviewCards = (ids: string[], returnTo: View = 'TODAY', mode: StudyMode = 'flip') => {
    const wanted = new Set(ids);
    setStudyMode(mode);
    setStudyDeckId(null);
    return handleStartStudySession({ filter: 'all-cards', limit: 0 }, null, flashcards.filter(c => wanted.has(c.id)), returnTo);
  };

  // A chapter's hard words, picked before reading it: saved as cards at the
  // section each was found in, then reviewed at once.
  const handlePrestudyChapter = async (chapterId: string, picks: { item: ExtractedWordCard; chunk: number }[]) => {
    if (picks.length === 0) return;
    const byChunk = new Map<number, ExtractedWordCard[]>();
    for (const { item, chunk } of picks) byChunk.set(chunk, [...(byChunk.get(chunk) || []), item]);
    const ids: string[] = [];
    let added = 0;
    for (const [chunk, items] of byChunk) {
      const result = await handleSaveReaderCards(items, chapterId, chunk, { quiet: true });
      ids.push(...result.cardIds);
      added += result.added;
    }
    const wanted = new Set(ids);
    const fresh = (await db.flashcards.bulkGet([...wanted])).filter((c): c is Flashcard => !!c && !c.isDeleted);
    showToast(added ? `${fa(added)} کارت تازه برای پیش‌مطالعه ساخته شد.` : 'این واژه‌ها کارت داشتند؛ مرورشان کن.');
    setStudyMode('flip');
    setStudyDeckId(null);
    handleStartStudySession({ filter: 'all-cards', limit: 0 }, null, fresh, 'TEXTS');
  };

  const handleNavigate = (newView: View) => {
    if (newView === 'STUDY') {
        setStudyDeckId(null);
        setIsStudySetupModalOpen(true);
    } else if (newView === 'LIST' && view !== 'LIST') {
        setView('DECKS');
    } else if (newView === 'TEXTS') {
        // The library tab opens the shelf.
        setActiveSourceId(null);
        setActiveChapterId(null);
        setView('TEXTS');
    } else {
        setView(newView);
    }
  }

  const handleRenameDeck = async (deckId: string, newName: string) => {
    const name = newName.trim();
    if (!name) return;
    const existingDeck = decks.find(d => !d.isDeleted && d.id !== deckId && d.name.trim().toLowerCase() === name.toLowerCase());
    if (existingDeck) {
        showToast('دسته‌ای با این نام هست.');
        return;
    }
    await db.decks.update(deckId, { name, updatedAt: new Date().toISOString() });
    await fetchData();
    showToast('نام دسته عوض شد.');
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
      showToast('دسته و کارت‌هایش حذف شد.');
    } catch (error) {
        console.error("Failed to delete deck:", error);
        showToast('حذف دسته ناموفق بود.');
    }
  };

  // Cards made before signing in (or with an older version that kept them
  // only in this browser) must survive signing in.
  const hasLocalData = async () => (await db.flashcards.count()) + (await db.sources.count()) + (await db.texts.count()) > 0;

  const handleLogin = async (username: string, password: string) => {
      setAuthLoading(true);
      try {
          const res = await callProxy('auth-login', { username, password });
          const user = { username: res.username || username };
          signIn(user.username);
          await mergeWithCloud({ pullOnly: !(await hasLocalData()) });
          setIsLoggedIn(true);
          showToast(`خوش برگشتی، ${username}!`);
      } catch(e) {
          showToast((e as Error).message || 'ورود ناموفق بود.');
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
          showToast(`حساب ساخته شد. خوش آمدی، ${username}!`);
      } catch (e) {
          showToast((e as Error).message || 'ساختن حساب ناموفق بود.');
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


  const handleCompleteCardDetails = async (cardId: string, options: { silent?: boolean } = {}): Promise<{
    success: boolean;
    updates: { audio: boolean; def: boolean; ex: boolean; pron: boolean; trans: boolean };
  }> => {
    const cardToComplete = await db.flashcards.get(cardId);
    const updates = { audio: false, def: false, ex: false, pron: false, trans: false };
    
    if (!cardToComplete) {
        if (!options.silent) showToast('کارت پیدا نشد.');
        return { success: false, updates };
    }

    try {
        // The user's dictionaries in order. Common expressions and a free
        // translation come too (no AI needed), but only when the card lacks
        // them: each one spends the small daily translation quota.
        const needsCollocations = cardToComplete.kind !== 'grammar' && !(cardToComplete.collocations && cardToComplete.collocations.length > 0);
        let enrichment: FreeEnrichment | null = null;
        let details: DictionaryResult = { headword: cardToComplete.front, pronunciation: '', partOfSpeech: '', definitions: [], exampleSentences: [] };
        if (cardToComplete.kind !== 'grammar') {
            if (needsCollocations || !cardToComplete.back) {
                enrichment = await freeEnrich(cardToComplete.front).catch(() => null);
                if (enrichment) details = { ...details, pronunciation: enrichment.pronunciation, partOfSpeech: enrichment.partOfSpeech, definitions: enrichment.definitions, exampleSentences: enrichment.examples, audioUrl: enrichment.audioUrl };
            } else {
                details = await lookupDictionary(cardToComplete.front).catch(() => details);
            }
        }

        let audioUrl: string | undefined = cardToComplete.audioSrc;
        if (details.audioUrl && !audioUrl) {
           audioUrl = details.audioUrl;
           updates.audio = true;
        }

        let persianDetails = { back: cardToComplete.back, notes: cardToComplete.notes };
        if (!cardToComplete.back || !cardToComplete.notes) {
             try {
                const ai = await generatePersianDetails(cardToComplete.front, aiRequestOptions(settings));
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

        if (!options.silent) showToast(`کارت «${cardToComplete.front}» کامل شد.`);
        return { success: true, updates };

    } catch (error) {
        console.error("Failed to complete card details:", error);
        if (!options.silent) showToast(`کامل کردن «${cardToComplete.front}» ناموفق بود.`);
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
        showToast('همهٔ کارت‌ها کامل‌اند.');
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
        showToast('کامل کردن خودکار متوقف شد.');
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
      syncStatus, studyDeckId, studyCards, studySessionId, isStudySetupModalOpen, studyMode, studySourceId, studyLogs, dbStatus, apiStatus,
      sources, chapters, occurrences, activeSourceId, activeChapterId, activeChunk, knownWords, sectionReview,
      freeDictApiStatus, mwDictApiStatus, settings, userProfile, streak, earnedAchievements,
      previousViewRef, autoFixProgress, autoFixReport,
      overlayEdit, openCardEditor, closeCardEditor, saveOverlayEdit,
      // Handlers
      setView, showToast, handleAddCard, handleEditCard, handleDeleteCard, handleSaveCard,
      handleSaveProfile, handleBulkSaveCards, handleSessionEnd, handleExportCSV, handleImportCSV,
      handleResetApp, handleDeleteAllCards, handleStudyDeck, handleStartStudySession, setIsStudySetupModalOpen,
      handleNavigate, handleRenameDeck, handleDeleteDeck, handleLogin, handleRegister, handleLogout,
      updateSettings, handleCheckAchievements, handleGoalUpdate, handleCompleteCardDetails,
      handleAutoFixCards, handleStopAutoFix, handleCloseAutoFixReport, handleSaveExtractedCards,
      startQuickReview, openStudySetup, setStudyMode, handleAddSource, handleOpenSource, handleOpenChapter, handleOpenChunk,
      handleDeleteSource, handleCompleteChunk, loadChapterText, handleSaveReaderCards,
      handleMarkKnown, handleUnmarkKnown, handleStartSectionReview, dismissSectionReview: () => setSectionReview(null),
      handleCheckCards, handleStartSourceReview, handleReviewCards, handlePrestudyChapter,
  };
};