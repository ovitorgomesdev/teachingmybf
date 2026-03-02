exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  const { systemPrompt, imageData, mediaType } = body;

  if (!imageData || !systemPrompt) {
    return { statusCode: 400, body: 'Missing imageData or systemPrompt' };
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing GEMINI_API_KEY environment variable' }) };
  }

  // Check image size — Gemini inline_data limit is ~4MB base64
  const imageSizeKB = Math.round(imageData.length * 0.75 / 1024);
  if (imageData.length > 5_000_000) {
    return {
      statusCode: 413,
      body: JSON.stringify({ error: `Image too large (${imageSizeKB}KB). Please use an image under 3MB.` })
    };
  }

  const GEMINI_MODEL = 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const fullPrompt = systemPrompt + '\n\nAnalyze the image above. Return ONLY a raw JSON object — no markdown, no code fences, no explanation.';

  const requestBody = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mediaType || 'image/jpeg',
            data: imageData
          }
        },
        { text: fullPrompt }
      ]
    }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048
      // NOTE: responseMimeType omitted — some API keys don't support it yet
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const rawText = await response.text();

    if (!response.ok) {
      console.error('Gemini API error:', response.status, rawText);
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Gemini API error ' + response.status, detail: rawText.slice(0, 500) })
      };
    }

    let geminiData;
    try {
      geminiData = JSON.parse(rawText);
    } catch (e) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Could not parse Gemini response', raw: rawText.slice(0, 300) })
      };
    }

    // Check for blocked content
    const finishReason = geminiData?.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      return {
        statusCode: 422,
        body: JSON.stringify({ error: 'Gemini blocked the response: ' + finishReason })
      };
    }

    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Empty text in Gemini response', raw: JSON.stringify(geminiData).slice(0, 300) })
      };
    }

    // Return in Anthropic-style format the frontend already expects
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: [{ type: 'text', text: text }]
      })
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
