#!/usr/bin/env node
/**
 * 블로그 발행 어시스턴트.
 * 작성된 글 폴더를 받아서 self-contained HTML 미리보기를 생성하고 브라우저로 엽니다.
 *
 * Usage:
 *   node scripts/preview.js --folder output/2026-04-08_my-keyword [--no-open]
 *
 * 생성: <folder>/preview.html
 * 기능:
 *   - 제목/태그/메타설명 카드 (각각 복사 버튼)
 *   - 섹션별 복사 버튼 (서식 포함 / 텍스트만 두 가지 모드)
 *   - 이미지 갤러리 (개별 다운로드 + 일괄 다운로드)
 *   - 발행 체크리스트
 */

import './lib/env.js';

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

const escapeHtmlAttr = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const escapeJs = (s) =>
  String(s)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

// post.html 을 <h2> 단위로 섹션 분할
function splitSections(html) {
  const sections = [];
  // 첫 h1 + 도입부를 한 섹션으로
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';

  // h2 기준으로 split
  const parts = html.split(/(?=<h2[^>]*>)/);
  for (const part of parts) {
    const h2 = part.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const heading = h2 ? h2[1].replace(/<[^>]+>/g, '').trim() : '도입부';
    sections.push({ heading, html: part.trim() });
  }
  return { title, sections };
}

// HTML 정규화 — 네이버 스마트에디터 페이스트 친화 (h1 제거, h2/h3는 굵은 단락, 표는 텍스트 단락)
function normalizeForPaste(html) {
  let out = html;

  // 표를 텍스트 단락으로 변환
  out = out.replace(/<table[\s\S]*?<\/table>/gi, (tbl) => {
    const rows = [];
    const trMatches = tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const tr of trMatches) {
      const cells = [];
      const cellMatches = tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi);
      for (const c of cellMatches) {
        cells.push(c[1].replace(/<[^>]+>/g, '').trim());
      }
      if (cells.length) rows.push(cells.join(' | '));
    }
    return (
      '<p><strong>[표]</strong></p>' +
      rows.map((r) => `<p>${r}</p>`).join('') +
      '<p><br></p>'
    );
  });

  // h1 제거 (제목은 별도 입력)
  out = out.replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '');
  // h2/h3 → 굵은 단락
  out = out.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '<p><br></p><p><strong>$1</strong></p>');
  out = out.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '<p><strong>$1</strong></p>');
  // hr 제거
  out = out.replace(/<hr\s*\/?>/gi, '<p><br></p>');
  // 연속 빈 단락 정리
  out = out.replace(/(<p><br><\/p>\s*){3,}/gi, '<p><br></p><p><br></p>');

  return out.trim();
}

