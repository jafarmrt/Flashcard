// File: /api/proxy.ts
// This is a Vercel Serverless Function that acts as a secure proxy.
// It prevents the API_KEY from being exposed in the frontend client code.

// IMPORTANT: Because this file will be deployed in a Node.js environment on Vercel,
// we CANNOT use browser-specific types like `Request` or `Response`.
// We use a syntax compatible with Vercel's Node.js runtime.
// We also cannot directly import from the `@google/genai` CDN link here.
// Instead, we can use `fetch` to call the REST API endpoint directly,
// which is a more robust approach for a serverless environment.

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

    // Determine the correct API endpoint based on the model
    // This simple logic covers both generateContent and generateText
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // The body for the Google API call
    const googleApiBody = {
        contents: Array.isArray(contents) ? contents : [{ parts: [{ text: contents }] }],
        generationConfig: {
            // map our config to generationConfig
            responseMimeType: config?.responseMimeType,
        },
        // We can't send the full schema over, but we can send the responseMimeType
        // which is the most critical part for JSON mode.
        // For more complex scenarios, this proxy would need to be more sophisticated.
    };
    
    // For audio and pronunciation feedback, the `contents` format is different
    if (typeof contents === 'object' && contents.parts) {
        googleApiBody.contents = [contents];
    }
    
    // For chat history
     if (Array.isArray(contents)) {
        googleApiBody.contents = contents;
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
        // Try to parse as JSON, but fall back to text
        try {
             const errorJson = JSON.parse(errorText);
             return response.status(geminiResponse.status).json({ error: 'Google API Error', details: errorJson });
        } catch (e) {
             return response.status(geminiResponse.status).json({ error: 'Google API Error', details: errorText });
        }
    }

    const responseData = await geminiResponse.json();
    
    // The Gemini REST API has a slightly different structure. Let's adapt it to what the SDK provided.
    // This makes our frontend changes minimal.
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
