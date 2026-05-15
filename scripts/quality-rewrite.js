#!/usr/bin/env node
/**
 * quality-check 가 찾아준 위험 표현을 본문에 안전한 대체 표현으로 치환합니다.
 *
 * Usage:
 *   node scripts/quality-rewrite.js --folder output/2026-05-15_xxx
 *     [--apply-categories domain_specific,superlatives]
 *
 * 동작:
 *   - <folder>/post.md 와 <folder>/quality-report.json 을 읽고
 *   - <folder>/post.rewritten.md, post.rewrite.diff, quality-rewrite.json 생성
 *   - 원본 post.md 는 절대 수정하지 않습니다.
 *   - 자동 발행 흐름과 무관 — 사람이 diff 를 검토한 뒤 직접 결정합니다.
 */

import './lib/env.js';

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  applyRewrites,
  collectHits,
  DEFAULT_ACTIVE_CATEGORIES,
} from './lib/rewrite-rules.js';
import { unifiedDiff, colorizeDiff } from './lib/diff.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.folder) {
    console.error(
      'Usage: --folder <output폴더경로> [--apply-categories domain_specific,superlatives]'
    );
    process.exit(2);
  }

  const folder = args.folder.replace(/[\\/]+$/, '');
  const postPath = join(folder, 'post.md');
  const reportPath = join(folder, 'quality-report.json');

  let original;
  try {
    original = await readFile(postPath, 'utf8');
  } catch {
    console.error(`❌ ${postPath} 을 찾을 수 없습니다.`);
    process.exit(1);
  }

  const report = await readJsonIfExists(reportPath);
  if (!report) {
    console.error(`❌ ${reportPath} 이 없습니다.`);
    console.error(
      `   먼저 품질 검사를 실행하세요: npm run quality -- --file ${postPath}`
    );
    process.exit(1);
  }

  const hits = collectHits(report);

  const activeCategories = args['apply-categories']
    ? String(args['apply-categories'])
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [...DEFAULT_ACTIVE_CATEGORIES];

  console.log(`\n📝 quality-rewrite`);
  console.log(`폴더: ${folder}`);
  console.log(`품질 hits: ${hits.length}건`);
  console.log(`활성 카테고리: ${activeCategories.join(', ')}`);

  const { rewritten, changes, skipped } = applyRewrites(original, hits, {
    activeCategories,
  });

  if (rewritten === original) {
    console.log(
      `\n✅ 변경 사항 없음 — 활성 카테고리 안에 치환할 위험 표현이 없습니다.`
    );
    if (skipped.length) {
      console.log(`   (활성 외 카테고리에서 ${skipped.length}건 건너뜀)`);
    }
    return;
  }

  const rewrittenPath = join(folder, 'post.rewritten.md');
  const diffPath = join(folder, 'post.rewrite.diff');
  const auditPath = join(folder, 'quality-rewrite.json');

  const diff = unifiedDiff(original, rewritten, {
    oldName: 'post.md',
    newName: 'post.rewritten.md',
    context: 3,
  });

  await writeFile(rewrittenPath, rewritten);
  await writeFile(diffPath, diff);
  await writeFile(
    auditPath,
    JSON.stringify(
      {
        folder,
        source: postPath,
        report: reportPath,
        rewritten: rewrittenPath,
        activeCategories,
        changes,
        skipped,
      },
      null,
      2
    )
  );

  console.log(`\n— 변경 요약 (${changes.length}건) —`);
  for (const c of changes) {
    console.log(`  [${c.category}] "${c.before}" → "${c.after}"`);
  }

  if (skipped.length) {
    const reasonCounts = skipped.reduce((acc, s) => {
      acc[s.reason] = (acc[s.reason] || 0) + 1;
      return acc;
    }, {});
    console.log(`\n— 건너뜀 ${skipped.length}건 —`);
    for (const [reason, count] of Object.entries(reasonCounts)) {
      console.log(`  ${reason}: ${count}건`);
    }
  }

  console.log(`\n— diff 미리보기 —`);
  console.log(colorizeDiff(diff));

  console.log(`✅ 저장 완료`);
  console.log(`   원본 (보존)     : ${postPath}`);
  console.log(`   수정본          : ${rewrittenPath}`);
  console.log(`   diff            : ${diffPath}`);
  console.log(`   변경 감사 로그  : ${auditPath}`);
  console.log(
    `\n👀 사람이 diff 를 검토한 뒤, 필요하면 post.rewritten.md 의 내용으로 본문을 교체하세요.`
  );
  console.log(`   blog:auto / naver:draft 동작은 변경되지 않습니다.`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
