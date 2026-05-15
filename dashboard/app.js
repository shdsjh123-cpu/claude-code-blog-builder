// 로컬 대시보드 클라이언트.
// 모든 API 요청에 X-Local-Dashboard: 1 헤더를 강제합니다 (서버의 CSRF 가드).

const API_HEADERS = {
  'content-type': 'application/json',
  'x-local-dashboard': '1',
};

const $ = (sel) => document.querySelector(sel);

const els = {
  form: $('#create-form'),
  keyword: $('#keyword'),
  type: $('#type'),
  submitBtn: $('#submit-btn'),
  formStatus: $('#form-status'),
  log: $('#log'),
  jobBadge: $('#job-badge'),
  clearLogBtn: $('#clear-log-btn'),
  folders: $('#folders'),
  refreshFoldersBtn: $('#refresh-folders-btn'),
  toast: $('#toast'),
  recommendForm: $('#recommend-form'),
  hintKeyword: $('#hint-keyword'),
  recommendLimit: $('#recommend-limit'),
  recommendBtn: $('#recommend-btn'),
  recommendStatus: $('#recommend-status'),
  recommendResults: $('#recommend-results'),
  goldenOnly: $('#golden-only'),
};

let lastRecommend = [];

let currentEs = null;
let toastTimer = null;

// ───── UI helpers ─────

