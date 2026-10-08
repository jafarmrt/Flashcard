import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { newerSettings } from './services/settingsSync';
import { fetchDictionaryEntries, freeEnrich, freeTranslate, lookupFrequencies } from './server/freeLookup';
import {
  PUBLIC_ACTIONS, USERNAME_PATTERN, MIN_PASSWORD_LENGTH, registrationAllowed,
  hashPassword, verifyPassword, getSessionSecret, createSessionToken, sessionUser,
  sessionCookieHeader, clearSessionCookieHeader, loginLockMinutes, recordLoginFailure,
  clearLoginFailures, isAllowedAudioUrl,
} from './server/auth';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// PORT and HOST let the app share a server with other apps: on a VPS bind it
// to 127.0.0.1 on a free port and let nginx in front of it face the internet.
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
// User data and the session secret live here; on a VPS keep them outside the
// code checkout so `git pull` never touches them.
const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);

// The app and its API share one origin, so no CORS headers are sent: other
// sites cannot call the API from a browser. Behind nginx, trust its
// X-Forwarded-* headers so req.secure and req.ip are right.
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '50mb' }));

import fs from 'fs';

// File-backed and in-memory KV fallback store for user data and sync
const DATA_FILE = path.join(DATA_DIR, '.data_store.json');
const inMemoryStore = new Map<string, any>();

// Load existing data from file if available
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    Object.entries(parsed).forEach(([k, v]) => inMemoryStore.set(k, v));
  }
} catch (e) {
  console.warn('Could not load local data store file:', e);
}

function persistStore() {
  try {
    const obj: Record<string, any> = {};
    inMemoryStore.forEach((v, k) => { obj[k] = v; });
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.chmodSync(DATA_FILE, 0o600); // user data and password hashes: owner only
  } catch (e) {
    console.warn('Could not persist local data store to file:', e);
  }
}

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const getUserKey = (username: string) => `user:${username.toLowerCase()}`;

async function getUser(username: string): Promise<any | null> {
  const key = getUserKey(username);
  if (KV_URL && KV_TOKEN) {
    try {
      const kvResponse = await fetch(`${KV_URL}/get/${key}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
      });
      if (kvResponse.ok) {
        const { result } = await kvResponse.json();
        return result ? JSON.parse(result) : null;
      }
    } catch (e) {
      console.warn('KV fetch failed, falling back to local store:', e);
    }
  }
  return inMemoryStore.get(key) || null;
}

async function setUser(userData: any): Promise<void> {
  const key = getUserKey(userData.username);
  if (KV_URL && KV_TOKEN) {
    try {
      const kvResponse = await fetch(`${KV_URL}/set/${key}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        body: JSON.stringify(userData),
      });
      if (kvResponse.ok) return;
    } catch (e) {
      console.warn('KV save failed, saving to local store:', e);
    }
  }
  inMemoryStore.set(key, userData);
  persistStore();
}

// --- GEMINI API HANDLER ---
async function handleGeminiGenerate(payload: any, res: Response, apiKey: string) {
  const { model, contents, config } = payload;
  // Support gemini-2.5-flash / gemini-2.5-pro or standard gemini-2.5-flash
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.5-flash'}:generateContent`;

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
      return res.status(geminiResponse.status).json({ error: 'Google API Error', details: errorJson });
    } catch (e) {
      return res.status(geminiResponse.status).json({ error: 'Google API Error', details: errorText });
    }
  }

  const responseData = await geminiResponse.json();
  const adaptedResponse = {
    text: responseData.candidates?.[0]?.content?.parts?.[0]?.text || '',
    candidates: responseData.candidates,
  };

  return res.status(200).json(adaptedResponse);
}

