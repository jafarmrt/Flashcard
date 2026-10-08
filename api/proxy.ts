// File: /api/proxy.ts
// This Vercel Serverless Function acts as a secure proxy and router.
// It handles requests for user authentication, cloud sync, and external APIs.
import { Buffer } from 'buffer';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  PUBLIC_ACTIONS, USERNAME_PATTERN, MIN_PASSWORD_LENGTH, registrationAllowed,
  hashPassword, verifyPassword, getSessionSecret, createSessionToken, sessionUser,
  sessionCookieHeader, clearSessionCookieHeader, loginLockMinutes, recordLoginFailure,
  clearLoginFailures, isAllowedAudioUrl,
} from '../server/auth';

// --- TYPE DEFINITIONS (mirrored from client) ---
interface Deck {
  id: string;
  name: string;
  isDeleted?: boolean;
}
interface Flashcard {
  id: string;
  deckId: string;
  isDeleted?: boolean;
  updatedAt?: string; // Add timestamp for sync
  // Other properties are not needed for merge logic
}
interface StudyLog {
  id?: number;
  cardId: string;
  date: string;
  rating: 'AGAIN' | 'GOOD' | 'EASY';
}
interface DailyGoal {
  id: string;
  type: 'STUDY' | 'QUIZ' | 'STREAK';
  description: string;
  target: number;
  progress: number;
  xp: number;
  isComplete: boolean;
}
interface UserProfile {
  id: number;
  xp: number;
  level: number;
  lastStreakCheck: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  profileLastUpdated?: string;
  dailyGoals?: {
    date: string;
    goals: DailyGoal[];
    allCompleteAwarded: boolean;
  };
}
interface UserAchievement {
  achievementId: string;
  dateEarned: string;
}
interface SyncData {
  decks: Deck[];
  cards: Flashcard[];
  studyHistory: StudyLog[];
  userProfile: UserProfile | null;
  userAchievements: UserAchievement[];
}
// Data structure for a user in the KV store
interface UserData {
    username: string;
    password: string; // scrypt hash (see server/auth.ts); older accounts are rehashed on login
    data: SyncData;
}