function toast(msg, kind = 'ok') {
  els.toast.textContent = msg;
  els.toast.className = `toast show${kind === 'ok' ? '' : ' ' + kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 2200);
}

function appendLog(line, stream) {
  const span = document.createElement('span');
  if (stream === 'stderr') span.className = 'err';
  span.textContent = line + '\n';
  els.log.appendChild(span);
  els.log.scrollTop = els.log.scrollHeight;
}

function clearLog() {
  els.log.textContent = '';
}

function setBadge(text, kind) {
  els.jobBadge.textContent = text;
  els.jobBadge.className = `badge${kind ? ' ' + kind : ''}`;
}

function setFormBusy(busy) {
  els.submitBtn.disabled = busy;
  els.keyword.disabled = busy;
  els.type.disabled = busy;
}

// ───── API ─────

async function api(method, path, body) {
  const opts = { method, headers: { ...API_HEADERS } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  if (!res.ok) {
    throw new Error((json && json.error) || `HTTP ${res.status}`);
  }
  return json;
}

// ───── 작업 제출 ─────

async function submitCreate(e) {
  e.preventDefault();
  const keyword = els.keyword.value.trim();
  const type = els.type.value;
  if (!keyword) return;

  setFormBusy(true);
  els.formStatus.textContent = '요청 보내는 중...';
  els.formStatus.className = 'hint';

  try {
    const resp = await api('POST', '/api/jobs/blog-auto', { keyword, type });
    clearLog();
    appendLog(`[dashboard] 작업 시작: ${resp.job.label}`, 'stdout');
    appendLog(`[dashboard] 결과 폴더: ${resp.job.folder}`, 'stdout');
    attachJob(resp.job);
    els.formStatus.textContent = `생성 시작됨 — ${resp.job.folder}`;
    els.formStatus.className = 'hint ok';
  } catch (err) {
    setFormBusy(false);
    els.formStatus.textContent = `실패: ${err.message}`;
    els.formStatus.className = 'hint error';
    toast(err.message, 'error');
  }
}

// ───── SSE 구독 ─────

function attachJob(job) {
  if (currentEs) {
    currentEs.close();
    currentEs = null;
  }
  setBadge(`${job.kind} · 실행 중`, 'running');
  setFormBusy(true);

  const es = new EventSource(`/api/jobs/${job.id}/stream`);
  currentEs = es;

  es.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.type === 'log') appendLog(m.line, m.stream);
    } catch { /* noop */ }
  };

  es.addEventListener('done', (e) => {
    let payload = {};
    try { payload = JSON.parse(e.data); } catch { /* noop */ }
    es.close();
    currentEs = null;
    const ok = payload.status === 'completed';
    setBadge(`${job.kind} · ${ok ? '완료' : '실패'}`, ok ? 'completed' : 'failed');
    appendLog(
      `[dashboard] 작업 종료 — status=${payload.status}, exitCode=${payload.exitCode}`,
      ok ? 'stdout' : 'stderr'
    );
    setFormBusy(false);
    refreshFolders();
    toast(ok ? '작업 완료' : '작업 실패', ok ? 'ok' : 'error');
  });

  es.onerror = () => {
    appendLog('[dashboard] SSE 연결 끊김', 'stderr');
  };
}

// ───── 폴더 리스트 ─────

async function refreshFolders() {
  try {
    const { folders } = await api('GET', '/api/folders');
    renderFolders(folders);
  } catch (err) {
    toast(`폴더 목록 실패: ${err.message}`, 'error');
  }
}

function renderFolders(folders) {
  els.folders.textContent = '';
  if (!folders.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '아직 생성된 폴더가 없습니다.';
    els.folders.appendChild(li);
    return;
  }
  for (const f of folders) {
    els.folders.appendChild(renderFolder(f));
  }
}

function renderFolder(f) {
  const li = document.createElement('li');
  li.className = 'folder';

  const row = document.createElement('div');
  row.className = 'row';

  const left = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = f.name;
  const path = document.createElement('div');
  path.className = 'path';
  path.textContent = f.path;
  left.appendChild(name);
  left.appendChild(path);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const previewBtn = document.createElement('button');
  previewBtn.className = 'ghost small';
  previewBtn.type = 'button';
  previewBtn.textContent = '미리보기 열기';
  if (!f.hasPreview) {
    previewBtn.disabled = true;
    previewBtn.title = 'preview.html 없음';
  } else {
    previewBtn.addEventListener('click', () => {
      const rel = f.path.replace(/^output\//, '');
      const url = `/files/${rel.split('/').map(encodeURIComponent).join('/')}/preview.html`;
      window.open(url, '_blank', 'noopener');
    });
  }
  actions.appendChild(previewBtn);

  const openBtn = document.createElement('button');
  openBtn.className = 'ghost small';
  openBtn.type = 'button';
  openBtn.textContent = '폴더 열기';
  openBtn.addEventListener('click', async () => {
    try {
      await api('POST', '/api/folders/open', { folder: f.path });
      toast('폴더를 열었습니다');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  actions.appendChild(openBtn);

  const naverBtn = document.createElement('button');
  naverBtn.className = 'primary small';
  naverBtn.type = 'button';
  naverBtn.textContent = '네이버 글쓰기 입력';
  naverBtn.addEventListener('click', async () => {
    const msg =
      `"${f.path}" 의 글을 네이버 글쓰기 화면에 자동 입력합니다.\n\n` +
      `• 발행 버튼은 절대 누르지 않습니다.\n` +
      `• 네이버 로그인 창이 뜨면 직접 로그인하세요.\n\n계속할까요?`;
    if (!confirm(msg)) return;
    try {
      const resp = await api('POST', '/api/jobs/naver-draft', { folder: f.path });
      clearLog();
      appendLog(`[dashboard] naver-draft 시작: ${resp.job.label}`, 'stdout');
      attachJob(resp.job);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  actions.appendChild(naverBtn);

  row.appendChild(left);
  row.appendChild(actions);
  li.appendChild(row);
  return li;
}

// ───── 초기 로드: 활성 job 있으면 재연결 ─────

async function bootstrap() {
  try {
    const { active } = await api('GET', '/api/active');
    if (active) {
      appendLog(`[dashboard] 진행 중 작업에 재연결: ${active.label}`, 'stdout');
      attachJob(active);
    }
  } catch { /* noop */ }
  refreshFolders();
}

// ───── 이벤트 바인딩 ─────

els.form.addEventListener('submit', submitCreate);
els.clearLogBtn.addEventListener('click', clearLog);
els.refreshFoldersBtn.addEventListener('click', refreshFolders);
els.recommendForm.addEventListener('submit', submitRecommend);
els.goldenOnly.addEventListener('change', renderFilteredRecommend);
bootstrap();

// ───── 키워드 추천 ─────

async function submitRecommend(e) {
  e.preventDefault();
  const keywords = parseKeywordInput(els.hintKeyword.value);
  if (!keywords.length) return;
  const limit = Number(els.recommendLimit.value) || 20;

  els.recommendBtn.disabled = true;
  els.hintKeyword.disabled = true;
  els.recommendLimit.disabled = true;
  els.recommendResults.textContent = '';
  els.recommendStatus.textContent =
    `검색광고 API + 블로그 발행량 조회 중... (${keywords.length}개 키워드, 최대 ${limit}개 후보, 10~60초 소요)`;
  els.recommendStatus.className = 'hint';

  try {
    const resp = await api('POST', '/api/keywords/recommend', {
      keyword: keywords.join('\n'),
      limit,
    });
    lastRecommend = mergeKeywordItems(resp.items || []);
    renderFilteredRecommend();
  } catch (err) {
    lastRecommend = [];
    els.recommendResults.textContent = '';
    els.recommendStatus.textContent = `실패: ${err.message}`;
    els.recommendStatus.className = 'hint error';
    toast(err.message, 'error');
  } finally {
    els.recommendBtn.disabled = false;
    els.hintKeyword.disabled = false;
    els.recommendLimit.disabled = false;
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

function renderFilteredRecommend() {
  const goldenOnly = els.goldenOnly.checked;
  const filtered = goldenOnly
    ? lastRecommend.filter((it) => it.kgr !== null && it.kgr < 1)
    : lastRecommend;
  renderRecommendTable(filtered);

  if (!lastRecommend.length) {
    els.recommendStatus.textContent = '연관 키워드를 찾지 못했습니다.';
    els.recommendStatus.className = 'hint';
    return;
  }
  const goldenCount = lastRecommend.filter(
    (it) => it.kgr !== null && it.kgr < 0.25
  ).length;
  const normalCount = lastRecommend.filter(
    (it) => it.kgr !== null && it.kgr >= 0.25 && it.kgr < 1
  ).length;
  const hardCount = lastRecommend.filter(
    (it) => it.kgr !== null && it.kgr >= 1
  ).length;

  if (goldenOnly) {
    els.recommendStatus.textContent =
      `필터: 경쟁도 낮음만 — ${filtered.length}/${lastRecommend.length}개 표시 ` +
      `(🟢 골든 ${goldenCount} · 🟡 보통 ${normalCount} · 🔴 경쟁심함 ${hardCount} 중)`;
  } else {
    els.recommendStatus.textContent =
      `${lastRecommend.length}개 후보 — 🟢 골든 ${goldenCount} · 🟡 보통 ${normalCount} · 🔴 경쟁심함 ${hardCount} (KGR 낮은 순)`;
  }
  els.recommendStatus.className = 'hint ok';
}

function mergeKeywordItems(items) {
  const seen = new Set();
  const merged = [];
  for (const item of items) {
    const keyword = String(item.keyword || '').trim();
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

function renderRecommendTable(items) {
  els.recommendResults.textContent = '';
  if (!items.length) return;

  const table = document.createElement('table');
  table.className = 'kw-table';

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  ['키워드', '월간 검색', '블로그 발행량', 'KGR', '경쟁', ''].forEach((label, i) => {
    const th = document.createElement('th');
    th.textContent = label;
    if (i >= 1 && i <= 3) th.className = 'num';
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const it of items) {
    tbody.appendChild(renderRecommendRow(it));
  }
  table.appendChild(tbody);
  els.recommendResults.appendChild(table);
}

function renderRecommendRow(it) {
  const tr = document.createElement('tr');
  tr.className = `kgr-row-${it.kgrLabel}`;

  const tdKw = document.createElement('td');
  tdKw.className = 'kw';
  tdKw.textContent = it.keyword;
  if (it.source === 'input') {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = '입력 키워드';
    tdKw.appendChild(note);
  }
  if (it.adError) {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = `⚠ ${it.adError}`;
    tdKw.appendChild(note);
  }
  tr.appendChild(tdKw);

  const tdSearch = document.createElement('td');
  tdSearch.className = 'num';
  if (it.monthlySearchTotal === 0 && it.adError) {
    tdSearch.textContent = '—';
  } else {
    tdSearch.textContent = (it.monthlySearchTotal || 0).toLocaleString();
  }
  tr.appendChild(tdSearch);

  const tdBlog = document.createElement('td');
  tdBlog.className = 'num';
  if (it.blogCount === null) {
    tdBlog.textContent = '—';
    if (it.blogError) tdBlog.title = it.blogError;
  } else {
    tdBlog.textContent = it.blogCount.toLocaleString();
  }
  tr.appendChild(tdBlog);

  const tdKgr = document.createElement('td');
  tdKgr.className = `num kgr-cell ${it.kgrLabel}`;
  tdKgr.textContent = it.kgr === null ? '—' : it.kgr.toFixed(3);
  tr.appendChild(tdKgr);

  const tdComp = document.createElement('td');
  tdComp.textContent = it.compIdx || '—';
  tr.appendChild(tdComp);

  const tdAction = document.createElement('td');
  tdAction.className = 'actions-cell';

  const useBtn = document.createElement('button');
  useBtn.type = 'button';
  useBtn.className = 'ghost small';
  useBtn.textContent = '이 키워드로 생성';
  useBtn.addEventListener('click', () => {
    els.keyword.value = it.keyword;
    els.keyword.scrollIntoView({ behavior: 'smooth', block: 'center' });
    els.keyword.focus();
    toast(`키워드 적용: ${it.keyword}`);
  });
  tdAction.appendChild(useBtn);
  tr.appendChild(tdAction);

  return tr;
}