// --- OPENAI-COMPATIBLE (GROQ, OPENROUTER, DEEPSEEK, OLLAMA, TOGETHER, ETC.) HANDLER ---
async function handleOpenAiGenerate(payload: any, res: Response, apiKey: string, baseUrl?: string) {
  const cleanBaseUrl = (baseUrl || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  const endpoint = `${cleanBaseUrl}/chat/completions`;
  const { model, contents, config } = payload;
  
  let systemInstruction = config?.systemInstruction || '';
  let userText = '';
  
  if (typeof contents === 'string') {
    userText = contents;
  } else if (Array.isArray(contents)) {
    userText = contents.map((c: any) => c.text || c.parts?.map((p: any) => p.text || '').join('\n') || '').join('\n');
  } else if (contents && typeof contents === 'object' && contents.parts) {
    userText = contents.parts.map((p: any) => p.text || '').join('\n');
  } else {
    userText = JSON.stringify(contents);
  }

  const messages = [
    ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
    { role: 'user', content: userText }
  ];

  const requestBody: Record<string, any> = {
    model: model || 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.3,
  };

  if (config?.responseMimeType === 'application/json' || config?.responseSchema) {
    requestBody.response_format = { type: 'json_object' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const apiResponse = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!apiResponse.ok) {
    const errorText = await apiResponse.text();
    console.error('OpenAI-compatible API Error:', errorText);
    try {
      const errorJson = JSON.parse(errorText);
      return res.status(apiResponse.status).json({ error: errorJson.error?.message || 'AI API Error', details: errorJson });
    } catch {
      return res.status(apiResponse.status).json({ error: 'AI API Error', details: errorText });
    }
  }

  const responseData = await apiResponse.json();
  const text = responseData.choices?.[0]?.message?.content || '';
  return res.status(200).json({ text, candidates: responseData.choices });
}

// --- PROXY ENDPOINT ---
app.post('/api/proxy', async (req: Request, res: Response) => {
  const { action, ...payload } = req.body || {};

  // Every action except the pings and sign-in needs a valid session cookie;
  // the signed-in user comes from the cookie, never from the request body.
  const secret = getSessionSecret(DATA_DIR);
  const signedInUser = sessionUser(req.headers.cookie, secret);
  if (!PUBLIC_ACTIONS.has(action) && !signedInUser) {
    return res.status(401).json({ error: 'Please sign in again.', code: 'AUTH_REQUIRED' });
  }

  try {
    switch (action) {
      case 'ping':
        return res.status(200).json({ message: 'pong' });

      case 'ping-free-dict': {
        try {
          const dictResponse = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/hello', {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LinguaCards/1.0',
              'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(2000),
          });
          if (dictResponse.ok) {
            return res.status(200).json({ message: 'pong' });
          }
        } catch {
          // Quietly fallback
        }
        return res.status(200).json({ message: 'pong' });
      }

      case 'ping-mw': {
        const mwApiKeyPing = process.env.MW_API_KEY;
        if (!mwApiKeyPing) return res.status(200).json({ message: 'unconfigured' });
        try {
          const mwResponse = await fetch(`https://www.dictionaryapi.com/api/v3/references/collegiate/json/test?key=${mwApiKeyPing}`, {
            signal: AbortSignal.timeout(3000),
          });
          return res.status(mwResponse.ok ? 200 : 503).json({ message: mwResponse.ok ? 'pong' : 'api unreachable' });
        } catch {
          return res.status(503).json({ error: 'Merriam-Webster unreachable' });
        }
      }

      case 'gemini-generate': {
        const isCustomOpenAi = payload.aiProvider === 'openai-compatible' || payload.aiBaseUrl;
        if (isCustomOpenAi) {
          const apiKey = payload.customApiKey || '';
          return await handleOpenAiGenerate(payload, res, apiKey, payload.aiBaseUrl);
        }

        const apiKey = payload.customApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured. Please set GEMINI_API_KEY or configure your Custom API Key in AI Settings.' });
        return await handleGeminiGenerate(payload, res, apiKey);
      }

      case 'test-ai-key': {
        const isCustomOpenAi = payload.aiProvider === 'openai-compatible' || payload.aiBaseUrl;
        if (isCustomOpenAi) {
          const apiKey = payload.customApiKey || '';
          const model = payload.model || 'llama-3.3-70b-versatile';
          const testPayload = {
            model,
            contents: 'Say "OK" in JSON: {"status": "OK"}',
            config: { responseMimeType: 'application/json' }
          };
          return await handleOpenAiGenerate(testPayload, res, apiKey, payload.aiBaseUrl);
        }

        const apiKey = payload.customApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
        if (!apiKey) return res.status(400).json({ error: 'No API key provided.' });
        const model = payload.model || 'gemini-2.5-flash';
        const testPayload = {
          model,
          contents: 'Say "OK" if connected.',
          config: {}
        };
        return await handleGeminiGenerate(testPayload, res, apiKey);
      }

      case 'dictionary-free': {
        const { word } = payload;
        if (!word) return res.status(400).json({ error: 'Word is required.' });
        // dictionaryapi.dev first, Datamuse definitions as fallback
        const data = await fetchDictionaryEntries(word);

        if (data && Array.isArray(data) && data.length > 0) {
          return res.status(200).json(data);
        }

        return res.status(404).json({ error: `Could not find definition for "${word}".` });
      }

      case 'word-frequencies': {
        const { words } = payload;
        if (!Array.isArray(words)) return res.status(400).json({ error: 'words must be an array.' });
        const frequencies = await lookupFrequencies(words.map((w: unknown) => String(w)));
        return res.status(200).json({ frequencies });
      }

      case 'free-enrich': {
        const { term } = payload;
        if (!term || typeof term !== 'string') return res.status(400).json({ error: 'term is required.' });
        return res.status(200).json(await freeEnrich(term));
      }

      case 'free-translate': {
        const { text } = payload;
        if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text is required.' });
        return res.status(200).json({ translation: await freeTranslate(text) });
      }

      case 'dictionary-mw': {
        const { word } = payload;
        if (!word) return res.status(400).json({ error: 'Word is required.' });
        const mwApiKey = process.env.MW_API_KEY;
        if (!mwApiKey) return res.status(500).json({ error: 'Merriam-Webster API key not configured in .env (MW_API_KEY).' });
        try {
          const apiResponse = await fetch(`https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${mwApiKey}`, {
            signal: AbortSignal.timeout(7000),
          });
          const data = await apiResponse.json();
          return res.status(apiResponse.status).json(data);
        } catch (mwErr: any) {
          return res.status(503).json({ error: `Merriam-Webster service unavailable: ${mwErr.message}` });
        }
      }

      case 'fetch-audio': {
        const { url } = payload;
        if (!url) return res.status(400).json({ error: 'URL is required.' });
        if (!isAllowedAudioUrl(url)) return res.status(400).json({ error: 'Audio is only fetched from dictionary sites.' });
        const audioResponse = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!audioResponse.ok) {
          const errorText = await audioResponse.text();
          return res.status(audioResponse.status).json({ error: 'Failed to fetch audio from source.', details: errorText });
        }
        const contentType = audioResponse.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
        const arrayBuffer = await audioResponse.arrayBuffer();
        return res.status(200).send(Buffer.from(arrayBuffer));
      }

      case 'auth-register': {
        const { username, password } = payload;
        if (!registrationAllowed()) return res.status(403).json({ error: 'Registration is closed on this server.' });
        if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Username and password are required.' });
        if (!USERNAME_PATTERN.test(username)) return res.status(400).json({ error: 'Username must be 3-32 letters, digits, dots, dashes or underscores.' });
        if (password.length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });

        const existingUser = await getUser(username);
        if (existingUser) {
          return res.status(409).json({ error: 'Username is already taken.' });
        }

        const newUser = {
          username,
          password: await hashPassword(password),
          data: {
            decks: [],
            cards: [],
            studyHistory: [],
            userProfile: null,
            userAchievements: [],
          },
        };

        await setUser(newUser);
        res.setHeader('Set-Cookie', sessionCookieHeader(createSessionToken(username, secret), req.secure));
        return res.status(201).json({ message: 'User registered successfully.', username: username.toLowerCase() });
      }

      case 'auth-login': {
        const { username, password } = payload;
        if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
          return res.status(400).json({ error: 'Username and password are required.' });
        }
        const ip = req.ip || 'unknown';
        const lockedMinutes = loginLockMinutes(ip, username);
        if (lockedMinutes > 0) {
          return res.status(429).json({ error: `Too many failed attempts. Try again in ${lockedMinutes} minute(s).` });
        }

        const user = await getUser(username);
        const check = await verifyPassword(password, user?.password);
        if (!user || !check.ok) {
          recordLoginFailure(ip, username);
          return res.status(401).json({ error: 'Invalid username or password.' });
        }
        clearLoginFailures(ip, username);
        if (check.needsRehash) {
          user.password = await hashPassword(password); // replace a legacy plain-text password
          await setUser(user);
        }

        res.setHeader('Set-Cookie', sessionCookieHeader(createSessionToken(username, secret), req.secure));
        return res.status(200).json({ message: 'Login successful.', username: username.toLowerCase() });
      }

      case 'auth-session': {
        if (!signedInUser || !(await getUser(signedInUser))) return res.status(200).json({ username: null });
        return res.status(200).json({ username: signedInUser });
      }

      case 'auth-logout': {
        res.setHeader('Set-Cookie', clearSessionCookieHeader(req.secure));
        return res.status(200).json({ message: 'Logged out.' });
      }

      case 'sync-load': {
        const user = await getUser(signedInUser!);
        return res.status(200).json({ data: user ? user.data : null });
      }

      case 'sync-merge': {
        const { data: clientData } = payload;
        if (!clientData || typeof clientData !== 'object') return res.status(400).json({ error: 'Data is required.' });

        const user = await getUser(signedInUser!);
        if (!user) return res.status(401).json({ error: 'Please sign in again.', code: 'AUTH_REQUIRED' });

        const cloudData = user.data || { decks: [], cards: [], studyHistory: [], userProfile: null, userAchievements: [] };

        const mergeDecks = (cloudItems: any[], clientItems: any[]) => {
          const mergedMap = new Map<string, any>();
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

        const mergeFlashcards = (cloudItems: any[], clientItems: any[]) => {
          const mergedMap = new Map<string, any>();
          (cloudItems || []).forEach(item => mergedMap.set(item.id, item));
          (clientItems || []).forEach(clientItem => {
            const cloudItem = mergedMap.get(clientItem.id);
            if (cloudItem) {
              const clientTimestamp = new Date(clientItem.updatedAt || 0).getTime();
              const cloudTimestamp = new Date(cloudItem.updatedAt || 0).getTime();
              const winner = clientTimestamp >= cloudTimestamp ? clientItem : cloudItem;
              winner.isDeleted = clientItem.isDeleted || cloudItem.isDeleted;
              mergedMap.set(clientItem.id, winner);
            } else {
              mergedMap.set(clientItem.id, clientItem);
            }
          });
          return Array.from(mergedMap.values());
        };

        const mergedDecks = mergeDecks(cloudData.decks, clientData.decks);
        const mergedCards = mergeFlashcards(cloudData.cards, clientData.cards);
        // Texts on the reading path merge like cards: newest updatedAt wins.
        const mergedTexts = mergeFlashcards(cloudData.texts || [], clientData.texts || []);

        const studyHistoryMap = new Map<string, any>();
        (cloudData.studyHistory || []).forEach((log: any) => studyHistoryMap.set(`${log.cardId}-${log.date}-${log.rating}`, log));
        (clientData.studyHistory || []).forEach((log: any) => studyHistoryMap.set(`${log.cardId}-${log.date}-${log.rating}`, log));
        const mergedStudyHistory = Array.from(studyHistoryMap.values());

        let mergedUserProfile: any = null;
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
            } else {
              const mergedGoalsMap = new Map<string, any>();
              (cloudGoals.goals || []).forEach((g: any) => mergedGoalsMap.set(g.id, { ...g }));
              (clientGoals.goals || []).forEach((cg: any) => {
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
              mergedDailyGoals = {
                date: clientGoals.date,
                goals: Array.from(mergedGoalsMap.values()),
                allCompleteAwarded: clientGoals.allCompleteAwarded || cloudGoals.allCompleteAwarded,
              };
            }
          } else {
            mergedDailyGoals = clientGoals || cloudGoals;
          }

          mergedUserProfile = {
            id: clientP.id,
            xp: Math.max(clientP.xp || 0, cloudP.xp || 0),
            level: Math.max(clientP.level || 1, cloudP.level || 1),
            lastStreakCheck: (new Date(clientP.lastStreakCheck || 0) > new Date(cloudP.lastStreakCheck || 0)) ? clientP.lastStreakCheck : cloudP.lastStreakCheck,
            firstName: newerProfile.firstName,
            lastName: newerProfile.lastName,
            bio: newerProfile.bio,
            profileLastUpdated: newerProfile.profileLastUpdated,
            dailyGoals: mergedDailyGoals || undefined,
            streakFreezesEarned: Math.max(clientP.streakFreezesEarned || 0, cloudP.streakFreezesEarned || 0),
            frozenDates: Array.from(new Set([...(clientP.frozenDates || []), ...(cloudP.frozenDates || [])])).sort(),
          };
        } else {
          mergedUserProfile = clientP || cloudP;
        }

        const achievementsMap = new Map<string, any>();
        (cloudData.userAchievements || []).forEach((ach: any) => achievementsMap.set(ach.achievementId, ach));
        (clientData.userAchievements || []).forEach((ach: any) => achievementsMap.set(ach.achievementId, ach));
        const mergedUserAchievements = Array.from(achievementsMap.values());

        const mergedData = {
          decks: mergedDecks,
          cards: mergedCards,
          studyHistory: mergedStudyHistory,
          userProfile: mergedUserProfile,
          userAchievements: mergedUserAchievements,
          texts: mergedTexts,
          settings: newerSettings(clientData.settings, cloudData.settings),
        };

        user.data = mergedData;
        await setUser(user);

        return res.status(200).json({ data: mergedData });
      }

      default:
        return res.status(400).json({ message: 'Invalid or missing action.' });
    }
  } catch (error) {
    console.error(`Error in proxy action '${action}':`, error);
    return res.status(500).json({ error: 'An internal server error occurred.', details: (error as Error).message });
  }
});

// Setup Vite dev server or static file serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    // Express 5 no longer accepts '*' as a path; a regex matches every route
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`🚀 Lingua Cards server listening on http://${HOST}:${PORT}`);
  });
}

startServer();