// HTML → 네이버 친화 plain text (태그 제거, 표는 텍스트 그리드로)
function htmlToPlain(html) {
  return html
    .replace(/<table[\s\S]*?<\/table>/gi, (tbl) => {
      // 표를 텍스트 그리드로 변환
      const rows = [];
      const trMatches = tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      for (const tr of trMatches) {
        const cells = [];
        const cellMatches = tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi);
        for (const c of cellMatches) {
          cells.push(c[1].replace(/<[^>]+>/g, '').trim());
        }
        rows.push(cells.join(' | '));
      }
      return '\n[표]\n' + rows.join('\n') + '\n';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderPreviewHtml({ folder, title, meta, sections, images }) {
  // 데이터를 인덱스 기반으로 — onclick에 HTML 직접 박지 않음 (스크립트 깨짐 방지)
  const sectionsData = sections.map((s) => ({
    heading: s.heading,
    pasteHtml: normalizeForPaste(s.html),
    plain: htmlToPlain(s.html),
  }));

  const sectionsHtml = sections
    .map((s, i) => `
<div class="section">
  <div class="section-head">
    <div class="section-title-row">
      <span class="section-num">${i + 1}</span>
      <h3>${escapeHtmlAttr(s.heading)}</h3>
    </div>
    <div class="section-actions">
      <button onclick="copyRich(${i}, this)">📋 서식 포함 복사</button>
      <button onclick="copyPlain(${i}, this)">📝 텍스트만 복사</button>
    </div>
  </div>
  <div class="section-body">${s.html}</div>
</div>`)
    .join('\n');

  const metaInline = {
    title: title,
    description: meta.meta_description || '',
    tags: (meta.tags || []).map((t) => '#' + t).join(' '),
  };

  const imagesHtml = images
    .map(
      (img, i) => `
<div class="img-card">
  <img src="images/${escapeHtmlAttr(img)}" alt="${escapeHtmlAttr(img)}" />
  <div class="img-meta">
    <span>${i + 1}. ${escapeHtmlAttr(img)}</span>
    <a href="images/${escapeHtmlAttr(img)}" download="${escapeHtmlAttr(img)}">⬇ 다운로드</a>
  </div>
</div>`
    )
    .join('\n');

  const tagsHtml = (meta.tags || [])
    .map((t) => `<span class="tag">#${escapeHtmlAttr(t)}</span>`)
    .join(' ');

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>발행 어시스턴트 — ${escapeHtmlAttr(title)}</title>
  <style>
    :root {
      --bg: #f7f6f2;
      --card: #ffffff;
      --fg: #1a1a1a;
      --muted: #6b6b6b;
      --accent: #d97a3a;
      --border: #e7e5dd;
      --ok: #2d8a4e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; min-width: 0; }
    html, body { width: 100%; overflow-x: hidden; }
    body {
      font-family: 'Pretendard', 'Apple SD Gothic Neo', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.7;
      word-break: keep-all;
      overflow-wrap: anywhere;
    }

    /* ───── Topbar ───── */
    .topbar {
      position: sticky;
      top: 0;
      background: var(--fg);
      color: var(--bg);
      padding: 14px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      z-index: 100;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .topbar h1 {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.02em;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .topbar .brand { font-size: 11px; opacity: 0.7; letter-spacing: 0.15em; flex-shrink: 0; }

    /* ───── Layout ───── */
    main {
      max-width: 1320px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      gap: 24px;
      align-items: start;
    }
    @media (max-width: 1100px) {
      main { grid-template-columns: minmax(0, 1fr); }
      .col-side { order: -1; }
    }
    @media (max-width: 600px) {
      main { padding: 16px; gap: 16px; }
      .topbar { padding: 12px 16px; }
    }
    .col-main { min-width: 0; }
    .col-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

    /* ───── Cards ───── */
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      min-width: 0;
    }
    .card h2 {
      font-size: 12px;
      letter-spacing: 0.08em;
      color: var(--accent);
      margin-bottom: 14px;
      text-transform: uppercase;
      font-weight: 700;
    }

    /* ───── Meta rows ───── */
    .meta-row { margin-bottom: 18px; }
    .meta-row:last-child { margin-bottom: 0; }
    .meta-row label {
      display: block;
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 6px;
      font-weight: 600;
    }
    .meta-row .val {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .meta-row .val .text {
      font-size: 14px;
      line-height: 1.5;
      color: var(--fg);
    }
    .meta-row .val .tags-wrap { display: flex; flex-wrap: wrap; gap: 4px; }

    /* ───── Buttons ───── */
    button, .btn {
      background: var(--fg);
      color: var(--bg);
      border: none;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s, transform 0.1s;
    }
    button:hover { background: var(--accent); }
    button:active { transform: scale(0.97); }
    button.copied { background: var(--ok) !important; }
    .btn-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .btn-row button { flex: 0 0 auto; }
    .btn-self { align-self: flex-start; }

    /* ───── Tags ───── */
    .tag {
      display: inline-block;
      padding: 4px 10px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 99px;
      font-size: 12px;
      color: var(--muted);
    }

    /* ───── Sections ───── */
    .section {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .section-head {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 18px 22px 16px;
      background: #fafaf6;
      border-bottom: 1px solid var(--border);
    }
    .section-title-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      width: 100%;
    }
    .section-num {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--accent);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .section-head h3 {
      flex: 1;
      min-width: 0;
      font-size: 17px;
      font-weight: 700;
      line-height: 1.45;
      color: var(--fg);
      word-break: keep-all;
      overflow-wrap: anywhere;
    }
    .section-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      width: 100%;
    }
    .section-actions button {
      flex: 1 1 auto;
      min-width: 140px;
    }

    /* ───── Section body ───── */
    .section-body {
      padding: 24px;
      font-size: 15px;
    }
    .section-body > * { max-width: 100%; }
    .section-body h1 {
      font-size: 22px;
      margin-bottom: 14px;
      line-height: 1.4;
    }
    .section-body h2 {
      font-size: 18px;
      margin: 22px 0 12px;
      color: var(--fg);
      text-transform: none;
      letter-spacing: 0;
      line-height: 1.4;
    }
    .section-body p {
      margin-bottom: 14px;
    }
    .section-body strong, .section-body b {
      font-weight: 700;
      color: var(--fg);
    }
    .section-body ul, .section-body ol {
      padding-left: 22px;
      margin-bottom: 14px;
    }
    .section-body li { margin-bottom: 6px; }

    /* Tables — 가로 스크롤 가능하게 wrapping */
    .section-body table {
      display: block;
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 14px;
      white-space: normal;
    }
    .section-body th, .section-body td {
      border: 1px solid var(--border);
      padding: 8px 12px;
      text-align: left;
      vertical-align: top;
    }
    .section-body th {
      background: var(--bg);
      font-weight: 700;
    }

    /* ───── Image gallery ───── */
    .img-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 12px;
    }
    .img-card:last-child { margin-bottom: 0; }
    .img-card img {
      width: 100%;
      height: auto;
      display: block;
      background: #eee;
      max-height: 240px;
      object-fit: contain;
    }
    .img-meta {
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: var(--muted);
      border-top: 1px solid var(--border);
      gap: 8px;
    }
    .img-meta span {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .img-meta a {
      color: var(--accent);
      font-weight: 700;
      text-decoration: none;
      flex-shrink: 0;
    }
    .download-all {
      width: 100%;
      padding: 12px;
      font-size: 13px;
      margin-bottom: 14px;
    }

    /* ───── Checklist ───── */
    .checklist label {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 0;
      font-size: 14px;
      cursor: pointer;
      border-bottom: 1px dashed var(--border);
      line-height: 1.5;
    }
    .checklist label:last-child { border-bottom: none; padding-bottom: 0; }
    .checklist label:first-of-type { padding-top: 0; }
    .checklist input[type=checkbox] {
      margin-top: 3px;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      accent-color: var(--accent);
      cursor: pointer;
    }
    .checklist input:checked + span {
      text-decoration: line-through;
      color: var(--muted);
    }

    /* ───── Toast ───── */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--ok);
      color: white;
      padding: 12px 22px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.25s;
      pointer-events: none;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .toast.show { opacity: 1; transform: translateY(0); }

    /* ───── Section count badge ───── */
    .section-count {
      display: inline-block;
      background: var(--bg);
      color: var(--muted);
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 99px;
      margin-left: 8px;
      vertical-align: middle;
    }
  </style>
</head>
<body>
  <div class="topbar">
    <h1>📰 발행 어시스턴트 — ${escapeHtmlAttr(folder)}</h1>
    <span class="brand">${escapeHtmlAttr(process.env.BRAND_NAME || 'BLOG')}</span>
  </div>

  <main>
    <div class="col-main">
      ${sectionsHtml}
    </div>

    <div class="col-side">
      <div class="card">
        <h2>📋 메타데이터</h2>
        <div class="meta-row">
          <label>제목 (${title.length}자)</label>
          <div class="val">
            <div class="text">${escapeHtmlAttr(title)}</div>
            <button class="btn-self" onclick="copyMeta('title', this)">📋 제목 복사</button>
          </div>
        </div>
        ${
          meta.meta_description
            ? `
        <div class="meta-row">
          <label>메타 설명 (${meta.meta_description.length}자)</label>
          <div class="val">
            <div class="text">${escapeHtmlAttr(meta.meta_description)}</div>
            <button class="btn-self" onclick="copyMeta('description', this)">📋 메타설명 복사</button>
          </div>
        </div>`
            : ''
        }
        <div class="meta-row">
          <label>태그 ${(meta.tags || []).length}개</label>
          <div class="val">
            <div class="tags-wrap">${tagsHtml}</div>
            <button class="btn-self" onclick="copyMeta('tags', this)">📋 태그 전체 복사</button>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>🖼 이미지 ${images.length}장</h2>
        <button class="download-all" onclick="downloadAll()">⬇ 4장 일괄 다운로드</button>
        ${imagesHtml}
      </div>

      <div class="card checklist">
        <h2>✅ 발행 체크리스트</h2>
        <label><input type="checkbox"><span>제목 입력</span></label>
        <label><input type="checkbox"><span>카테고리 선택</span></label>
        <label><input type="checkbox"><span>본문 단락 복사·붙여넣기 (위에서부터 순서대로)</span></label>
        <label><input type="checkbox"><span>표는 스마트에디터에서 직접 생성</span></label>
        <label><input type="checkbox"><span>이미지 4장 본문에 업로드</span></label>
        <label><input type="checkbox"><span>썸네일 = 대표 이미지로 등록</span></label>
        <label><input type="checkbox"><span>태그 10개 입력</span></label>
        <label><input type="checkbox"><span>맞춤법 검사</span></label>
        <label><input type="checkbox"><span>모바일 미리보기 확인</span></label>
        <label><input type="checkbox"><span>발행 (자동 발행 금지, 사람 검수 필수)</span></label>
      </div>
    </div>
  </main>

  <div class="toast" id="toast">복사됨!</div>

  <script id="bootData" type="application/json">${JSON.stringify({ sections: sectionsData, meta: metaInline, images }).replace(/<\/script/gi, '<\\/script')}</script>
  <script>
    const BOOT = JSON.parse(document.getElementById('bootData').textContent);
    const SECTIONS = BOOT.sections;
    const META = BOOT.meta;
    const IMAGES = BOOT.images;

    function showToast(msg, ok = true) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.background = ok ? 'var(--ok)' : '#c53030';
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 1800);
    }

    function flashBtn(btn) {
      const orig = btn.textContent;
      btn.classList.add('copied');
      btn.textContent = '✓ 복사됨';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = orig;
      }, 1800);
    }

    /**
     * 핵심: 숨긴 contentEditable div 에 HTML 넣고
     * 선택한 뒤 execCommand('copy') — 네이버 스마트에디터에
     * 서식(볼드/단락/리스트)이 가장 잘 붙는 방식.
     */
    function copyHtmlRich(html) {
      const container = document.createElement('div');
      container.contentEditable = 'true';
      container.innerHTML = html;
      container.style.position = 'fixed';
      container.style.left = '-99999px';
      container.style.top = '0';
      container.style.opacity = '0';
      container.style.whiteSpace = 'pre-wrap';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      let success = false;
      try {
        success = document.execCommand('copy');
      } catch (e) {
        success = false;
      }

      sel.removeAllRanges();
      document.body.removeChild(container);
      return success;
    }

    function copyPlainText(text) {
      // 1차: clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackPlain(text));
      }
      return Promise.resolve(fallbackPlain(text));
    }

    function fallbackPlain(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-99999px';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
      return ok;
    }

    function copyRich(idx, btn) {
      const s = SECTIONS[idx];
      const ok = copyHtmlRich(s.pasteHtml);
      if (ok) {
        flashBtn(btn);
        showToast('서식 포함 복사 완료 — 스마트에디터에 붙여넣으세요');
      } else {
        showToast('복사 실패 — 텍스트만 모드로 다시 시도해주세요', false);
      }
    }

    async function copyPlain(idx, btn) {
      const s = SECTIONS[idx];
      const ok = await copyPlainText(s.plain);
      if (ok) {
        flashBtn(btn);
        showToast('텍스트 복사 완료');
      } else {
        showToast('복사 실패', false);
      }
    }

    async function copyMeta(key, btn) {
      const text = META[key] || '';
      const ok = await copyPlainText(text);
      if (ok) {
        flashBtn(btn);
        showToast('복사 완료');
      } else {
        showToast('복사 실패', false);
      }
    }

    async function downloadAll() {
      for (const img of IMAGES) {
        const a = document.createElement('a');
        a.href = 'images/' + img;
        a.download = img;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        await new Promise((r) => setTimeout(r, 250));
      }
      showToast('이미지 ' + IMAGES.length + '장 다운로드 시작');
    }
  </script>
