import './env.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini';

function summarizeApiError(text) {
  if (!text) return '';

  try {
    const json = JSON.parse(text);
    const message = json?.error?.message || json?.message;
    if (message) return String(message).slice(0, 600);
  } catch {
    // Fall back to plain text.
  }

  return text.replace(/\s+/g, ' ').trim().slice(0, 600);
}

function outputText(json) {
  if (json?.output_text) return json.output_text;

  const chunks = [];
  for (const item of json?.output || []) {
    for (const part of item?.content || []) {
      if (typeof part?.text === 'string') chunks.push(part.text);
      if (typeof part?.content === 'string') chunks.push(part.content);
    }
  }
  return chunks.join('\n').trim();
}

export async function generateText({
  system,
  prompt,
  model = DEFAULT_MODEL,
  maxOutputTokens,
} = {}) {
  if (!prompt) throw new Error('OpenAI text generation requires a prompt.');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set. Add it to .env before generating posts.');
  }

  const input = system
    ? [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ]
    : prompt;

  const body = {
    model,
    input,
  };
  if (maxOutputTokens) body.max_output_tokens = maxOutputTokens;

  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    const summary = summarizeApiError(text);
    throw new Error(`OpenAI Responses API ${res.status}${summary ? `: ${summary}` : ''}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('OpenAI Responses API returned a non-JSON response.');
  }

  const generated = outputText(json);
  if (!generated) throw new Error('OpenAI Responses API returned empty output.');

  return {
    text: generated,
    model,
    id: json.id || null,
  };
}
