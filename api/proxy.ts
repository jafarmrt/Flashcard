// File: /api/proxy.ts
// This Vercel Serverless Function acts as a secure proxy and router.
// It handles requests for both the Google GenAI API and the new Cloud Sync feature.

// --- HANDLER FOR GEMINI API ---
async function handleGeminiGenerate(payload, response, apiKey) {
  const { model, contents, config } = payload;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const googleApiBody = {
    contents: Array.isArray(contents)
      ? contents
      : (typeof contents === 'object' && contents.parts)
        ? [contents]
        : [{ parts: [{ text: contents }] }],
    generationConfig: config,
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

async function handleSyncSave(payload, response) {
  if (!KV_URL || !KV_TOKEN) {
    return response.status(500).json({ error: 'Sync feature not configured on the server.' });
  }
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

async function handleSyncLoad(payload, response) {
  if (!KV_URL || !KV_TOKEN) {
    return response.status(500).json({ error: 'Sync feature not configured on the server.' });
  }
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


// --- MAIN HANDLER ---
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ message: 'Method Not Allowed' });
  }

  const { action, ...payload } = request.body;

  try {
    switch (action) {
      case 'gemini-generate':
        const apiKey = process.env.API_KEY;
        if (!apiKey) {
          return response.status(500).json({ error: 'API key not configured.' });
        }
        return await handleGeminiGenerate(payload, response, apiKey);

      case 'sync-save':
        return await handleSyncSave(payload, response);

      case 'sync-load':
        return await handleSyncLoad(payload, response);

      default:
        return response.status(400).json({ message: `Invalid action: ${action}` });
    }
  } catch (error) {
    console.error(`Error in proxy action '${action}':`, error);
    response.status(500).json({ error: 'An internal server error occurred.', details: error.message });
  }
}