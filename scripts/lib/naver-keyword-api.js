/**
 * 네이버 API 두 종류를 묶어 "키워드 추천"을 제공합니다.
 *
 *   - 검색광고 API (api.searchad.naver.com)
 *       메인 키워드 → 연관 키워드 후보 + 월간 검색량(수요)
 *       HMAC-SHA256 서명 필요.
 *
 *   - 검색 Open API (openapi.naver.com)
 *       각 키워드별 블로그 검색 결과 총 개수(발행량/공급)
 *
 * KGR(Keyword Golden Ratio) = 발행량 / 월간 검색량 으로 정렬합니다.
 * 값이 작을수록 경쟁이 약하다는 신호 (수요 대비 글이 적음).
 */

import { createHmac } from 'node:crypto';

const SEARCHAD_BASE = 'https://api.searchad.naver.com';
const OPEN_API_BASE = 'https://openapi.naver.com';

export class MissingApiKeyError extends Error {
  constructor(message) {
    super(message);
    this.code = 'MISSING_API_KEY';
  }
}

// ─────────────────────────── 검색광고 API ───────────────────────────

function searchAdHeaders(method, uri) {
  const apiKey = process.env.NAVER_SEARCHAD_API_KEY;
  const secret = process.env.NAVER_SEARCHAD_SECRET_KEY;
  const customer = process.env.NAVER_SEARCHAD_CUSTOMER_ID;

  if (!apiKey || !secret || !customer) {
    throw new MissingApiKeyError(
      '네이버 검색광고 API 키가 .env 에 설정되지 않았습니다 ' +
        '(NAVER_SEARCHAD_API_KEY / NAVER_SEARCHAD_SECRET_KEY / NAVER_SEARCHAD_CUSTOMER_ID)'
    );
  }
  if (
    apiKey.startsWith('YOUR_') ||
    secret.startsWith('YOUR_') ||
    customer.startsWith('YOUR_')
  ) {
    throw new MissingApiKeyError(
      '.env 의 NAVER_SEARCHAD_* 값이 placeholder 그대로입니다. 실제 발급 값을 채워주세요.'
    );
  }

  const timestamp = String(Date.now());
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${method}.${uri}`)
    .digest('base64');

  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Timestamp': timestamp,
    'X-API-KEY': apiKey,
    'X-Customer': customer,
    'X-Signature': signature,
  };
}

/**
 * 메인 키워드를 힌트로 연관 키워드 후보를 가져옵니다.
 *
 * @returns Array<{ keyword, monthlySearchPc, monthlySearchMobile, monthlySearchTotal, compIdx }>
 */
export async function fetchRelatedKeywords(hintKeyword, opts = {}) {
  const limit = clampInt(opts.limit, 1, 100, 20);
  const uri = '/keywordstool';
  // 사용자가 입력한 구문을 하나의 키워드로 유지하되, 네이버 검색광고 API 의
  // hintKeywords 형식에 맞춰 호출 직전에만 공백을 제거합니다.
  // "합법 탐정추천"은 "합법" + "탐정추천"으로 쪼개지 않고 "합법탐정추천"으로 조회합니다.
  const trimmed = String(hintKeyword).trim();
  const hint = trimmed.replace(/\s+/g, '');
  // URLSearchParams 는 공백을 '+' 로 인코딩하지만 네이버는 %20 기대 → 직접 인코딩.
  const qs = `hintKeywords=${encodeURIComponent(hint)}&showDetail=1`;
  const url = `${SEARCHAD_BASE}${uri}?${qs}`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: searchAdHeaders('GET', uri),
  });
  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 400);
    throw new Error(`검색광고 API 오류 (${resp.status}): ${body}`);
  }
  const data = await resp.json();
  const list = Array.isArray(data && data.keywordList) ? data.keywordList : [];

  return list.slice(0, limit).map((row) => {
    const pc = parseNaverCount(row.monthlyPcQcCnt);
    const mob = parseNaverCount(row.monthlyMobileQcCnt);
    return {
      keyword: String(row.relKeyword || '').trim(),
      monthlySearchPc: pc,
      monthlySearchMobile: mob,
      monthlySearchTotal: pc + mob,
      compIdx: row.compIdx || null, // '낮음' | '중간' | '높음' | null
    };
  });
}

// ─────────────────────────── 검색 Open API ───────────────────────────

function openApiHeaders() {
  const cid = process.env.NAVER_CLIENT_ID;
  const csec = process.env.NAVER_CLIENT_SECRET;
  if (!cid || !csec) {
    throw new MissingApiKeyError(
      '네이버 검색 API 키가 .env 에 설정되지 않았습니다 (NAVER_CLIENT_ID / NAVER_CLIENT_SECRET)'
    );
  }
  if (cid.startsWith('YOUR_') || csec.startsWith('YOUR_')) {
    throw new MissingApiKeyError(
      '.env 의 NAVER_CLIENT_* 값이 placeholder 그대로입니다.'
    );
  }
  return {
    'X-Naver-Client-Id': cid,
    'X-Naver-Client-Secret': csec,
  };
}

/**
 * 특정 키워드의 블로그 검색 결과 총 개수 = 그 키워드의 "발행량".
 */
export async function fetchBlogPostCount(keyword) {
  const url =
    `${OPEN_API_BASE}/v1/search/blog.json` +
    `?query=${encodeURIComponent(keyword)}&display=1`;
  const resp = await fetch(url, { headers: openApiHeaders() });
  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 400);
    throw new Error(`검색 API 오류 (${resp.status}): ${body}`);
  }
  const data = await resp.json();
  return Number(data && data.total) || 0;
}

// ─────────────────────────── 종합 추천 ───────────────────────────

/**
 * 메인 키워드를 받아 추천 키워드 표를 만듭니다.
 *
 * 절차:
 *   1) 검색광고 API → 연관 키워드 + 월간 검색량
 *   2) 각 후보를 검색 API 로 블로그 발행량 조회 (concurrency 제한)
 *   3) KGR = 발행량 / 월간 검색량 계산
 *   4) KGR 오름차순 정렬 (null 은 뒤로)
 */
export async function recommendKeywords(hintKeyword, opts = {}) {
  const limit = clampInt(opts.limit, 1, 50, 20);
  const concurrency = clampInt(opts.concurrency, 1, 8, 4);

  const rawRelated = await fetchRelatedKeywords(hintKeyword, {
    limit: Math.max(limit, 100),
  });
  const seedItems = [await buildInputKeywordItem(hintKeyword, rawRelated)];
  const related = filterRelatedKeywordsForInput(
    rawRelated.filter((item) => normalizeKeyword(item.keyword) !== normalizeKeyword(hintKeyword)),
    hintKeyword
  ).slice(0, limit);

  const enriched = await mapLimit(related, concurrency, async (item) => {
    let blogCount = null;
    let blogError = null;
    try {
      blogCount = await fetchBlogPostCount(item.keyword);
    } catch (err) {
      blogError = err.message;
    }
    const kgr =
      blogCount !== null && item.monthlySearchTotal > 0
        ? blogCount / item.monthlySearchTotal
        : null;
    return {
      ...item,
      blogCount,
      blogError,
      kgr,
      kgrLabel: classifyKgr(kgr),
    };
  });

  const combined = mergeKeywordItems([...seedItems, ...enriched]);
  combined.sort((a, b) => {
    if (a.kgr === null && b.kgr === null) return 0;
    if (a.kgr === null) return 1;
    if (b.kgr === null) return -1;
    return a.kgr - b.kgr;
  });

  return combined;
}

async function buildInputKeywordItem(keyword, related) {
  const normalized = normalizeKeyword(keyword);
  const exact = related.find((item) => normalizeKeyword(item.keyword) === normalized);
  let blogCount = null;
  let blogError = null;
  try {
    blogCount = await fetchBlogPostCount(keyword);
  } catch (err) {
    blogError = err.message;
  }

  const monthlySearchPc = exact ? exact.monthlySearchPc : null;
  const monthlySearchMobile = exact ? exact.monthlySearchMobile : null;
  const monthlySearchTotal =
    (monthlySearchPc || 0) + (monthlySearchMobile || 0);
  const kgr =
    blogCount !== null && monthlySearchTotal > 0
      ? blogCount / monthlySearchTotal
      : null;

  return {
    keyword,
    monthlySearchPc,
    monthlySearchMobile,
    monthlySearchTotal,
    compIdx: exact ? exact.compIdx : null,
    adError: exact
      ? null
      : '정확한 매칭 없음 (네이버가 별도 키워드로 분류하지 않는 표기)',
    blogCount,
    blogError,
    kgr,
    kgrLabel: classifyKgr(kgr),
    source: 'input',
  };
}

/**
 * 사용자가 직접 입력한 여러 키워드(롱테일 포함)의 경쟁도를 한 번에 측정합니다.
 *
 *   - 각 키워드를 검색광고 API 에 hint 로 1번씩 보내, 응답에서 정확히 일치하는
 *     항목을 찾아 월간 검색량·경쟁 강도 추출
 *   - 검색 API 로 블로그 발행량 조회
 *   - KGR = 발행량 / 월간 검색량
 *
 *   "탐정 비용 산정 기준" 같은 띄어쓰기 포함 입력은 네이버 내부 표기인
 *   "탐정비용산정기준"으로 normalize 한 뒤 매칭합니다.
 *
 * 정확한 매칭이 안 되면 adError = 'no-exact-match' 로 표시되어 표에서
 * 사용자가 확인할 수 있습니다.
 */
export async function compareKeywords(keywords, opts = {}) {
  const concurrency = clampInt(opts.concurrency, 1, 4, 3);

  // 입력 정규화 — 빈 값/중복 제거, 최대 20개
  const seen = new Set();
  const cleaned = [];
  for (const raw of keywords || []) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    const key = trimmed.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(trimmed);
    if (cleaned.length >= 20) break;
  }
  if (!cleaned.length) return [];

  const items = await mapLimit(cleaned, concurrency, async (kw) => {
    const normalized = kw.replace(/\s+/g, '').toLowerCase();

    let monthlySearchPc = null;
    let monthlySearchMobile = null;
    let compIdx = null;
    let adError = null;
    let blogCount = null;
    let blogError = null;

    // 1) 검색량 + 경쟁 강도 (단일 hint)
    try {
      const list = await fetchRelatedKeywords(kw, { limit: 100 });
      const exact = list.find((r) => r.keyword.toLowerCase() === normalized);
      if (exact) {
        monthlySearchPc = exact.monthlySearchPc;
        monthlySearchMobile = exact.monthlySearchMobile;
        compIdx = exact.compIdx;
      } else {
        adError = '정확한 매칭 없음 (네이버가 별도 키워드로 분류하지 않는 표기)';
      }
    } catch (err) {
      adError = err.message;
    }

    // 2) 블로그 발행량
    try {
      blogCount = await fetchBlogPostCount(kw);
    } catch (err) {
      blogError = err.message;
    }

    const monthlySearchTotal =
      (monthlySearchPc || 0) + (monthlySearchMobile || 0);
    const kgr =
      blogCount !== null && monthlySearchTotal > 0
        ? blogCount / monthlySearchTotal
        : null;

    return {
      keyword: kw,
      monthlySearchPc,
      monthlySearchMobile,
      monthlySearchTotal,
      compIdx,
      adError,
      blogCount,
      blogError,
      kgr,
      kgrLabel: classifyKgr(kgr),
    };
  });

  return items;
}

// ─────────────────────────── 내부 ───────────────────────────

function classifyKgr(kgr) {
  if (kgr === null) return 'unknown';
  if (kgr < 0.25) return 'golden';
  if (kgr < 1.0) return 'normal';
  return 'hard';
}

function filterRelatedKeywordsForInput(items, rawKeyword) {
  const terms = String(rawKeyword || '')
    .trim()
    .split(/\s+/)
    .map(normalizeKeyword)
    .filter(Boolean);
  if (terms.length <= 1) return items;

  return items.filter((item) => {
    const keyword = normalizeKeyword(item.keyword);
    return terms.every((term) => keyword.includes(term));
  });
}

function mergeKeywordItems(items) {
  const seen = new Set();
  const merged = [];
  for (const item of items || []) {
    const keyword = String(item?.keyword || '').trim();
    if (!keyword) continue;
    const key = normalizeKeyword(keyword);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...item, keyword });
  }
  return merged;
}

function normalizeKeyword(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function parseNaverCount(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    // "< 10" 같은 형식
    const m = v.match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return 0;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  };
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return out;
}
