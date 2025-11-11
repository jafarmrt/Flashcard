// File: /api/proxy.ts
// This Vercel Serverless Function acts as a secure proxy and router.
// It handles requests for both the Google GenAI API and the new Cloud Sync feature.
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


// --- HANDLER FOR GEMINI API ---
async function handleGeminiGenerate(payload: any, response: VercelResponse, apiKey: string) {
  const { model, contents, config } = payload;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // Fix: Correctly structure the request body.
  // `responseMimeType` and `responseSchema` belong INSIDE generationConfig for the REST API.
  // Only extract top-level parameters that are NOT part of generationConfig.
  const {
    systemInstruction,
    responseModalities,
    speechConfig,
    ...generationConfig // The rest of the client's 'config' object is the generationConfig.
  } = config || {};


  // Normalize the `contents` to the `Content[]` format required by the API
  const finalContents = Array.isArray(contents)
    ? contents // Already in correct array format e.g., for TTS
    : (contents && typeof contents === 'object' && contents.parts)
      ? [contents] // An object with parts, wrap it in an array
      : [{ parts: [{ text: contents }] }]; // A simple string, wrap it fully

  // Build the request body, including optional fields only if they exist
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


// --- HANDLERS FOR SYNC FEATURE (using Vercel KV Store REST API) ---
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function handleSyncSave(payload: any, response: VercelResponse) {
  if (!KV_URL) return response.status(500).json({ error: 'KV_REST_API_URL is not configured on the server.' });
  if (!KV_TOKEN) return response.status(500).json({ error: 'KV_REST_API_TOKEN is not configured on the server.' });
  
  const { syncKey, data } = payload;
  if (!syncKey || !data) {
    return response.status(400).json({ error: 'Sync key and data are required.' });
  }

  const kvResponse = await fetch(`${KV_URL}/set/${syncKey}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KV_TOKEN}`,
    },
    body: JSON.stringify(data),
  });

  if (!kvResponse.ok) {
    const errorText = await kvResponse.text();
    return response.status(500).json({ error: 'Failed to save data.', details: errorText });
  }

  return response.status(200).json({ message: 'Data saved successfully.' });
}

async function handleSyncLoad(payload: any, response: VercelResponse) {
  if (!KV_URL) return response.status(500).json({ error: 'KV_REST_API_URL is not configured on the server.' });
  if (!KV_TOKEN) return response.status(500).json({ error: 'KV_REST_API_TOKEN is not configured on the server.' });

  const { syncKey } = payload;
  if (!syncKey) {
    return response.status(400).json({ error: 'Sync key is required.' });
  }

  const kvResponse = await fetch(`${KV_URL}/get/${syncKey}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${KV_TOKEN}`,
    },
  });

  if (!kvResponse.ok) {
    return response.status(500).json({ error: 'Failed to load data.' });
  }
  
  const { result } = await kvResponse.json();

  if (result) {
    // Vercel KV returns the JSON data as a string, so we need to parse it
    const data = JSON.parse(result);
    return response.status(200).json({ data });
  } else {
    // Key doesn't exist, which is a valid scenario
    return response.status(200).json({ data: null });
  }
}

async function handleSyncMerge(payload: any, response: VercelResponse) {
  if (!KV_URL || !KV_TOKEN) {
    return response.status(500).json({ error: 'KV Store is not configured on the server.' });
  }
  const { syncKey, data: clientData } = payload;
  if (!syncKey || !clientData) {
    return response.status(400).json({ error: 'Sync key and data are required.' });
  }

  // 1. Fetch current data from the cloud
  const getResponse = await fetch(`${KV_URL}/get/${syncKey}`, {
    headers: { 'Authorization': `Bearer ${KV_TOKEN}` },
  });

  let cloudData: SyncData = { decks: [], cards: [], studyHistory: [], userProfile: null, userAchievements: [] };
  if (getResponse.ok) {
    const { result } = await getResponse.json();
    if (result) {
      cloudData = JSON.parse(result);
    }
  }

  // 2. Perform a deletion-aware merge for decks and cards
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

  // 3. Merge all data types
  const mergedDecks = merge<Deck>(cloudData.decks, clientData.decks);
  const mergedCards = merge<Flashcard>(cloudData.cards, clientData.cards);

  // Merge Study History by creating a set to remove duplicates
  const studyHistoryMap = new Map<string, StudyLog>();
  (cloudData.studyHistory || []).forEach(log => studyHistoryMap.set(`${log.cardId}-${log.date}-${log.rating}`, log));
  (clientData.studyHistory || []).forEach(log => studyHistoryMap.set(`${log.cardId}-${log.date}-${log.rating}`, log));
  const mergedStudyHistory = Array.from(studyHistoryMap.values());

  // Merge User Profile: Use a timestamp to find the definitive source for name/bio.
  let mergedUserProfile: UserProfile | null = null;
  const cloudP = cloudData.userProfile;
  const clientP = clientData.userProfile;

  if (clientP && cloudP) {
      const clientTimestamp = new Date(clientP.profileLastUpdated || 0);
      const cloudTimestamp = new Date(cloudP.profileLastUpdated || 0);

      const newerProfile = clientTimestamp >= cloudTimestamp ? clientP : cloudP;

      mergedUserProfile = {
          id: clientP.id,
          // Always take the highest progress
          xp: Math.max(clientP.xp, cloudP.xp),
          level: Math.max(clientP.level, cloudP.level),
          lastStreakCheck: (new Date(clientP.lastStreakCheck || 0) > new Date(cloudP.lastStreakCheck || 0)) ? clientP.lastStreakCheck : cloudP.lastStreakCheck,
          // Take text fields from the profile that was updated more recently
          firstName: newerProfile.firstName,
          lastName: newerProfile.lastName,
          bio: newerProfile.bio,
          profileLastUpdated: newerProfile.profileLastUpdated
      };
  } else {
      mergedUserProfile = clientP || cloudP;
  }

  // Merge User Achievements by creating a set to remove duplicates
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

  // 4. Save the correctly merged data back to the cloud
  const setResponse = await fetch(`${KV_URL}/set/${syncKey}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(mergedData),
  });

  if (!setResponse.ok) {
    const errorText = await setResponse.text();
    return response.status(500).json({ error: 'Failed to save merged data.', details: errorText });
  }
  
  // 5. Return the authoritative merged data to the client
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
      case 'ping': // For Gemini API
        return response.status(200).json({ message: 'pong' });
      case 'ping-free-dict': // For Free Dictionary API
        const dictResponse = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/hello`);
        return response.status(dictResponse.ok ? 200 : 503).json({ message: dictResponse.ok ? 'pong' : 'api unreachable' });
      case 'ping-mw': // For Merriam-Webster API
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

      case 'sync-save':
        return await handleSyncSave(payload, response);

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