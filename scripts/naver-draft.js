#!/usr/bin/env node
/**
 * 네이버 블로그 글쓰기 화면 자동 입력.
 *
 * 자동 발행 금지: 이 스크립트는 발행 버튼을 클릭하지 않습니다.
 */

import './lib/env.js';

import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import {
  NAVER_BLOG_WRITE_URL,
  clickFirst,
  fillFirst,
  launchNaverBrowser,
  parseArgs,
  pasteHtml,
  visibleTarget,
} from './lib/naver-browser.js';

const TITLE_SELECTORS = [
  'textarea[placeholder*="제목"]',
  'textarea.se-title-text',
  '[contenteditable="true"][aria-label*="제목"]',
  '[contenteditable="true"][placeholder*="제목"]',
  '.se-title-text',
  '.se_title textarea',
];

const BODY_SELECTORS = [
  '[contenteditable="true"][aria-label*="본문"]',
  '[contenteditable="true"][data-a11y-title*="본문"]',
  '.se-component-content [contenteditable="true"]',
  '.se-section-text [contenteditable="true"]',
  '.se_editable',
  '[contenteditable="true"]',
];

const IMAGE_BUTTON_SELECTORS = [
  'button[aria-label*="사진"]',
  'button[title*="사진"]',
  'button:has-text("사진")',
  'button:has-text("이미지")',
  'a:has-text("사진")',
];

const TAG_SELECTORS = [
  'input[placeholder*="태그"]',
  'textarea[placeholder*="태그"]',
  '[contenteditable="true"][aria-label*="태그"]',
  '.se-hash-tag input',
  '.tag_input',
];

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
}

async function loadDraft(folder) {
  const meta = await readOptionalJson(join(folder, 'metadata.json'));

  let bodyHtml = null;
  let bodyText = null;
  try {
    bodyHtml = await readFile(join(folder, 'post.html'), 'utf8');
    bodyText = htmlToText(bodyHtml);
  } catch {
    bodyText = await readFile(join(folder, 'post.md'), 'utf8');
  }

  let images = [];
  try {
    const names = await readdir(join(folder, 'images'));
    images = names
      .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
      .sort()
      .map((name) => join(folder, 'images', name));
  } catch {
    images = [];
  }

  return {
    title: meta.title || meta.keyword || basename(folder),
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    description: meta.description || meta.meta_description || '',
    keyword: meta.keyword || '',
    bodyHtml,
    bodyText,
    images,
  };
}

async function dismissPopups(page) {
  const selectors = [
    'button:has-text("닫기")',
    'button:has-text("확인")',
    'button:has-text("취소")',
    'button[aria-label*="닫기"]',
  ];

  for (const selector of selectors) {
    try {
      const loc = page.locator(selector).first();
      if (await loc.isVisible({ timeout: 800 })) await loc.click();
    } catch {
      // Optional UI.
    }
  }
}

async function openEditor(page) {
  await page.goto(NAVER_BLOG_WRITE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await dismissPopups(page);
}

async function fillTitle(page, title) {
  const selector = await fillFirst(page, TITLE_SELECTORS, title, '제목 입력란');
  console.log(`제목 입력 완료: ${selector}`);
}

async function fillBody(page, draft) {
  const { locator, selector } = await visibleTarget(page, BODY_SELECTORS, '본문 입력란');
  await locator.click();

  if (draft.bodyHtml) {
    try {
      await pasteHtml(page, draft.bodyHtml);
      console.log(`본문 HTML 붙여넣기 완료: ${selector}`);
      return;
    } catch (e) {
      console.warn(`HTML 붙여넣기 실패, 텍스트 입력으로 대체합니다: ${e.message}`);
    }
  }

  await page.keyboard.type(draft.bodyText);
  console.log(`본문 텍스트 입력 완료: ${selector}`);
}

async function attachImages(page, imagePaths) {
  if (!imagePaths.length) {
    console.log('첨부할 이미지 없음');
    return;
  }

  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
  const selector = await clickFirst(page, IMAGE_BUTTON_SELECTORS, '이미지 첨부 버튼');
  const chooser = await fileChooserPromise;
  await chooser.setFiles(imagePaths);
  console.log(`이미지 ${imagePaths.length}개 첨부 요청 완료: ${selector}`);
}

async function fillTags(page, tags) {
  if (!tags.length) {
    console.log('입력할 태그 없음');
    return;
  }

  const text = tags.map((tag) => (String(tag).startsWith('#') ? tag : `#${tag}`)).join(' ');
  try {
    const selector = await fillFirst(page, TAG_SELECTORS, text, '태그 입력란');
    console.log(`태그 입력 완료: ${selector}`);
  } catch (e) {
    console.warn(`태그 입력란을 찾지 못했습니다. 수동 입력 필요: ${e.message}`);
    console.log(`태그: ${text}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.folder) {
    console.error('Usage: npm run naver:draft -- --folder "output/<폴더>"');
    process.exit(2);
  }

  const folder = String(args.folder).replace(/[\\/]+$/, '');
  const draft = await loadDraft(folder);
  const { context, page, userDataDir } = await launchNaverBrowser();

  console.log(`네이버 세션 위치: ${userDataDir}`);
  console.log(`초안 폴더: ${folder}`);
  console.log('자동 발행은 하지 않습니다. 발행 버튼은 사용자가 직접 눌러야 합니다.\n');

  try {
    await openEditor(page);
    await fillTitle(page, draft.title);
    await fillBody(page, draft);
    await attachImages(page, draft.images);
    await fillTags(page, draft.tags);

    console.log('\n입력 단계가 끝났습니다.');
    console.log('브라우저를 닫지 않습니다. 발행 전 최종 확인 후 직접 발행하세요.');
    await new Promise(() => {});
  } catch (e) {
    console.error(`\n네이버 초안 입력 실패: ${e.message}`);
    console.error('브라우저를 닫지 않습니다. 화면을 확인한 뒤 selector 조정이 필요한지 점검하세요.');
    await new Promise(() => {});
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
