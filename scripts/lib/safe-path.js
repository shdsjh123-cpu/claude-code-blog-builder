import { resolve, sep } from 'node:path';

/**
 * 사용자 입력 경로가 프로젝트의 output/ 하위인지 검증합니다.
 *
 * 통과하면 절대 경로(string) 를 반환하고, 아니면 null 을 반환합니다.
 * 대시보드 API 가 사용자가 보낸 폴더 인자를 사용하기 전 반드시 거쳐야 합니다.
 *
 *   safeOutputPath('output/2026-05-15_xxx')   // 절대 경로
 *   safeOutputPath('../etc/passwd')           // null
 *   safeOutputPath('/etc/passwd')             // null
 */
export function safeOutputPath(input, opts = {}) {
  if (typeof input !== 'string' || !input) return null;
  if (hasControlChars(input)) return null;

  const root = opts.root ? resolve(opts.root) : process.cwd();
  const outputRoot = resolve(root, 'output');

  const cleaned = input.replace(/[\\/]+$/, '');
  const abs = resolve(root, cleaned);

  if (abs === outputRoot) return abs;
  if (abs.startsWith(outputRoot + sep)) return abs;
  return null;
}

/**
 * 경로를 프로젝트 루트 기준 상대 경로로 정규화 (포워드 슬래시 통일).
 * UI 표시·CLI 인자 전달에 사용.
 */
export function relativeFromRoot(absPath, opts = {}) {
  const root = opts.root ? resolve(opts.root) : process.cwd();
  if (!absPath.startsWith(root)) return absPath;
  return absPath.slice(root.length + 1).split(sep).join('/');
}

function hasControlChars(s) {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
