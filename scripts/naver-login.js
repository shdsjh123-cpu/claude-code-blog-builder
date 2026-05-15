#!/usr/bin/env node
/**
 * 네이버 로그인 세션 준비.
 *
 * 아이디/비밀번호를 입력받지 않습니다. 브라우저에서 사용자가 직접 로그인하면
 * Playwright persistent user-data-dir에 세션이 로컬 저장됩니다.
 */

import './lib/env.js';
import {
  NAVER_LOGIN_URL,
  launchNaverBrowser,
  pauseForUser,
} from './lib/naver-browser.js';

async function main() {
  const { context, page, userDataDir } = await launchNaverBrowser();

  console.log('\n네이버 로그인 브라우저를 열었습니다.');
  console.log(`세션 저장 위치: ${userDataDir}`);
  console.log('아이디/비밀번호는 이 도구가 절대 요구하지 않습니다.');
  console.log('캡차/2FA/보안인증은 사용자가 직접 처리해야 합니다.\n');

  await page.goto(NAVER_LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await pauseForUser('브라우저에서 네이버 로그인을 완료한 뒤 이 터미널로 돌아오세요.');

  console.log('\n로그인 세션 저장을 위해 브라우저를 종료합니다.');
  await context.close();
  console.log('완료. 이제 npm run naver:draft -- --folder "output/<폴더>" 를 실행할 수 있습니다.');
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
