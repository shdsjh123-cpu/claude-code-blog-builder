#!/usr/bin/env node
/**
 * 블로그 품질 검증기 — 네이버 저품질 트리거 사전 검사.
 * Usage: node scripts/quality-check.js --file post.html [--keyword "병원 마케팅"]
 */

import './lib/env.js';

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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

const stripHtml = (s) =>
  s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

const DEFAULT_BANNED = ['최고', '최저', '최상', '무조건', '100%', '절대', '완벽'];
const CONJUNCTIONS = ['또한', '그리고', '더불어', '아울러'];

function defaultBannedConfig() {
  return {
    source: 'hardcoded-defaults',
    categories: {
      superlatives: {
        reason: '네이버 저품질 트리거 + 과장 광고',
        words: DEFAULT_BANNED,
      },
    },
  };
}

async function loadBannedConfig() {
  const candidates = [
    { path: 'knowledge/banned-words.json', source: 'knowledge/banned-words.json' },
    {
      path: 'knowledge/banned-words.template.json',
      source: 'knowledge/banned-words.template.json',
    },
  ];

  for (const candidate of candidates) {
    try {
      const json = JSON.parse(await readFile(candidate.path, 'utf8'));
      return { source: candidate.source, categories: json.categories || {} };
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.warn(`⚠️  ${candidate.path} 로드 실패 — fallback 사용: ${e.message}`);
      }
    }
  }

  return defaultBannedConfig();
}

function flattenWords(categories) {
  const words = [];
  for (const [category, cfg] of Object.entries(categories || {})) {
    for (const word of cfg?.words || []) {
      words.push({
        word: String(word),
        category,
        reason: cfg.reason || category,
        replacement: cfg?.replacements?.[word] || replacementFor(word),
      });
    }
  }
  return words;
}

function flattenPatterns(categories) {
  const patterns = [];
  const invalid = [];

  for (const [category, cfg] of Object.entries(categories || {})) {
    for (const pattern of cfg?.patterns || []) {
      try {
        patterns.push({
          pattern: String(pattern),
          regex: new RegExp(pattern, 'g'),
          category,
          reason: cfg.reason || category,
          replacement: replacementFor(pattern),
        });
      } catch (e) {
        invalid.push({ category, pattern: String(pattern), error: e.message });
      }
    }
  }

  return { patterns, invalid };
}

function contextFor(text, index, length) {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + length + 24);
  return text.slice(start, end).trim();
}

function replacementFor(expression) {
  const normalized = String(expression).replace(/\\/g, '');
  if (normalized.includes('위치')) {
    return '합법적인 범위 내에서 동선 확인 가능 여부를 상담';
  }
  if (normalized.includes('개인정보')) {
    return '공개 정보와 의뢰인이 제공한 자료를 바탕으로 확인';
  }
  if (normalized.includes('통신')) {
    return '의뢰인이 적법하게 보유한 자료 범위에서 확인';
  }
  if (normalized.includes('해킹') || normalized.includes('계정')) {
    return '의뢰인이 제공한 자료만 합법적인 범위에서 검토';
  }
  if (normalized.includes('촬영') || normalized.includes('몰카')) {
    return '법적 문제가 없는 자료 수집 범위를 확인';
  }
  if (normalized.includes('100%') || normalized.includes('무조건') || normalized.includes('반드시')) {
    return '상황에 따라 필요한 자료를 정리';
  }
  if (normalized.includes('승소') || normalized.includes('소송')) {
    return '법률 판단은 변호사 상담이 필요';
  }
  if (normalized.includes('변호사')) {
    return '필요 시 변호사 상담과 병행';
  }
  if (normalized.includes('경찰')) {
    return '민간조사 범위 내에서 신속하게 자료를 정리';
  }
  return '합법적인 범위와 사실관계에 맞는 완곡한 표현으로 수정';
}

function findBannedHits(text, bannedConfig) {
  const hits = [];
  const seen = new Set();

  for (const item of flattenWords(bannedConfig.categories)) {
    let index = text.indexOf(item.word);
    while (index !== -1) {
      const key = `word:${item.word}:${index}`;
      const locationKey = `${item.word}:${index}`;
      if (!seen.has(key) && !seen.has(locationKey)) {
        seen.add(key);
        seen.add(locationKey);
        hits.push({
          expression: item.word,
          type: item.reason,
          category: item.category,
          context: contextFor(text, index, item.word.length),
          replacement: item.replacement,
        });
      }
      index = text.indexOf(item.word, index + item.word.length);
    }
  }

  const { patterns, invalid } = flattenPatterns(bannedConfig.categories);
  for (const item of patterns) {
    for (const match of text.matchAll(item.regex)) {
      const expression = match[0];
      const index = match.index || 0;
      const key = `pattern:${item.pattern}:${index}:${expression}`;
      const locationKey = `${expression}:${index}`;
      if (seen.has(key) || seen.has(locationKey)) continue;
      seen.add(key);
      seen.add(locationKey);
      hits.push({
        expression,
        type: item.reason,
        category: item.category,
        context: contextFor(text, index, expression.length),
        replacement: item.replacement,
      });
    }
  }

  return { hits, invalidPatterns: invalid };
}

