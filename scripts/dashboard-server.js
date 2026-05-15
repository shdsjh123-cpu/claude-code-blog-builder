#!/usr/bin/env node
/**
 * 로컬 전용 블로그 대시보드 HTTP 서버.
 *
 *   npm run dashboard          # http://localhost:3000
 *   PORT=4000 npm run dashboard
 *   npm run dashboard -- --no-open
 *
 * 외부 의존성 없이 Node 내장 http 만 사용합니다.
 *
 * 핵심 안전 조건 (이 파일이 보장합니다):
 *   - 127.0.0.1 에만 바인딩 — LAN 의 다른 사람이 접근 불가
 *   - Host 헤더 검증 — DNS rebinding 방어
 *   - 변경 요청에 X-Local-Dashboard 헤더 강제 — 일반 form CSRF 차단
 *   - 모든 폴더 경로는 safe-path.js 로 output/ 하위인지 검증 후 사용
 *   - spawn 호출은 항상 shell:false + args 배열 — 명령 인젝션 차단
 *   - 동시에 하나의 job 만 실행 (job-runner.js 가 강제)
 *   - 네이버 자격증명·API 키는 어떤 응답에도 포함되지 않음 (이 서버는 .env 를 읽지도 않음)
 *   - 자동 발행 기능 없음 — naver-draft 는 기존 CLI 그대로 호출됨
 */

import './lib/env.js';

import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import {
  ConcurrencyError,
  getActiveJobId,
  getJob,
  listJobs,
  startJob,
  subscribeSse,
} from './lib/job-runner.js';
import { safeOutputPath, relativeFromRoot } from './lib/safe-path.js';
import { openInOS } from './lib/open-os.js';
import { outputFolderForKeyword } from './lib/slug.js';
import {
  MissingApiKeyError,
  compareKeywords,
  recommendKeywords,
} from './lib/naver-keyword-api.js';

const PROJECT_ROOT = process.cwd();
const DASHBOARD_DIR = resolve(PROJECT_ROOT, 'dashboard');
const OUTPUT_DIR = resolve(PROJECT_ROOT, 'output');

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';

const args = parseCliArgs(process.argv);
const AUTO_OPEN = !args['no-open'];

const ALLOWED_TYPES = new Set([
  'infidelity',
  'people-search',
  'cost',
  'evidence',
  'general',
]);

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

// ─────────────────────────── 서버 ───────────────────────────