// --- HANDLER FOR GEMINI API ---
async function handleGeminiGenerate(payload: any, response: VercelResponse, apiKey: string) {
  const { model, contents, config } = payload;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const {
    systemInstruction,
    responseModalities,
    speechConfig,
    ...generationConfig
  } = config || {};


  const finalContents = Array.isArray(contents)
    ? contents
    : (contents && typeof contents === 'object' && contents.parts)
      ? [contents]
      : [{ parts: [{ text: contents }] }];

  const googleApiBody: Record<string, any> = {
    contents: finalContents,
    ...(systemInstruction && { systemInstruction }),
    ...(responseModalities && { responseModalities }),
    ...(speechConfig && { speechConfig }),
    ...(Object.keys(generationConfig).length > 0 && { generationConfig }),
  };

  const geminiResponse = await fetch(`${endpoint}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(googleApiBody),
  });

  if (!geminiResponse.ok) {
    const errorText = await geminiResponse.text();
    console.error('Google API Error:', errorText);
    try {
      const errorJson = JSON.parse(errorText);
      return response.status(geminiResponse.status).json({ error: 'Google API Error', details: errorJson });
    } catch (e) {
      return response.status(geminiResponse.status).json({ error: 'Google API Error', details: errorText });
    }
  }

  const responseData = await geminiResponse.json();
  const adaptedResponse = {
    text: responseData.candidates?.[0]?.content?.parts?.[0]?.text || '',
    candidates: responseData.candidates,
  };

  return response.status(200).json(adaptedResponse);
}

// --- HANDLERS FOR DICTIONARY APIS ---
async function handleFreeDictionary(payload: any, res: VercelResponse) {
    const { word } = payload;
    if (!word) return res.status(400).json({ error: 'Word is required.' });
    const apiResponse = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    const data = await apiResponse.json();
    return res.status(apiResponse.status).json(data);
}

async function handleMerriamWebster(payload: any, res: VercelResponse, apiKey: string) {
    const { word } = payload;
    if (!word) return res.status(400).json({ error: 'Word is required.' });
    const apiResponse = await fetch(`https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${apiKey}`);
    const data = await apiResponse.json();
    return res.status(apiResponse.status).json(data);
}

async function handleFetchAudio(payload: any, res: VercelResponse) {
    const { url } = payload;
    if (!url) return res.status(400).json({ error: 'URL is required.' });
    if (typeof url !== 'string' || !isAllowedAudioUrl(url)) return res.status(400).json({ error: 'Audio URL is not from a known dictionary.' });

    try {
        const audioResponse = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!audioResponse.ok) {
            const errorText = await audioResponse.text();
            return res.status(audioResponse.status).json({ error: 'Failed to fetch audio from source.', details: errorText });
        }
        const contentType = audioResponse.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        // Cache for 1 day on Vercel's Edge Network to reduce bandwidth
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
        
        const arrayBuffer = await audioResponse.arrayBuffer();
        return res.status(200).send(Buffer.from(arrayBuffer));

    } catch (error) {
        return res.status(500).json({ error: 'Internal server error while fetching audio.', details: (error as Error).message });
    }
}


// --- HANDLERS FOR AUTH & SYNC (using Vercel KV Store REST API) ---
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const getUserKey = (username: string) => `user:${username.toLowerCase()}`;

// Helper to get user data from KV
async function getUser(username: string): Promise<UserData | null> {
    if (!KV_URL || !KV_TOKEN) throw new Error("KV store not configured.");
    const key = getUserKey(username);
    const kvResponse = await fetch(`${KV_URL}/get/${key}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${KV_TOKEN}` },
    });
    if (!kvResponse.ok) throw new Error("Failed to fetch user data.");
    const { result } = await kvResponse.json();
    return result ? JSON.parse(result) : null;
}

// Helper to set user data in KV
async function setUser(userData: UserData): Promise<void> {
    if (!KV_URL || !KV_TOKEN) throw new Error("KV store not configured.");
    const key = getUserKey(userData.username);
    const kvResponse = await fetch(`${KV_URL}/set/${key}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${KV_TOKEN}` },
        body: JSON.stringify(userData),
    });
    if (!kvResponse.ok) {
        const errorText = await kvResponse.text();
        throw new Error(`Failed to save user data. Details: ${errorText}`);
    }
}

// Vercel serves over HTTPS, so session cookies are always marked Secure.
const SECURE = true;

async function handleRegister(payload: any, response: VercelResponse, secret: string) {
    const { username, password } = payload;
    if (!registrationAllowed()) return response.status(403).json({ error: 'Registration is closed on this server.' });
    if (typeof username !== 'string' || typeof password !== 'string') return response.status(400).json({ error: 'Username and password are required.' });
    if (!USERNAME_PATTERN.test(username)) return response.status(400).json({ error: 'Username must be 3-32 letters, digits, dots, dashes or underscores.' });
    if (password.length < MIN_PASSWORD_LENGTH) return response.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });

    const existingUser = await getUser(username);
    if (existingUser) {
        return response.status(409).json({ error: 'Username is already taken.' });
    }
    
    const newUser: UserData = {
        username,
        password: await hashPassword(password),
        data: {
            decks: [],
            cards: [],
            studyHistory: [],
            userProfile: null,
            userAchievements: [],
        }
    };
    
    await setUser(newUser);
    response.setHeader('Set-Cookie', sessionCookieHeader(createSessionToken(username, secret), SECURE));
    return response.status(201).json({ message: 'User registered successfully.', username: username.toLowerCase() });
}

async function handleLogin(payload: any, request: VercelRequest, response: VercelResponse, secret: string) {
    const { username, password } = payload;
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
        return response.status(400).json({ error: 'Username and password are required.' });
    }
    const forwarded = request.headers['x-forwarded-for'];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded || '').split(',')[0].trim() || 'unknown';
    const lockedMinutes = loginLockMinutes(ip, username);
    if (lockedMinutes > 0) {
        return response.status(429).json({ error: `Too many failed attempts. Try again in ${lockedMinutes} minute(s).` });
    }

    const user = await getUser(username);
    const check = await verifyPassword(password, user?.password);
    if (!user || !check.ok) {
        recordLoginFailure(ip, username);
        return response.status(401).json({ error: 'Invalid username or password.' });
    }
    clearLoginFailures(ip, username);
    if (check.needsRehash) {
        user.password = await hashPassword(password); // replace a legacy plain-text password
        await setUser(user);
    }

    response.setHeader('Set-Cookie', sessionCookieHeader(createSessionToken(username, secret), SECURE));
    return response.status(200).json({ message: 'Login successful.', username: username.toLowerCase() });
}

async function handleSyncLoad(username: string, response: VercelResponse) {
  const user = await getUser(username);
  return response.status(200).json({ data: user ? user.data : null });
}

async function handleSyncMerge(username: string, payload: any, response: VercelResponse) {
  const { data: clientData } = payload;
  if (!clientData || typeof clientData !== 'object') return response.status(400).json({ error: 'Data is required.' });

  const user = await getUser(username);
  if (!user) return response.status(401).json({ error: 'Please sign in again.', code: 'AUTH_REQUIRED' });

  const cloudData = user.data || { decks: [], cards: [], studyHistory: [], userProfile: null, userAchievements: [] };

  const mergeDecks = (cloudItems: Deck[], clientItems: Deck[]): Deck[] => {
    // Simple merge: client wins, but deletion is preserved.
    const mergedMap = new Map<string, Deck>();
    (cloudItems || []).forEach(item => mergedMap.set(item.id, item));
    (clientItems || []).forEach(clientItem => {
      const cloudItem = mergedMap.get(clientItem.id);
      if (cloudItem) {
        const isDeleted = cloudItem.isDeleted || clientItem.isDeleted;
        mergedMap.set(clientItem.id, { ...clientItem, isDeleted });
      } else {
        mergedMap.set(clientItem.id, clientItem);
      }
    });
    return Array.from(mergedMap.values());
  };

  const mergeFlashcards = (cloudItems: Flashcard[], clientItems: Flashcard[]): Flashcard[] => {
    const mergedMap = new Map<string, Flashcard>();
    (cloudItems || []).forEach(item => mergedMap.set(item.id, item));
    (clientItems || []).forEach(clientItem => {
      const cloudItem = mergedMap.get(clientItem.id);
      if (cloudItem) {
        const clientTimestamp = new Date(clientItem.updatedAt || 0).getTime();
        const cloudTimestamp = new Date(cloudItem.updatedAt || 0).getTime();
        
        // The one with the later timestamp wins
        const winner = clientTimestamp >= cloudTimestamp ? clientItem : cloudItem;
        
        // Ensure deletion is always preserved from either side
        winner.isDeleted = clientItem.isDeleted || cloudItem.isDeleted;
        mergedMap.set(clientItem.id, winner);
      } else {
        // It's a new item from the client
        mergedMap.set(clientItem.id, clientItem);
      }
    });
    return Array.from(mergedMap.values());
  };

  const mergedDecks = mergeDecks(cloudData.decks, clientData.decks);
  const mergedCards = mergeFlashcards(cloudData.cards, clientData.cards);

  const studyHistoryMap = new Map<string, StudyLog>();
  (cloudData.studyHistory || []).forEach(log => studyHistoryMap.set(`${log.cardId}-${log.date}-${log.rating}`, log));
  (clientData.studyHistory || []).forEach(log => studyHistoryMap.set(`${log.cardId}-${log.date}-${log.rating}`, log));
  const mergedStudyHistory = Array.from(studyHistoryMap.values());

  let mergedUserProfile: UserProfile | null = null;
  const cloudP = cloudData.userProfile;
  const clientP = clientData.userProfile;
  if (clientP && cloudP) {
      const clientTimestamp = new Date(clientP.profileLastUpdated || 0);
      const cloudTimestamp = new Date(cloudP.profileLastUpdated || 0);
      const newerProfile = clientTimestamp >= cloudTimestamp ? clientP : cloudP;
      
      let mergedDailyGoals;
      const clientGoals = clientP.dailyGoals;
      const cloudGoals = cloudP.dailyGoals;

      if (clientGoals && cloudGoals) {
          if (clientGoals.date > cloudGoals.date) {
              mergedDailyGoals = clientGoals;
          } else if (cloudGoals.date > clientGoals.date) {
              mergedDailyGoals = cloudGoals;
          } else { // Same date, merge progress
              const mergedGoalsMap = new Map<string, DailyGoal>();
              (cloudGoals.goals || []).forEach(g => mergedGoalsMap.set(g.id, { ...g }));
              (clientGoals.goals || []).forEach(cg => {
                  const existingGoal = mergedGoalsMap.get(cg.id);
                  if (existingGoal) {
                      if (cg.progress > existingGoal.progress) {
                          existingGoal.progress = cg.progress;
                          existingGoal.isComplete = cg.isComplete;
                      }
                  } else {
                      mergedGoalsMap.set(cg.id, { ...cg });
                  }
              });
              const finalGoals = Array.from(mergedGoalsMap.values());
              mergedDailyGoals = {
                  date: clientGoals.date,
                  goals: finalGoals,
                  allCompleteAwarded: clientGoals.allCompleteAwarded || cloudGoals.allCompleteAwarded,
              };
          }
      } else {
          mergedDailyGoals = clientGoals || cloudGoals;
      }

      mergedUserProfile = {
          id: clientP.id,
          xp: Math.max(clientP.xp, cloudP.xp),
          level: Math.max(clientP.level, cloudP.level),
          lastStreakCheck: (new Date(clientP.lastStreakCheck || 0) > new Date(cloudP.lastStreakCheck || 0)) ? clientP.lastStreakCheck : cloudP.lastStreakCheck,
          firstName: newerProfile.firstName,
          lastName: newerProfile.lastName,
          bio: newerProfile.bio,
          profileLastUpdated: newerProfile.profileLastUpdated,
          dailyGoals: mergedDailyGoals || undefined,
      };
  } else {
      mergedUserProfile = clientP || cloudP;
  }

  const achievementsMap = new Map<string, UserAchievement>();
  (cloudData.userAchievements || []).forEach(ach => achievementsMap.set(ach.achievementId, ach));
  (clientData.userAchievements || []).forEach(ach => achievementsMap.set(ach.achievementId, ach));
  const mergedUserAchievements = Array.from(achievementsMap.values());

  const mergedData: SyncData = {
    decks: mergedDecks,
    cards: mergedCards,
    studyHistory: mergedStudyHistory,
    userProfile: mergedUserProfile,
    userAchievements: mergedUserAchievements,
  };

  user.data = mergedData;
  await setUser(user);
  
  return response.status(200).json({ data: mergedData });
}


// --- MAIN HANDLER ---
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    return response.status(405).json({ message: 'Method Not Allowed' });
  }

  const { action, ...payload } = request.body || {};

  try {
    // Vercel's filesystem is read-only, so SESSION_SECRET must be set there.
    const needsSecret = !['ping', 'ping-free-dict', 'ping-mw'].includes(action);
    const secret = needsSecret ? getSessionSecret() : '';
    const signedInUser = needsSecret ? sessionUser(request.headers.cookie, secret) : null;
    if (!PUBLIC_ACTIONS.has(action) && !signedInUser) {
      return response.status(401).json({ error: 'Please sign in again.', code: 'AUTH_REQUIRED' });
    }

    switch (action) {
      case 'ping':
        return response.status(200).json({ message: 'pong' });
      case 'ping-free-dict':
        const dictResponse = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/hello`);
        return response.status(dictResponse.ok ? 200 : 503).json({ message: dictResponse.ok ? 'pong' : 'api unreachable' });
      case 'ping-mw':
        const mwApiKeyPing = process.env.MW_API_KEY;
        if (!mwApiKeyPing) return response.status(500).json({ error: 'Merriam-Webster API key not configured.' });
        const mwResponse = await fetch(`https://www.dictionaryapi.com/api/v3/references/collegiate/json/test?key=${mwApiKeyPing}`);
        return response.status(mwResponse.ok ? 200 : 503).json({ message: mwResponse.ok ? 'pong' : 'api unreachable' });

      case 'gemini-generate':
        const apiKey = process.env.API_KEY;
        if (!apiKey) return response.status(500).json({ error: 'API key not configured.' });
        return await handleGeminiGenerate(payload, response, apiKey);

      case 'dictionary-free':
        return await handleFreeDictionary(payload, response);
      
      case 'dictionary-mw':
        const mwApiKey = process.env.MW_API_KEY;
        if (!mwApiKey) return response.status(500).json({ error: 'Merriam-Webster API key not configured.' });
        return await handleMerriamWebster(payload, response, mwApiKey);
      
      case 'fetch-audio':
        return await handleFetchAudio(payload, response);

      case 'auth-register':
        return await handleRegister(payload, response, secret);
      
      case 'auth-login':
        return await handleLogin(payload, request, response, secret);

      case 'auth-session':
        if (!signedInUser || !(await getUser(signedInUser))) return response.status(200).json({ username: null });
        return response.status(200).json({ username: signedInUser });

      case 'auth-logout':
        response.setHeader('Set-Cookie', clearSessionCookieHeader(SECURE));
        return response.status(200).json({ message: 'Logged out.' });

      case 'sync-load':
        return await handleSyncLoad(signedInUser!, response);
        
      case 'sync-merge':
        return await handleSyncMerge(signedInUser!, payload, response);

      default:
        return response.status(400).json({ message: `Invalid or missing action.` });
    }
  } catch (error) {
    console.error(`Error in proxy action '${action}':`, error);
    response.status(500).json({ error: 'An internal server error occurred.', details: (error as Error).message });
  }
}