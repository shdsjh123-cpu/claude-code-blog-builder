import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const envPath = resolve(root, '.env');

function parseEnvValue(raw) {
  let value = raw.trim();
  if (value.length < 2) return value;

  const quote = value[0];
  const last = value[value.length - 1];
  if ((quote === '"' || quote === "'") && last === quote) {
    value = value.slice(1, -1);
  }

  if (quote === '"') {
    value = value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  return value;
}

export function loadEnv() {
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;

    process.env[key] = parseEnvValue(trimmed.slice(eq + 1));
  }
}

loadEnv();
