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
  visibleTarget,
} from './lib/naver-browser.js';

const TITLE_SELECTORS = [
  'textarea[placeholder*="제목"]',
  'textarea.se-title-text',
  '[contenteditable="true"][aria-label*="제목"]',
  '[contenteditable="true"][placeholder*="제목"]',
  '[data-placeholder*="제목"]',
  '[class*="documentTitle"] [contenteditable="true"]',
  '[class*="documentTitle"] .se-module-text',
  '[class*="documentTitle"] p',
  '.se-section-documentTitle [contenteditable="true"]',
  '.se-section-documentTitle .se-module-text',
  '.se-section-documentTitle p',
  '.se-documentTitle [contenteditable="true"]',
  '.se-documentTitle .se-module-text',
  '.se-title-text',
  '.se-title-text p',
  '.se-title-text span',
  '[class*="se-title"] [contenteditable="true"]',
  '[class*="se-title"] p',
  '.se_title textarea',
];

const BODY_SELECTORS = [
  'body[contenteditable="true"]',
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
  'input[placeholder*="태그를 입력"]',
  'input[aria-label*="태그"]',
  'input[title*="태그"]',
  'textarea[aria-label*="태그"]',
  'textarea[placeholder*="태그"]',
  '[contenteditable="true"][aria-label*="태그"]',
  '[contenteditable="true"][data-placeholder*="태그"]',
  '[data-placeholder*="태그"]',
  '[class*="tag"] input',
  '[class*="Tag"] input',
  '[class*="hash"] input',
  '[class*="Hash"] input',
  '[class*="tag"] [contenteditable="true"]',
  '[class*="Tag"] [contenteditable="true"]',
  '.se-tag input',
  '.se-tag-input',
  '.se-hashtag input',
  '.se-hashtag-input',
  '.se-hash-tag input',
  '.post_tag input',
  '.tag-input input',
  '.tag_input',
];

const IMAGE_ORDER = ['thumbnail', 'infographic', 'quote-card', 'process'];

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

function imageSortKey(path) {
  const name = basename(path).toLowerCase();
  const index = IMAGE_ORDER.findIndex((prefix) => name.startsWith(prefix));
  return index === -1 ? IMAGE_ORDER.length : index;
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
      .sort((a, b) => imageSortKey(a) - imageSortKey(b) || a.localeCompare(b))
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

async function handleExistingDraftPopup(page, { discardExisting = false } = {}) {
  const popupTitle = page
    .locator('text=작성 중인 글이 있습니다.')
    .first();

  if (!(await popupTitle.isVisible({ timeout: 1200 }).catch(() => false))) {
    return;
  }

  if (!discardExisting) {
    throw new Error(
      '네이버에 작성 중인 글 팝업이 있습니다. 기존 글을 보존하려면 화면에서 직접 처리하세요. 새 초안을 강제로 시작하려면 --discard-existing 옵션을 붙여 다시 실행하세요.'
    );
  }

  const selectors = [
    'button:has-text("새로 작성")',
    'button:has-text("새 글 작성")',
    'button:has-text("새글쓰기")',
    'button:has-text("취소")',
  ];

  for (const selector of selectors) {
    const button = page.locator(selector).first();
    if (await button.isVisible({ timeout: 800 }).catch(() => false)) {
      await button.click();
      console.log(`작성 중인 글 팝업 처리: ${selector}`);
      await page.waitForTimeout(1000);
      return;
    }
  }

  throw new Error(
    '작성 중인 글 팝업을 감지했지만 새 글 작성 버튼을 찾지 못했습니다. 화면에서 직접 처리하세요.'
  );
}

async function openEditor(page, options = {}) {
  await page.goto(NAVER_BLOG_WRITE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await dismissPopups(page);
  await handleExistingDraftPopup(page, options);
}

async function fillTitle(page, title) {
  const { locator, selector } = await visibleTarget(page, TITLE_SELECTORS, '제목 입력란');
  await locator.click({ force: true });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(title);
  console.log(`제목 입력 완료: ${selector}`);
}

function stripDuplicateMarkdownTitle(text) {
  return text.replace(/^# .+\n+/, '').trim();
}

function splitTextAroundImageMarkers(text) {
  if (!/\[IMAGE:[^\]]*\]/.test(text)) return null;
  return text.split(/\s*\[IMAGE:[^\]]*\]\s*/).map((part) => part.trim());
}

function splitTextEvenly(text, imageCount) {
  const clean = stripDuplicateMarkdownTitle(text);
  if (imageCount <= 0) return [clean];

  const paragraphs = clean
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length <= 1) return [clean];

  const chunkCount = Math.min(imageCount + 1, paragraphs.length);
  const chunks = Array.from({ length: chunkCount }, () => []);

  paragraphs.forEach((paragraph, index) => {
    const bucket = Math.min(
      chunkCount - 1,
      Math.floor((index * chunkCount) / paragraphs.length)
    );
    chunks[bucket].push(paragraph);
  });

  return chunks.map((chunk) => chunk.join('\n\n')).filter(Boolean);
}