const server = createServer(async (req, res) => {
  try {
    if (!isHostAllowed(req.headers.host)) {
      sendJson(res, 403, { error: 'forbidden host' });
      return;
    }

    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const path = url.pathname;
    const method = req.method || 'GET';

    // 상태 변경 요청은 X-Local-Dashboard 헤더 강제 (간단한 CSRF 방어)
    if (method !== 'GET' && method !== 'HEAD') {
      if (req.headers['x-local-dashboard'] !== '1') {
        sendJson(res, 403, { error: 'missing X-Local-Dashboard header' });
        return;
      }
    }

    // ─── API 라우팅 ───
    if (path === '/api/active' && method === 'GET') {
      return handleActive(res);
    }
    if (path === '/api/jobs' && method === 'GET') {
      return sendJson(res, 200, { jobs: listJobs() });
    }
    if (path.startsWith('/api/jobs/') && path.endsWith('/stream') && method === 'GET') {
      const id = path.slice('/api/jobs/'.length, -'/stream'.length);
      return subscribeSse(id, res);
    }
    if (path.startsWith('/api/jobs/') && method === 'GET') {
      const id = path.slice('/api/jobs/'.length);
      const job = getJob(id);
      if (!job) return sendJson(res, 404, { error: 'job not found' });
      return sendJson(res, 200, job);
    }
    if (path === '/api/jobs/blog-auto' && method === 'POST') {
      const body = await readJsonBody(req);
      return handleBlogAuto(res, body);
    }
    if (path === '/api/jobs/naver-draft' && method === 'POST') {
      const body = await readJsonBody(req);
      return handleNaverDraft(res, body);
    }
    if (path === '/api/folders' && method === 'GET') {
      return handleListFolders(res);
    }
    if (path === '/api/folders/open' && method === 'POST') {
      const body = await readJsonBody(req);
      return handleOpenFolder(res, body);
    }
    if (path === '/api/keywords/recommend' && method === 'POST') {
      const body = await readJsonBody(req);
      return handleKeywordRecommend(res, body);
    }
    if (path === '/api/keywords/compare' && method === 'POST') {
      const body = await readJsonBody(req);
      return handleKeywordCompare(res, body);
    }

    // ─── output/ 정적 파일 (미리보기 + 이미지) ───
    if (path.startsWith('/files/') && (method === 'GET' || method === 'HEAD')) {
      return serveOutputFile(res, decodeURIComponent(path.slice('/files/'.length)), method);
    }

    // ─── dashboard/ 정적 파일 ───
    if (method === 'GET' || method === 'HEAD') {
      const file = path === '/' ? 'index.html' : path.slice(1);
      return serveDashboardFile(res, file, method);
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    if (err && err.code === 'BODY_TOO_LARGE') {
      sendJson(res, 413, { error: 'body too large' });
      return;
    }
    if (err && err.code === 'INVALID_JSON') {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    console.error('[dashboard] handler error:', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`\n📊 범랑 자동화 블로그 (localhost 전용)`);
  console.log(`   ${url}`);
  console.log(`   Ctrl+C 로 종료\n`);
  if (AUTO_OPEN) {
    openInOS(url);
  }
});

// ─────────────────────────── 핸들러 ───────────────────────────

function handleActive(res) {
  const id = getActiveJobId();
  if (!id) return sendJson(res, 200, { active: null });
  return sendJson(res, 200, { active: getJob(id) });
}

async function handleBlogAuto(res, body) {
  const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : '';
  const type = typeof body?.type === 'string' ? body.type.trim() : 'general';

  if (!keyword || keyword.length > 80) {
    return sendJson(res, 400, { error: 'keyword must be 1-80 chars' });
  }
  if (hasControlChars(keyword)) {
    return sendJson(res, 400, { error: 'keyword has control characters' });
  }
  if (!ALLOWED_TYPES.has(type)) {
    return sendJson(res, 400, {
      error: 'invalid type',
      allowed: [...ALLOWED_TYPES],
    });
  }

  const folderRel = outputFolderForKeyword(keyword);
  const folderAbs = safeOutputPath(folderRel);
  if (!folderAbs) {
    return sendJson(res, 400, { error: 'derived folder is outside output/' });
  }

  try {
    const job = startJob({
      kind: 'blog-auto',
      label: `${keyword} / ${type}`,
      args: [
        'scripts/blog-auto.js',
        '--keyword',
        keyword,
        '--type',
        type,
        '--output',
        folderRel,
      ],
      folder: folderRel,
    });
    return sendJson(res, 202, { job });
  } catch (err) {
    if (err instanceof ConcurrencyError) {
      return sendJson(res, 409, { error: err.message, activeId: err.activeId });
    }
    throw err;
  }
}

async function handleNaverDraft(res, body) {
  const folder = typeof body?.folder === 'string' ? body.folder.trim() : '';
  const abs = safeOutputPath(folder);
  if (!abs || abs === OUTPUT_DIR) {
    return sendJson(res, 400, { error: 'folder must be inside output/' });
  }
  // 폴더가 실제로 존재하고 디렉터리인지 확인
  let stats;
  try {
    stats = await stat(abs);
  } catch {
    return sendJson(res, 404, { error: 'folder not found' });
  }
  if (!stats.isDirectory()) {
    return sendJson(res, 400, { error: 'folder is not a directory' });
  }

  const folderRel = relativeFromRoot(abs);

  try {
    const job = startJob({
      kind: 'naver-draft',
      label: folderRel,
      args: ['scripts/naver-draft.js', '--folder', folderRel],
      folder: folderRel,
    });
    return sendJson(res, 202, { job });
  } catch (err) {
    if (err instanceof ConcurrencyError) {
      return sendJson(res, 409, { error: err.message, activeId: err.activeId });
    }
    throw err;
  }
}

async function handleListFolders(res) {
  let entries;
  try {
    entries = await readdir(OUTPUT_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return sendJson(res, 200, { folders: [] });
    throw err;
  }

  const folders = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const abs = join(OUTPUT_DIR, entry.name);
    let stats;
    try {
      stats = await stat(abs);
    } catch {
      continue;
    }
    const relPath = `output/${entry.name}`;
    const previewExists = await fileExists(join(abs, 'preview.html'));
    const postExists = await fileExists(join(abs, 'post.html'));
    folders.push({
      name: entry.name,
      path: relPath,
      mtime: stats.mtimeMs,
      hasPreview: previewExists,
      hasPost: postExists,
    });
  }
  folders.sort((a, b) => b.mtime - a.mtime);

  sendJson(res, 200, { folders });
}

async function handleOpenFolder(res, body) {
  const folder = typeof body?.folder === 'string' ? body.folder.trim() : '';
  const abs = safeOutputPath(folder);
  if (!abs) {
    return sendJson(res, 400, { error: 'folder must be inside output/' });
  }
  let stats;
  try {
    stats = await stat(abs);
  } catch {
    return sendJson(res, 404, { error: 'folder not found' });
  }
  if (!stats.isDirectory()) {
    return sendJson(res, 400, { error: 'folder is not a directory' });
  }
  const ok = openInOS(abs);
  sendJson(res, ok ? 200 : 500, { opened: ok, folder: relativeFromRoot(abs) });
}

async function handleKeywordRecommend(res, body) {
  const input = typeof body?.keyword === 'string' ? body.keyword : '';
  const keywords = parseKeywordInput(input);
  if (!keywords.length) {
    return sendJson(res, 400, { error: 'keyword must be 1-80 chars' });
  }
  for (const keyword of keywords) {
    if (keyword.length > 80) {
      return sendJson(res, 400, { error: 'each keyword must be 1-80 chars' });
    }
    if (hasControlChars(keyword)) {
      return sendJson(res, 400, { error: 'keyword has control characters' });
    }
  }
  if (keywords.length > 20) {
    return sendJson(res, 400, { error: 'too many keywords (max 20)' });
  }
  const limit = Number.isFinite(body?.limit) ? body.limit : 20;

  try {
    const longtailMode =
      keywords.length > 1 || keywords.some((keyword) => /\s/.test(keyword));
    const items = longtailMode
      ? mergeKeywordItems(await compareKeywords(keywords))
      : mergeKeywordItems(await recommendKeywords(keywords[0], { limit }));
    return sendJson(res, 200, { keyword: keywords.join(', '), keywords, items });
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return sendJson(res, 412, {
        error: err.message,
        code: 'MISSING_API_KEY',
      });
    }
    console.error('[dashboard] keyword recommend failed:', err);
    return sendJson(res, 502, { error: err.message || 'upstream error' });
  }
}

function parseKeywordInput(raw) {
  const seen = new Set();
  const keywords = [];
  for (const part of String(raw || '').split(/[\r\n,;]+/)) {
    const keyword = part.trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
  }
  return keywords;
}

function mergeKeywordItems(items) {
  const seen = new Set();
  const merged = [];
  for (const item of items || []) {
    const keyword = String(item?.keyword || '').trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...item, keyword });
  }
  merged.sort((a, b) => {
    if (a.kgr === null && b.kgr === null) return 0;
    if (a.kgr === null) return 1;
    if (b.kgr === null) return -1;
    return a.kgr - b.kgr;
  });
  return merged;
}

