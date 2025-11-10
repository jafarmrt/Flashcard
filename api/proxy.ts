// File: /api/proxy.ts
// This Vercel Serverless Function acts as a secure proxy and router.
// It handles requests for both the Google GenAI API and the new Cloud Sync feature.
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Define types for our data structure
interface Deck {
  id: string;
  name: string;
  isDeleted?: boolean;
}
interface Flashcard {
  id: string;
  // ... other properties
  isDeleted?: boolean;
}
interface SyncData {
  decks: Deck[];
  cards: Flashcard[];
}


// --- HANDLER FOR GEMINI API ---
async function handleGeminiGenerate(payload: any, response: VercelResponse, apiKey: string) {
  const { model, contents, config } = payload;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // Destructure config to correctly place parameters for the Google API
  const {
    responseModalities,
    speechConfig,
    systemInstruction,
    ...generationConfig // All other properties fall into generationConfig
  } = config || {};


  const googleApiBody = {
    contents: Array.isArray(contents)
      ? contents
      : (typeof contents === 'object' && contents.parts)
        ? [contents]
        : [{ parts: [{ text: contents }] }],
    // Conditionally add properties to the body if they exist
    ...(generationConfig && Object.keys(generationConfig).length > 0 && { generationConfig }),
    ...(responseModalities && { responseModalities }),
    ...(speechConfig && { speechConfig }),
    ...(systemInstruction && { systemInstruction }),
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

  let cloudData: SyncData = { decks: [], cards: [] };
  if (getResponse.ok) {
    const { result } = await getResponse.json();
    if (result) {
      cloudData = JSON.parse(result);
    }
  }

  // 2. Merge client data and cloud data
  const mergedDecksMap = new Map<string, Deck>();
  (cloudData.decks || []).forEach(deck => mergedDecksMap.set(deck.id, deck));
  (clientData.decks || []).forEach(deck => mergedDecksMap.set(deck.id, deck));

  const mergedCardsMap = new Map<string, Flashcard>();
  (cloudData.cards || []).forEach(card => mergedCardsMap.set(card.id, card));
  (clientData.cards || []).forEach(card => mergedCardsMap.set(card.id, card));

  const mergedData: SyncData = {
    decks: Array.from(mergedDecksMap.values()),
    cards: Array.from(mergedCardsMap.values()),
  };

  // 3. Save the merged data back to the cloud
  const setResponse = await fetch(`${KV_URL}/set/${syncKey}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(mergedData),
  });

  if (!setResponse.ok) {
    const errorText = await setResponse.text();
    return response.status(500).json({ error: 'Failed to save merged data.', details: errorText });
  }
  
  // 4. Return the authoritative merged data to the client
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
        
      case 'gemini-generate':
        const apiKey = process.env.API_KEY;
        if (!apiKey) {
          return response.status(500).json({ error: 'API key not configured.' });
        }
        return await handleGeminiGenerate(payload, response, apiKey);

      case 'sync-save': // Kept for legacy or specific uses, but merge is preferred
        return await handleSyncSave(payload, response);

      case 'sync-load':
        return await handleSyncLoad(payload, response);
        
      case 'sync-merge':
        return await handleSyncMerge(payload, response);

      default:
        // If no action is specified, assume it's a gemini-generate call for backward compatibility
        if (payload.model && payload.contents) {
            const apiKey = process.env.API_KEY;
            if (!apiKey) {
              return response.status(500).json({ error: 'API key not configured.' });
            }
            return await handleGeminiGenerate(request.body, response, apiKey);
        }
        return response.status(400).json({ message: `Invalid or missing action.` });
    }
  } catch (error) {
    console.error(`Error in proxy action '${action}':`, error);
    response.status(500).json({ error: 'An internal server error occurred.', details: (error as Error).message });
  }
}