import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright';

export const NAVER_LOGIN_URL = 'https://nid.naver.com/nidlogin.login';
export const NAVER_BLOG_WRITE_URL = 'https://blog.naver.com/GoBlogWrite.naver';

export function getNaverUserDataDir() {
  return (
    process.env.NAVER_USER_DATA_DIR ||
    join(homedir(), '.claude-code-blog-builder', 'naver-user-data')
  );
}

export async function launchNaverBrowser({ headless = false } = {}) {
  const userDataDir = getNaverUserDataDir();
  await mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1440, height: 1000 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });

  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(7000);
  return { context, page, userDataDir };
}

export function parseArgs(argv) {
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

export async function pauseForUser(message) {
  process.stdout.write(`${message}\n`);
  process.stdout.write('계속하려면 Enter를 누르세요. ');

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

export async function visibleTarget(page, selectors, label) {
  const targets = [page, ...page.frames()];
  const errors = [];

  for (const selector of selectors) {
    for (const target of targets) {
      try {
        const locator = target.locator(selector).first();
        await locator.waitFor({ state: 'visible', timeout: 1500 });
        return { locator, selector };
      } catch (e) {
        errors.push(`${selector}: ${e.message.split('\n')[0]}`);
      }
    }
  }

  throw new Error(
    `${label} selector를 찾지 못했습니다. 네이버 에디터 UI가 바뀌었거나 로그인이 필요할 수 있습니다.\n` +
      `시도한 selector:\n- ${selectors.join('\n- ')}`
  );
}

export async function clickFirst(page, selectors, label) {
  const { locator, selector } = await visibleTarget(page, selectors, label);
  await locator.click();
  return selector;
}

export async function fillFirst(page, selectors, value, label) {
  const { locator, selector } = await visibleTarget(page, selectors, label);
  await locator.click();

  try {
    await locator.fill(value);
  } catch {
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Control+A');
    await page.keyboard.type(value);
  }

  return selector;
}

export async function pasteHtml(page, html) {
  await page.evaluate(async (value) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([value], { type: 'text/html' }),
        'text/plain': new Blob([value.replace(/<[^>]+>/g, ' ')], {
          type: 'text/plain',
        }),
      }),
    ]);
  }, html);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
}