</body>
</html>`;
}

function openInBrowser(filePath) {
  const p = platform();
  let cmd, args;
  if (p === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', filePath];
  } else if (p === 'darwin') {
    cmd = 'open';
    args = [filePath];
  } else {
    cmd = 'xdg-open';
    args = [filePath];
  }
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.folder) {
    console.error('Usage: --folder <output폴더경로> [--no-open]');
    process.exit(2);
  }

  const folder = args.folder.replace(/[\\/]+$/, '');
  const folderName = basename(folder);

  // 파일 로드
  let postHtml, meta, images;
  try {
    postHtml = await readFile(join(folder, 'post.html'), 'utf8');
  } catch {
    console.error(`❌ ${folder}/post.html 을 찾을 수 없습니다.`);
    process.exit(1);
  }

  try {
    meta = JSON.parse(await readFile(join(folder, 'metadata.json'), 'utf8'));
  } catch {
    meta = { tags: [] };
    console.warn('⚠️  metadata.json 없음 — 빈 메타로 진행');
  }

  try {
    const all = await readdir(join(folder, 'images'));
    images = all.filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort();
  } catch {
    images = [];
    console.warn('⚠️  images/ 폴더 없음');
  }

  const { title, sections } = splitSections(postHtml);
  const usedTitle = meta.title || title;

  const previewHtml = renderPreviewHtml({
    folder: folderName,
    title: usedTitle,
    meta,
    sections,
    images,
  });

  const outPath = join(folder, 'preview.html');
  await writeFile(outPath, previewHtml);
  console.log(`\n✅ 미리보기 생성: ${outPath}`);
  console.log(`   섹션 ${sections.length}개 / 이미지 ${images.length}장 / 태그 ${(meta.tags || []).length}개`);

  if (!args['no-open']) {
    const ok = openInBrowser(outPath);
    if (ok) {
      console.log(`\n🌐 브라우저로 열었습니다.`);
    } else {
      console.log(`\n수동으로 열어주세요: file://${outPath.replace(/\\/g, '/')}`);
    }
  }

  console.log(`\n💡 사용법:`);
  console.log(`   1. 메타데이터 카드에서 제목·태그 복사 → 스마트에디터에 입력`);
  console.log(`   2. 본문 섹션을 위에서부터 순서대로 "서식 포함 복사" → 붙여넣기`);
  console.log(`   3. 이미지 4장 일괄 다운로드 → 본문에 업로드`);
  console.log(`   4. 체크리스트 따라가며 발행`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
