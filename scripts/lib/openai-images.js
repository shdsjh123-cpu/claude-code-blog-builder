import './env.js';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const DEFAULT_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';

function summarizeApiError(text) {
  if (!text) return '';

  try {
    const json = JSON.parse(text);
    const message = json?.error?.message || json?.message;
    if (message) return String(message).slice(0, 500);
  } catch {
    // Fall back to plain response text.
  }

  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function findBase64Image(json) {
  const direct = json?.data?.[0]?.b64_json;
  if (direct) return direct;

  const nested = json?.data?.[0]?.image?.b64_json;
  if (nested) return nested;

  const responseOutput = json?.output || [];
  for (const item of responseOutput) {
    const content = item?.content || [];
    for (const part of content) {
      if (part?.b64_json) return part.b64_json;
      if (part?.image?.b64_json) return part.image.b64_json;
    }
  }

  return null;
}

export async function generateOpenAIImage({
  prompt,
  outputPath,
  size = '1536x1024',
  quality = 'auto',
} = {}) {
  if (!prompt) {
    throw new Error('OpenAI image generation requires a prompt.');
  }
  if (!outputPath) {
    throw new Error('OpenAI image generation requires an outputPath.');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set. Add it to .env before generating OpenAI images.'
    );
  }

  const body = {
    model: DEFAULT_MODEL,
    prompt,
    n: 1,
    size,
    quality,
    output_format: 'png',
  };

  const res = await fetch(OPENAI_IMAGES_URL, {
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
    throw new Error(
      `OpenAI Images API ${res.status}${summary ? `: ${summary}` : ''}`
    );
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('OpenAI Images API returned a non-JSON response.');
  }

  const b64 = findBase64Image(json);
  if (!b64) {
    throw new Error('OpenAI Images API response did not include base64 image data.');
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const buf = Buffer.from(b64, 'base64');
  await writeFile(outputPath, buf);

  return {
    outputPath,
    bytes: buf.length,
    model: DEFAULT_MODEL,
    size,
    quality,
  };
}
