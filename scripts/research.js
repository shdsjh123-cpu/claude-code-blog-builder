#!/usr/bin/env node
/**
 * 네이버 Search API 리서치 래퍼.
 * Usage:
 *   node scripts/research.js --keyword "상세페이지 AI" [--output output/folder]
 *
 * 환경변수: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
 * 미설정 시 명확한 에러 + 종료. (웹 검색 대체는 Claude가 수동 수행)
 */

import './lib/env.js';

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

async function naverSearch(kind, query, display = 30, sort = 'sim') {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET not set. Set them in .env.'
    );
  }
  const url = `https://openapi.naver.com/v1/search/${kind}?query=${encodeURIComponent(
    query
  )}&display=${display}&sort=${sort}`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': id,
      'X-Naver-Client-Secret': secret,
    },
  });
  const json = await res.json();
  if (!res.ok || json.errorCode) {
    throw new Error(
      `Naver API error (${kind}): ${json.errorMessage || res.status}`
    );
  }
  return json;
}

const stripTags = (s) => (s || '').replace(/<[^>]+>/g, '');

function competitionLevel(total) {
  if (total >= 100000) return '높음 (10만+)';
  if (total >= 30000) return '보통 (3만+)';
  return '낮음 (3만 미만)';
}

function extractRelatedWords(items, mainKeyword) {
  const stop = new Set([
    '그리고',
    '있는',
    '위한',
    '통해',
    '대한',
    '되는',
    '하는',
    '입니다',
    '합니다',
  ]);
  const counts = new Map();
  for (const it of items) {
    const t = stripTags(it.title);
    const words = t.split(/\s+/).filter((w) => w.length >= 2 && !stop.has(w));
    for (const w of words) {
      if (w.includes(mainKeyword)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([w, c]) => ({ word: w, count: c }));
}

function recentRatio(items, days = 30) {
  const now = Date.now();
  const cutoff = now - days * 24 * 3600 * 1000;
  const recent = items.filter((it) => {
    if (!it.postdate) return false;
    // postdate 형식: YYYYMMDD
    const y = it.postdate.slice(0, 4);
    const m = it.postdate.slice(4, 6);
    const d = it.postdate.slice(6, 8);
    const t = new Date(`${y}-${m}-${d}`).getTime();
    return t >= cutoff;
  });
  return items.length ? (recent.length / items.length) * 100 : 0;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.keyword) {
    console.error('Usage: --keyword "키워드" [--output dir]');
    process.exit(2);
  }

  const keyword = args.keyword;
  console.log(`\n🔎 네이버 리서치: "${keyword}"`);

  let blogRecent, blogCount, cafe;
  try {
    blogRecent = await naverSearch('blog', keyword, 30, 'date');
    blogCount = await naverSearch('blog', keyword, 1, 'sim');
    cafe = await naverSearch('cafearticle', keyword, 20, 'sim');
  } catch (e) {
    console.error(`\n❌ ${e.message}`);
    console.error(
      '→ 웹 검색 기반 수동 리서치로 대체하거나, .env의 키를 갱신하세요.'
    );
    process.exit(1);
  }

  const totalBlog = blogCount.total || 0;
  const totalCafe = cafe.total || 0;
  const related = extractRelatedWords(blogRecent.items || [], keyword);
  const recent = recentRatio(blogRecent.items || []);

  const report = {
    keyword,
    fetched_at: new Date().toISOString(),
    blog: {
      total: totalBlog,
      competition: competitionLevel(totalBlog),
      recent_30d_ratio_percent: Number(recent.toFixed(1)),
      recent_titles: (blogRecent.items || [])
        .slice(0, 15)
        .map((it) => ({
          title: stripTags(it.title),
          postdate: it.postdate,
          bloggername: it.bloggername,
        })),
    },
    cafe: {
      total: totalCafe,
      sample_titles: (cafe.items || [])
        .slice(0, 10)
        .map((it) => stripTags(it.title)),
    },
    related_keywords: related,
    longtail_suggestions: related
      .slice(0, 8)
      .map((r) => `${keyword} ${r.word}`),
  };

  // 콘솔 출력
  console.log(`\n📊 경쟁도`);
  console.log(`  블로그 전체: ${totalBlog.toLocaleString()}건 → ${report.blog.competition}`);
  console.log(`  카페 전체:   ${totalCafe.toLocaleString()}건`);
  console.log(`  최근 30일 비율: ${report.blog.recent_30d_ratio_percent}%`);

  console.log(`\n🏷  연관 키워드 TOP`);
  related.slice(0, 10).forEach((r) => console.log(`  - ${r.word} (${r.count})`));

  console.log(`\n💡 롱테일 제안`);
  report.longtail_suggestions.forEach((s) => console.log(`  - ${s}`));

  console.log(`\n📰 상위 최근 글 제목`);
  report.blog.recent_titles
    .slice(0, 10)
    .forEach((t) => console.log(`  - ${t.title} (${t.postdate})`));

  // 파일 저장
  if (args.output) {
    await mkdir(args.output, { recursive: true });
    const path = join(args.output, 'research.json');
    await writeFile(path, JSON.stringify(report, null, 2));
    console.log(`\n리포트 저장: ${path}`);
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
