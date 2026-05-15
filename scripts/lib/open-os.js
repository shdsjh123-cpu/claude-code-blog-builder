import { spawn } from 'node:child_process';
import { platform } from 'node:os';

/**
 * 운영체제 기본 핸들러로 파일이나 폴더를 엽니다.
 * 폴더 → Finder/Explorer, HTML → 기본 브라우저. URL 도 동일하게 동작.
 *
 * spawn 만 사용 (shell: false). 명령 인젝션이 일어나지 않도록
 * 호출 측에서 반드시 safe-path.js 로 검증한 값을 넘기세요.
 */
export function openInOS(target) {
  if (typeof target !== 'string' || !target) return false;
  const p = platform();

  let cmd;
  let args;
  if (p === 'darwin') {
    cmd = 'open';
    args = [target];
  } else if (p === 'win32') {
    // explorer 는 폴더에는 적합하지만 일반 파일/URL 은 못 여는 경우가 있어
    // cmd /c start 로 통일. 첫 인자가 "" 인 이유는 start 가 첫 인자를 창 제목으로
    // 해석하는 동작 때문(공식 워크어라운드).
    cmd = 'cmd';
    args = ['/c', 'start', '""', target];
  } else {
    cmd = 'xdg-open';
    args = [target];
  }

  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false }).unref();
    return true;
  } catch {
    return false;
  }
}