async function handleKeywordCompare(res, body) {
  const raw = Array.isArray(body?.keywords) ? body.keywords : null;
  if (!raw) {
    return sendJson(res, 400, { error: 'keywords must be an array' });
  }
  const keywords = [];
  for (const k of raw) {
    if (typeof k !== 'string') continue;
    const t = k.trim();
    if (!t) continue;
    if (t.length > 80) {
      return sendJson(res, 400, { error: 'each keyword must be ≤ 80 chars' });
    }
    if (hasControlChars(t)) {
      return sendJson(res, 400, { error: 'keyword has control characters' });
    }
    keywords.push(t);
  }
  if (!keywords.length) {
    return sendJson(res, 400, { error: 'no valid keywords' });
  }
  if (keywords.length > 20) {
    return sendJson(res, 400, { error: 'too many keywords (max 20)' });
  }

  try {
    const items = await compareKeywords(keywords);
    return sendJson(res, 200, { items });
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return sendJson(res, 412, {
        error: err.message,
        code: 'MISSING_API_KEY',
      });
    }
    console.error('[dashboard] keyword compare failed:', err);
    return sendJson(res, 502, { error: err.message || 'upstream error' });
  }
}

// ─────────────────────────── 정적 파일 ───────────────────────────

async function serveDashboardFile(res, relFile, method) {
  if (!isSafeStaticPath(relFile)) {
    return sendJson(res, 400, { error: 'invalid path' });
  }
  const abs = resolve(DASHBOARD_DIR, relFile);
  if (!abs.startsWith(DASHBOARD_DIR)) {
    return sendJson(res, 400, { error: 'invalid path' });
  }
  await sendFile(res, abs, method);
}