function formatBannedDetail(hits, invalidPatterns) {
  if (!hits.length && !invalidPatterns.length) return '없음';

  const parts = hits.slice(0, 6).map((h, i) => {
    return `${i + 1}. 위험 표현: "${h.expression}" | 위험 유형: ${h.category} | 문맥: "${h.context}" | 대체: "${h.replacement}"`;
  });

  if (hits.length > 6) parts.push(`외 ${hits.length - 6}건`);
  if (invalidPatterns.length) {
    parts.push(`무시된 잘못된 정규식 ${invalidPatterns.length}건`);
  }

  return parts.join(' / ');
}

function check(text, raw, keyword, bannedConfig) {
  const results = [];
  const charCount = text.replace(/\s/g, '').length;

  // 1. 글자수
  results.push({
    name: '글자수',
    pass: charCount >= 1500,
    detail: `공백제외 ${charCount}자 (목표 ≥ 1500)`,
  });

  // 2. 키워드 밀도
  if (keyword) {
    const occurrences = (
      text.match(new RegExp(escapeRe(keyword), 'g')) || []
    ).length;
    const totalWords = text.length / 2; // 한국어 대략 추정 (글자÷2)
    const density = (occurrences / totalWords) * 100;
    const ok = occurrences >= 5 && occurrences <= 12;
    results.push({
      name: '키워드 빈도',
      pass: ok,
      detail: `"${keyword}" ${occurrences}회 (권장 5~12회), 추정밀도 ${density.toFixed(2)}%`,
    });
  }

  // 3. 반복 어미
  const sentences = text.split(/[.!?。]\s*/).filter((s) => s.length > 5);
  let maxRun = 1;
  let runEnding = '';
  let cur = 1;
  let prev = '';
  for (const s of sentences) {
    const ending = s.trim().slice(-3);
    if (ending && ending === prev) {
      cur++;
      if (cur > maxRun) {
        maxRun = cur;
        runEnding = ending;
      }
    } else {
      cur = 1;
    }
    prev = ending;
  }
  results.push({
    name: '문장 어미 반복',
    pass: maxRun < 3,
    detail:
      maxRun >= 3
        ? `"${runEnding}" 어미 ${maxRun}회 연속 — 변주 필요`
        : '연속 3회 이상 동일 어미 없음',
  });

  // 4. 이미지 마커
  const imgMarkers = (raw.match(/\[IMAGE:/g) || []).length;
  results.push({
    name: '이미지 마커',
    pass: imgMarkers >= 3,
    detail: `[IMAGE:] ${imgMarkers}개 (권장 ≥ 4)`,
  });

  // 5. 외부 링크
  const links = raw.match(/https?:\/\/[^\s"'<>)]+/g) || [];
  results.push({
    name: '외부 링크',
    pass: links.length === 0,
    detail:
      links.length === 0
        ? '외부 링크 없음'
        : `${links.length}개 발견 (저품질 트리거): ${links.slice(0, 3).join(', ')}`,
  });

  // 6. 금칙어
  const banned = findBannedHits(text, bannedConfig);
  results.push({
    name: '최상급/금칙어',
    pass: banned.hits.length === 0 && banned.invalidPatterns.length === 0,
    detail: formatBannedDetail(banned.hits, banned.invalidPatterns),
    hits: banned.hits,
    invalidPatterns: banned.invalidPatterns,
    source: bannedConfig.source,
  });

  // 7. 접속사 비율
  const conjCount = CONJUNCTIONS.reduce(
    (n, c) => n + (text.match(new RegExp(c, 'g')) || []).length,
    0
  );
  const conjRatio = sentences.length
    ? (conjCount / sentences.length) * 100
    : 0;
  results.push({
    name: '접속사 비율',
    pass: conjRatio <= 5,
    detail: `${conjCount}회 / ${sentences.length}문장 = ${conjRatio.toFixed(1)}% (목표 ≤ 5%)`,
  });

  return { charCount, sentences: sentences.length, results };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage: --file <path> [--keyword <kw>]');
    process.exit(2);
  }

  const raw = await readFile(args.file, 'utf8');
  const isHtml = /<[a-z][\s\S]*>/i.test(raw);
  const text = isHtml ? stripHtml(raw) : raw;
  const bannedConfig = await loadBannedConfig();

  const report = check(text, raw, args.keyword, bannedConfig);

  console.log(`\n📋 블로그 품질 리포트`);
  console.log(`파일: ${args.file}`);
  console.log(`형식: ${isHtml ? 'HTML' : 'Markdown/Text'}`);
  console.log(`금칙어 소스: ${bannedConfig.source}`);
  console.log(`총 ${report.sentences}문장, 공백제외 ${report.charCount}자\n`);

  let warnings = 0;
  for (const r of report.results) {
    const mark = r.pass ? '✅ PASS' : '⚠️  WARN';
    console.log(`${mark}  ${r.name.padEnd(14)} — ${r.detail}`);
    if (!r.pass) warnings++;
  }
  console.log(
    `\n결과: ${warnings === 0 ? '모든 검사 통과' : `${warnings}개 경고`}\n`
  );

  const reportPath = join(dirname(args.file), 'quality-report.json');
  await writeFile(
    reportPath,
    JSON.stringify(
      { file: args.file, keyword: args.keyword || null, ...report },
      null,
      2
    )
  );
  console.log(`리포트 저장: ${reportPath}`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
