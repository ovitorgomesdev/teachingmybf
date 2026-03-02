exports.handler = async function(event) {
  // CORS headers for all responses
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Quick health check — GET /.netlify/functions/ai-lesson?ping=1
  if (event.queryStringParameters && event.queryStringParameters.ping) {
    const hasKey = !!process.env.GEMINI_API_KEY;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, gemini_key_set: hasKey })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { systemPrompt, imageData, mediaType } = body;

  if (!imageData || !systemPrompt) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing imageData or systemPrompt' }) };
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing GEMINI_API_KEY on server' }) };
  }

  const GEMINI_MODEL = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const fullPrompt = systemPrompt + '\n\nAnalyze the image and return ONLY a raw JSON object. No markdown, no code fences.';

  const requestBody = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mediaType || 'image/jpeg', data: imageData } },
        { text: fullPrompt }
      ]
    }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const rawText = await response.text();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: 'Gemini API error ' + response.status, detail: rawText.slice(0, 500) })
      };
    }

    const geminiData = JSON.parse(rawText);
    const finishReason = geminiData?.candidates?.[0]?.finishReason;

    if (finishReason && finishReason !== 'STOP') {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({ error: 'Gemini blocked: ' + finishReason })
      };
    }

    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Empty response from Gemini', raw: JSON.stringify(geminiData).slice(0, 300) })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ content: [{ type: 'text', text: text }] })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
