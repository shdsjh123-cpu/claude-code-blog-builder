#!/usr/bin/env node
/**
 * npm 기반 블로그 자동 생성 파이프라인.
 *
 * naver:draft는 자동 실행하지 않습니다. 최종 확인은 사람이 수행합니다.
 */

import './lib/env.js';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { generatePostPackage } from './generate-post.js';
import { outputFolderForKeyword } from './lib/slug.js';

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

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`node ${args.join(' ')} exited with ${code}`));
    });
  });
}

function joinList(items) {
  return (items || []).filter(Boolean).join('|||');
}

async function readMetadata(folder) {
  return JSON.parse(await readFile(join(folder, 'metadata.json'), 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.keyword) {
    console.error('Usage: npm run blog:auto -- --keyword "키워드" [--type general]');
    process.exit(2);
  }

  const keyword = args.keyword;
  const type = args.type || 'general';
  const folder = args.output || outputFolderForKeyword(keyword);

  console.log(`\n[1/5] 글 생성: ${keyword} (${type})`);
  await generatePostPackage({ keyword, type, output: folder });

  const metadata = await readMetadata(folder);

  console.log(`\n[2/5] 이미지 생성`);
  await runNode([
    'scripts/generate-images.js',
    '--provider',
    args.provider || process.env.IMAGE_PROVIDER || 'openai',
    '--title',
    metadata.title,
    '--keyword',
    keyword,
    '--points',
    joinList(metadata.image?.points),
    '--quote',
    metadata.image?.quote || metadata.title,
    '--steps',
    joinList(metadata.image?.steps),
    '--output',
    join(folder, 'images'),
  ]);

  console.log(`\n[3/5] 품질 검사`);
  await runNode([
    'scripts/quality-check.js',
    '--file',
    join(folder, 'post.md'),
    '--keyword',
    keyword,
  ]);

  console.log(`\n[4/5] 미리보기 생성`);
  await runNode(['scripts/preview.js', '--folder', folder, '--no-open']);

  console.log(`\n[5/5] 완료`);
  console.log(`출력 폴더: ${folder}`);
  console.log(`미리보기: ${join(folder, 'preview.html')}`);
  console.log(`네이버 초안 입력은 직접 확인 후 별도로 실행하세요:`);
  console.log(`npm run naver:draft -- --folder "${folder}"`);
}

main().catch((e) => {
  console.error(`\nblog:auto 실패: ${e.message}`);
  process.exit(1);
});
