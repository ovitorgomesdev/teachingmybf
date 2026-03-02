exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  // Health check
  if (event.queryStringParameters && event.queryStringParameters.ping) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, groq_key_set: !!process.env.GROQ_API_KEY }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { systemPrompt, imageData, mediaType } = body;
  if (!imageData || !systemPrompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing imageData or systemPrompt' }) };

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing GROQ_API_KEY on server' }) };

  // Groq vision model — free tier, fast
  const requestBody = {
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    max_tokens: 2048,
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mediaType || 'image/jpeg'};base64,${imageData}`
            }
          },
          {
            type: 'text',
            text: 'Analyze this material and return ONLY a raw JSON object. No markdown, no code fences, no explanation.'
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify(requestBody)
    });

    const rawText = await response.text();

    if (!response.ok) {
      console.error('Groq API error:', response.status, rawText);
      return { statusCode: response.status, headers, body: JSON.stringify({ error: 'Groq API error ' + response.status, detail: rawText.slice(0, 500) }) };
    }

    const groqData = JSON.parse(rawText);
    const text = groqData?.choices?.[0]?.message?.content || '';

    if (!text) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Empty response from Groq', raw: JSON.stringify(groqData).slice(0, 300) }) };

    // Normalize to same format frontend expects
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ content: [{ type: 'text', text: text }] })
    };

  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
