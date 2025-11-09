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
    // Get the parameters sent from our frontend
    const { model, contents, config } = request.body;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // Initialize the body for the Google API call.
    const googleApiBody: any = {};

    // 1. Set the contents. The format can vary depending on the request type.
    if (Array.isArray(contents)) { // For chat history and TTS
        googleApiBody.contents = contents;
    } else if (typeof contents === 'object' && contents.parts) { // For multimodal input (e.g., image + text)
        googleApiBody.contents = [contents];
    } else { // For simple text prompts
        googleApiBody.contents = [{ parts: [{ text: contents }] }];
    }

    // 2. Intelligently add configuration from the client to the correct places.
    if (config) {
      // Properties for standard text generation go inside 'generationConfig'.
      if (config.responseMimeType || config.responseSchema) {
        googleApiBody.generationConfig = {};
        if (config.responseMimeType) {
          googleApiBody.generationConfig.responseMimeType = config.responseMimeType;
        }
        if (config.responseSchema) {
          googleApiBody.generationConfig.responseSchema = config.responseSchema;
        }
      }
      
      // Properties for TTS (and other special modalities) are top-level fields.
      if (config.responseModalities) {
        googleApiBody.responseModalities = config.responseModalities;
      }
      if (config.speechConfig) {
        googleApiBody.speechConfig = config.speechConfig;
      }
    }

    // Call the actual Google GenAI REST API on the server
    const geminiResponse = await fetch(`${endpoint}?key=${apiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
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
    
    // Adapt the REST API response to a structure that the client-side code expects.
    // This ensures the frontend can correctly parse both text and audio data from the 'candidates' array.
    const adaptedResponse = {
        text: responseData.candidates?.[0]?.content?.parts?.[0]?.text || '',
        candidates: responseData.candidates,
    };

    // Send the adapted response from Gemini back to our frontend
    response.status(200).json(adaptedResponse);

  } catch (error) {
    console.error('Error in proxy function:', error);
    response.status(500).json({ error: 'Failed to call Gemini API.', details: error.message });
  }
}
