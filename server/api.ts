import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import { newerSettings } from '../services/settingsSync.js';
import { fetchDictionaryEntries, freeEnrich, freeTranslate, lookupFrequencies } from './freeLookup.js';
import {
  PUBLIC_ACTIONS, USERNAME_PATTERN, MIN_PASSWORD_LENGTH, registrationAllowed,
  hashPassword, verifyPassword, getSessionSecret, createSessionToken, sessionUser,
  sessionCookieHeader, clearSessionCookieHeader, loginLockMinutes, recordLoginFailure,
  clearLoginFailures, isAllowedAudioUrl,
} from './auth.js';

// The parts of Express's and Vercel's request/response objects the API uses.
export interface ProxyRequest {
  body?: any;
  headers: Record<string, string | string[] | undefined>;
  secure?: boolean; // Express sets it (trusting nginx); Vercel does not
  ip?: string;
}
export interface ProxyResponse {
  status(code: number): ProxyResponse;
  json(body: unknown): unknown;
  send(body: unknown): unknown;
  setHeader(name: string, value: string | number | readonly string[]): unknown;
}

const firstHeader = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.split(',')[0].trim();

// On Vercel the platform sets X-Forwarded-Proto and X-Forwarded-For itself.
const isSecure = (req: ProxyRequest) =>
  typeof req.secure === 'boolean' ? req.secure : firstHeader(req.headers['x-forwarded-proto']) === 'https';
const clientIp = (req: ProxyRequest) =>
  req.ip || firstHeader(req.headers['x-real-ip']) || firstHeader(req.headers['x-forwarded-for']) || 'unknown';

// User data lives in Upstash Redis / Vercel KV when KV_REST_API_URL and
// KV_REST_API_TOKEN are set (needed on Vercel, whose disk is not kept), else in
// `<DATA_DIR>/.data_store.json` (the VPS). Settings are read lazily so a
// .env loaded after import still counts.
const dataDir = () => path.resolve(process.env.DATA_DIR || process.cwd());
const kvConfig = () => {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
};

let fileStore: Map<string, any> | null = null;

function loadFileStore(): Map<string, any> {
  if (fileStore) return fileStore;
  if (process.env.VERCEL) {
    throw new Error('Cloud storage is not set up. Connect Upstash Redis to this Vercel project so KV_REST_API_URL and KV_REST_API_TOKEN are set.');
  }
  fileStore = new Map<string, any>();
  const file = path.join(dataDir(), '.data_store.json');
  try {
    if (fs.existsSync(file)) {
      Object.entries(JSON.parse(fs.readFileSync(file, 'utf-8'))).forEach(([k, v]) => fileStore!.set(k, v));
    }
  } catch (e) {
    console.warn('Could not load local data store file:', e);
  }
  return fileStore;
}

function persistStore(store: Map<string, any>) {
  const file = path.join(dataDir(), '.data_store.json');
  try {
    const obj: Record<string, any> = {};
    store.forEach((v, k) => { obj[k] = v; });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.chmodSync(file, 0o600); // user data and password hashes: owner only
  } catch (e) {
    console.warn('Could not persist local data store to file:', e);
  }
}

const getUserKey = (username: string) => `user:${username.toLowerCase()}`;

// A KV error is thrown, not hidden: falling back to memory would lose data.
async function getUser(username: string): Promise<any | null> {
  const key = getUserKey(username);
  const kv = kvConfig();
  if (kv) {
    const kvResponse = await fetch(`${kv.url}/get/${key}`, { headers: { Authorization: `Bearer ${kv.token}` } });
    if (!kvResponse.ok) throw new Error(`Cloud storage read failed (${kvResponse.status}).`);
    const { result } = await kvResponse.json();
    return result ? JSON.parse(result) : null;
  }
  return loadFileStore().get(key) || null;
}

async function setUser(userData: any): Promise<void> {
  const key = getUserKey(userData.username);
  const kv = kvConfig();
  if (kv) {
    const kvResponse = await fetch(`${kv.url}/set/${key}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kv.token}` },
      body: JSON.stringify(userData),
    });
    if (!kvResponse.ok) throw new Error(`Cloud storage write failed (${kvResponse.status}).`);
    return;
  }
  const store = loadFileStore();
  store.set(key, userData);
  persistStore(store);
}

// --- GEMINI API HANDLER ---
async function handleGeminiGenerate(payload: any, res: ProxyResponse, apiKey: string) {
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
async function handleOpenAiGenerate(payload: any, res: ProxyResponse, apiKey: string, baseUrl?: string) {
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
// The one API endpoint, shared by the Express server (VPS, local dev) and the
// Vercel function in api/proxy.ts.
export async function handleProxy(req: ProxyRequest, res: ProxyResponse) {
  const { action, ...payload } = req.body || {};

  // Every action except the pings and sign-in needs a valid session cookie;
  // the signed-in user comes from the cookie, never from the request body.
  const secure = isSecure(req);
  let secret: string;
  try {
    secret = getSessionSecret(dataDir());
  } catch (e) {
    // Vercel cannot keep a generated secret, so SESSION_SECRET must be set there.
    return res.status(500).json({ error: (e as Error).message });
  }
  const cookie = req.headers.cookie;
  const signedInUser = sessionUser(Array.isArray(cookie) ? cookie.join('; ') : cookie, secret);
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
        res.setHeader('Set-Cookie', sessionCookieHeader(createSessionToken(username, secret), secure));
        return res.status(201).json({ message: 'User registered successfully.', username: username.toLowerCase() });
      }

      case 'auth-login': {
        const { username, password } = payload;
        if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
          return res.status(400).json({ error: 'Username and password are required.' });
        }
        const ip = clientIp(req);
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

        res.setHeader('Set-Cookie', sessionCookieHeader(createSessionToken(username, secret), secure));
        return res.status(200).json({ message: 'Login successful.', username: username.toLowerCase() });
      }

      case 'auth-session': {
        if (!signedInUser || !(await getUser(signedInUser))) return res.status(200).json({ username: null });
        return res.status(200).json({ username: signedInUser });
      }

      case 'auth-logout': {
        res.setHeader('Set-Cookie', clearSessionCookieHeader(secure));
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
}