async function serveOutputFile(res, relFile, method) {
  if (!isSafeStaticPath(relFile)) {
    return sendJson(res, 400, { error: 'invalid path' });
  }
  const abs = resolve(OUTPUT_DIR, relFile);
  if (!abs.startsWith(OUTPUT_DIR + '/') && !abs.startsWith(OUTPUT_DIR + '\\')) {
    return sendJson(res, 400, { error: 'outside output/' });
  }
  await sendFile(res, abs, method);
}

async function sendFile(res, abs, method) {
  let data;
  try {
    data = await readFile(abs);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      return sendJson(res, 404, { error: 'not found' });
    }
    throw err;
  }
  const mime = STATIC_MIME[extname(abs).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': mime,
    'content-length': data.length,
    'cache-control': 'no-store',
  });
  if (method === 'HEAD') res.end();
  else res.end(data);
}

// ─────────────────────────── 유틸 ───────────────────────────

function isHostAllowed(host) {
  if (!host) return false;
  // host = "localhost:3000" 형태
  const lower = host.toLowerCase();
  const allowed = [
    `localhost:${PORT}`,
    `127.0.0.1:${PORT}`,
    // 기본 포트(:80/:443) 같은 변형은 발생하지 않음 — 강제 PORT 사용
  ];
  return allowed.includes(lower);
}

function isSafeStaticPath(p) {
  if (!p) return false;
  if (p.includes('\0')) return false;
  if (p.includes('..')) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  return true;
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function hasControlChars(s) {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req) {
  const MAX = 64 * 1024; // 64KB
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        const err = new Error('body too large');
        err.code = 'BODY_TOO_LARGE';
        req.destroy();
        rejectPromise(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolvePromise({});
      const buf = Buffer.concat(chunks).toString('utf8');
      try {
        resolvePromise(buf ? JSON.parse(buf) : {});
      } catch {
        const err = new Error('invalid JSON');
        err.code = 'INVALID_JSON';
        rejectPromise(err);
      }
    });
    req.on('error', rejectPromise);
  });
}

function parseCliArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

process.on('SIGINT', () => {
  console.log('\n대시보드 종료');
  server.close(() => process.exit(0));
});
