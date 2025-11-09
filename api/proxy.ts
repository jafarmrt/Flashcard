// File: /api/proxy.ts
// This is a Vercel Serverless Function that acts as a secure proxy.
// It prevents the API_KEY from being exposed in the frontend client code.

export default async function handler(request, response) {
  // Only allow POST requests
  if (request.method !== 'POST') {
    return response.status(405).json({ message: 'Method Not Allowed' });
  }

  // Securely get the API key from Vercel's environment variables
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return response.status(500).json({ error: 'API key not configured.' });
  }
  
  try {
    const { model, contents, config } = request.body;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    let googleApiBody;

    // Explicitly check if it's a Text-to-Speech request based on the model name.
    // This is more reliable than inferring from the config object.
    if (model && model.includes('tts')) {
        // Build the specific body required for TTS
        googleApiBody = {
            contents: contents, // TTS expects `contents` to be an array e.g. [{ parts: [{ text: "..." }] }]
            responseModalities: config?.responseModalities,
            speechConfig: config?.speechConfig,
        };
    } else {
        // Handle all other types of requests (text, json, chat, multimodal)
        googleApiBody = {
            // Normalize `contents` to the expected format for the API
            contents: Array.isArray(contents)
                ? contents // For chat history
                : (typeof contents === 'object' && contents.parts)
                    ? [contents] // For multimodal input
                    : [{ parts: [{ text: contents }] }], // For simple text prompts
            
            // For text/json generation, parameters go inside generationConfig
            generationConfig: config,
        };
    }

    // Call the actual Google GenAI REST API on the server
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
    
    // Adapt the REST API response to a structure the client-side code expects.
    // This allows the client to handle both text and audio responses consistently.
    const adaptedResponse = {
        text: responseData.candidates?.[0]?.content?.parts?.[0]?.text || '',
        candidates: responseData.candidates,
    };

    // Send the adapted response back to our frontend
    response.status(200).json(adaptedResponse);

  } catch (error) {
    console.error('Error in proxy function:', error);
    response.status(500).json({ error: 'Failed to call Gemini API.', details: error.message });
  }
}