function bodyChunksForImages(text, imageCount) {
  const markerChunks = splitTextAroundImageMarkers(text);
  if (markerChunks) return markerChunks;
  return splitTextEvenly(text, imageCount);
}

async function countEditorImages(page) {
  let total = 0;
  for (const frame of page.frames()) {
    const count = await frame
      .locator('.se-image-resource, .se-module-image img, img[src*="postfiles"], img')
      .count()
      .catch(() => 0);
    total += count;
  }
  return total;
}

async function attachImages(page, imagePaths, { focusBody = true } = {}) {
  if (!imagePaths.length) {
    console.log('첨부할 이미지 없음');
    return;
  }

  const before = await countEditorImages(page);

  if (focusBody) {
    try {
      const body = await visibleTarget(page, BODY_SELECTORS, '이미지 삽입 위치');
      await body.locator.click({ force: true }).catch(() => {});
    } catch {
      // Body focus is best-effort; the photo button can still open the chooser.
    }
  }

  let chooser;
  let selector;
  try {
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
    selector = await clickFirst(page, IMAGE_BUTTON_SELECTORS, '이미지 첨부 버튼');
    chooser = await fileChooserPromise;
  } catch (e) {
    throw new Error(`이미지 파일 선택창을 열지 못했습니다: ${e.message}`);
  }

  await chooser.setFiles(imagePaths);
  console.log(`이미지 ${imagePaths.length}개 첨부 요청 완료: ${selector}`);

  const expected = before + imagePaths.length;
  try {
    await page.waitForFunction(
      ({ expectedCount }) => {
        let total = 0;
        for (const frame of [window, ...Array.from(document.querySelectorAll('iframe')).map((f) => f.contentWindow).filter(Boolean)]) {
          try {
            total += frame.document.querySelectorAll(
              '.se-image-resource, .se-module-image img, img[src*="postfiles"], img'
            ).length;
          } catch {
            // Cross-origin or loading frame.
          }
        }
        return total >= expectedCount;
      },
      { expectedCount: expected },
      { timeout: 60000 }
    );
    console.log(`이미지 삽입 확인: ${imagePaths.length}개`);
  } catch {
    const after = await countEditorImages(page);
    console.warn(
      `이미지 삽입 완료를 확인하지 못했습니다. 현재 감지 ${after}개 / 기대 ${expected}개. 화면에서 직접 확인하세요.`
    );
  }
}

async function typeBodyText(page, bodyLocator, text) {
  if (!text.trim()) return;
  await bodyLocator.evaluate((el) => el.focus()).catch(() => {});
  await page.keyboard.type(`${text.trim()}\n\n`);
}

async function fillBodyWithImages(page, draft) {
  const { locator, selector } = await visibleTarget(page, BODY_SELECTORS, '본문 입력란');
  const [thumbnail, ...inlineImages] = draft.images;

  if (thumbnail) {
    await locator.evaluate((el) => el.focus()).catch(() => {});
    await attachImages(page, [thumbnail], { focusBody: false });
    await page.keyboard.press('End').catch(() => {});
    await page.keyboard.type('\n\n');
    console.log(`썸네일 상단 삽입 완료: ${basename(thumbnail)}`);
  }

  const chunks = bodyChunksForImages(draft.bodyText, inlineImages.length);
  for (let i = 0; i < chunks.length; i++) {
    await typeBodyText(page, locator, chunks[i]);
    const image = inlineImages[i];
    if (image) {
      await attachImages(page, [image], { focusBody: false });
      await page.keyboard.press('End').catch(() => {});
      await page.keyboard.type('\n\n');
      console.log(`본문 중간 이미지 삽입 완료: ${basename(image)}`);
    }
  }

  console.log(`본문/이미지 분산 입력 완료: ${selector}`);
}

