#!/usr/bin/env node
/**
 * 내 블로그 글끼리의 유사도 검사 (네이버 유사문서 판정 회피).
 * 셰이글(n-gram) 기반 Jaccard 유사도 계산.
 *
 * Usage:
 *   node scripts/duplicate-check.js --file output/2026-04-08_X/post.md [--threshold 25]
 *
 * 비교 대상: output/ 하위의 다른 post.md 파일 전부
 * 임계값: 기본 25% (Jaccard). 초과 시 경고, 종료코드는 0 유지.
 */

import './lib/env.js';

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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

const stripHtmlAndMd = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*`>|_\-]/g, ' ')
    .replace(/\[IMAGE:[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function shingles(text, n = 6) {
  // 한국어: 공백 제거 후 n-글자 단위 셰이글
  const s = text.replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i <= s.length - n; i++) {
    set.add(s.slice(i, i + n));
  }
  return set;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return (inter / union) * 100;
}

async function findPosts(root) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && e.name === 'post.md') {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage: --file <path> [--threshold 25]');
    process.exit(2);
  }
  const threshold = Number(args.threshold || 25);
  const target = resolve(args.file);

  const raw = await readFile(target, 'utf8');
  const targetShingles = shingles(stripHtmlAndMd(raw));

  const allPosts = await findPosts('output');
  const others = allPosts.filter((p) => resolve(p) !== target);

  if (!others.length) {
    console.log('비교 대상 없음 (첫 글이거나 output/ 비어있음).');
    return;
  }

  console.log(`\n🔁 유사도 검사: ${args.file}`);
  console.log(`   비교 대상: ${others.length}건, 임계값: ${threshold}%\n`);

  const results = [];
  for (const other of others) {
    const otherRaw = await readFile(other, 'utf8');
    const otherShingles = shingles(stripHtmlAndMd(otherRaw));
    const sim = jaccard(targetShingles, otherShingles);
    results.push({ file: other, similarity: sim });
  }
  results.sort((a, b) => b.similarity - a.similarity);

  let warnings = 0;
  for (const r of results) {
    const mark = r.similarity >= threshold ? '⚠️  WARN' : '✅ OK  ';
    console.log(
      `  ${mark}  ${r.similarity.toFixed(1).padStart(5)}%  ${r.file}`
    );
    if (r.similarity >= threshold) warnings++;
  }

  console.log(
    `\n결과: ${warnings === 0 ? '중복 위험 없음' : `${warnings}건 경고 — 유사 문장 수정 권장`}\n`
  );
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
