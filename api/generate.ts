/ File: /api/generate.ts
// (This is a simplified example showing the proxy concept)
// You'd need to install @google/genai as a dependency if you use a build step,
// or use fetch to call the Google API endpoint directly.

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ message: 'Only POST requests are allowed' });
  }

  try {
    const { contents, model } = request.body;
    const apiKey = process.env.API_KEY; // This is the SECURE way on Vercel

    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: contents }] }] }),
    });

    if (!geminiResponse.ok) {
        const error = await geminiResponse.json();
        throw new Error(error.error.message);
    }

    const data = await geminiResponse.json();
    // Assuming the response structure for simplicity
    const text = data.candidates[0].content.parts[0].text;
    
    response.status(200).json({ text });

  } catch (error) {
    console.error(error);
    response.status(500).json({ message: 'Error calling Gemini API', error: error.message });
  }
}
