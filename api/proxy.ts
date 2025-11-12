// File: /api/proxy.ts
// This Vercel Serverless Function acts as a secure proxy and router.
// It handles requests for user authentication, cloud sync, and external APIs.
import type { VercelRequest, VercelResponse } from '@vercel/node';

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
  // Other properties are not needed for merge logic
}
interface StudyLog {
  id?: number;
  cardId: string;
  date: string;
  rating: 'AGAIN' | 'GOOD' | 'EASY';
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
    password: string; // NOTE: In a real-world app, this MUST be a securely hashed password. Stored as plaintext here due to lack of crypto libraries in this environment.
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

async function handleRegister(payload: any, response: VercelResponse) {
    const { username, password } = payload;
    if (!username || !password) return response.status(400).json({ error: 'Username and password are required.' });
    if (username.length < 3) return response.status(400).json({ error: 'Username must be at least 3 characters.' });
    if (password.length < 6) return response.status(400).json({ error: 'Password must be at least 6 characters.' });

    const existingUser = await getUser(username);
    if (existingUser) {
        return response.status(409).json({ error: 'Username is already taken.' });
    }
    
    const newUser: UserData = {
        username,
        password, // WARNING: Storing plaintext password. In a real app, hash this with a library like bcrypt.
        data: {
            decks: [],
            cards: [],
            studyHistory: [],
            userProfile: null,
            userAchievements: [],
        }
    };
    
    await setUser(newUser);
    return response.status(201).json({ message: 'User registered successfully.' });
}

async function handleLogin(payload: any, response: VercelResponse) {
    const { username, password } = payload;
    if (!username || !password) return response.status(400).json({ error: 'Username and password are required.' });

    const user = await getUser(username);
    if (!user) {
        return response.status(404).json({ error: 'Invalid username or password.' });
    }
    
    // WARNING: Plaintext password comparison. In a real app, use a secure comparison function like bcrypt.compare.
    if (user.password !== password) {
        return response.status(401).json({ error: 'Invalid username or password.' });
    }

    return response.status(200).json({ message: 'Login successful.' });
}

async function handleSyncLoad(payload: any, response: VercelResponse) {
  const { username } = payload;
  if (!username) return response.status(400).json({ error: 'Username is required.' });

  const user = await getUser(username);

  if (user) {
    return response.status(200).json({ data: user.data });
  } else {
    // This case happens for new users loading for the first time
    return response.status(200).json({ data: null });
  }
}

async function handleSyncMerge(payload: any, response: VercelResponse) {
  const { username, data: clientData } = payload;
  if (!username || !clientData) return response.status(400).json({ error: 'Username and data are required.' });

  const user = await getUser(username);
  if (!user) return response.status(404).json({ error: 'User not found for sync.' });

  const cloudData = user.data || { decks: [], cards: [], studyHistory: [], userProfile: null, userAchievements: [] };

  const merge = <T extends { id: string; isDeleted?: boolean }>(cloudItems: T[], clientItems: T[]): T[] => {
    const mergedMap = new Map<string, T>();
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

  const mergedDecks = merge<Deck>(cloudData.decks, clientData.decks);
  const mergedCards = merge<Flashcard>(cloudData.cards, clientData.cards);

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
      mergedUserProfile = {
          id: clientP.id,
          xp: Math.max(clientP.xp, cloudP.xp),
          level: Math.max(clientP.level, cloudP.level),
          lastStreakCheck: (new Date(clientP.lastStreakCheck || 0) > new Date(cloudP.lastStreakCheck || 0)) ? clientP.lastStreakCheck : cloudP.lastStreakCheck,
          firstName: newerProfile.firstName,
          lastName: newerProfile.lastName,
          bio: newerProfile.bio,
          profileLastUpdated: newerProfile.profileLastUpdated
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

  const { action, ...payload } = request.body;

  try {
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

      case 'auth-register':
        return await handleRegister(payload, response);
      
      case 'auth-login':
        return await handleLogin(payload, response);

      case 'sync-load':
        return await handleSyncLoad(payload, response);
        
      case 'sync-merge':
        return await handleSyncMerge(payload, response);

      default:
        return response.status(400).json({ message: `Invalid or missing action.` });
    }
  } catch (error) {
    console.error(`Error in proxy action '${action}':`, error);
    response.status(500).json({ error: 'An internal server error occurred.', details: (error as Error).message });
  }
}