async function debugTagSelectors(page) {
  console.log('\n[debug] 태그 selector 후보 확인');
  for (const selector of TAG_SELECTORS) {
    let total = 0;
    for (const target of [page, ...page.frames()]) {
      total += await target.locator(selector).count().catch(() => 0);
    }
    console.log(`[debug] ${selector} => ${total}`);
  }
}

async function fillTags(page, tags, { debug = false } = {}) {
  if (!tags.length) {
    console.log('입력할 태그 없음');
    return;
  }

  const text = tags.map((tag) => (String(tag).startsWith('#') ? tag : `#${tag}`)).join(' ');
  if (debug) await debugTagSelectors(page);

  try {
    const selector = await fillFirst(page, TAG_SELECTORS, text, '태그 입력란');
    console.log(`태그 입력 완료: ${selector}`);
  } catch (e) {
    console.warn(`태그 입력란을 찾지 못했습니다. 수동 입력 필요: ${e.message}`);
    console.log(`태그: ${text}`);
  }
}

async function dumpEditorDebug(page) {
  console.log('\n[debug] 현재 URL:', page.url());
  console.log('[debug] page title:', await page.title().catch(() => '<unknown>'));
  console.log('[debug] frame count:', page.frames().length);

  for (const [i, frame] of page.frames().entries()) {
    const info = await frame
      .evaluate(() => {
        const pick = (el) => ({
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          className: String(el.className || '').slice(0, 120),
          ariaLabel: el.getAttribute('aria-label') || '',
          placeholder: el.getAttribute('placeholder') || '',
          dataPlaceholder: el.getAttribute('data-placeholder') || '',
          text: (el.innerText || el.textContent || '').trim().slice(0, 80),
          contenteditable: el.getAttribute('contenteditable') || '',
        });

        return {
          url: location.href,
          inputs: Array.from(
            document.querySelectorAll(
              'textarea, input, [contenteditable="true"], [data-placeholder], [class*="title"], [class*="Title"]'
            )
          )
            .slice(0, 30)
            .map(pick),
        };
      })
      .catch((e) => ({ url: frame.url(), error: e.message, inputs: [] }));

    console.log(`[debug] frame ${i}: ${info.url}`);
    if (info.error) console.log(`  error: ${info.error}`);
    for (const el of info.inputs || []) {
      console.log(
        `  - ${el.tag}#${el.id}.${el.className} aria="${el.ariaLabel}" placeholder="${el.placeholder}" data-placeholder="${el.dataPlaceholder}" contenteditable="${el.contenteditable}" text="${el.text}"`
      );
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.folder) {
    console.error('Usage: npm run naver:draft -- --folder "output/<폴더>" [--discard-existing]');
    process.exit(2);
  }

  const folder = String(args.folder).replace(/[\\/]+$/, '');
  const draft = await loadDraft(folder);
  const { context, page, userDataDir } = await launchNaverBrowser();

  console.log(`네이버 세션 위치: ${userDataDir}`);
  console.log(`초안 폴더: ${folder}`);
  console.log('자동 발행은 하지 않습니다. 발행 버튼은 사용자가 직접 눌러야 합니다.\n');

  try {
    await openEditor(page, { discardExisting: Boolean(args['discard-existing']) });
    await fillTitle(page, draft.title);
    await fillBodyWithImages(page, draft);
    await fillTags(page, draft.tags, { debug: Boolean(args.debug) });

    console.log('\n입력 단계가 끝났습니다.');
    console.log('브라우저를 닫지 않습니다. 발행 전 최종 확인 후 직접 발행하세요.');
    await new Promise(() => {});
  } catch (e) {
    console.error(`\n네이버 초안 입력 실패: ${e.message}`);
    await dumpEditorDebug(page).catch((debugError) => {
      console.error(`[debug] 덤프 실패: ${debugError.message}`);
    });
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
