/**
 * 외부 의존성 없는 unified diff 생성기.
 *
 * 블로그 본문(post.md 수준 — 수백 줄) 단위 비교용. 줄 단위 LCS DP로
 * op 시퀀스를 만든 뒤 context 줄을 묶어 hunk로 정리합니다.
 *
 * 매우 큰 입력에서는 메모리 사용이 O(N*M) — 글 한 편 규모를 넘지 마세요.
 */

function lcsTable(a, b) {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }
  return table;
}

function diffLines(a, b) {
  const table = lcsTable(a, b);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', text: a[i], aIndex: i, bIndex: j });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: 'remove', text: a[i], aIndex: i, bIndex: null });
      i++;
    } else {
      ops.push({ type: 'add', text: b[j], aIndex: null, bIndex: j });
      j++;
    }
  }
  while (i < a.length) {
    ops.push({ type: 'remove', text: a[i], aIndex: i, bIndex: null });
    i++;
  }
  while (j < b.length) {
    ops.push({ type: 'add', text: b[j], aIndex: null, bIndex: j });
    j++;
  }
  return ops;
}

/**
 * git 스타일 unified diff 문자열을 만듭니다.
 *
 * 변경이 전혀 없으면 빈 문자열을 반환합니다.
 */
export function unifiedDiff(oldText, newText, opts = {}) {
  const { oldName = 'a', newName = 'b', context = 3 } = opts;

  const a = oldText.split('\n');
  const b = newText.split('\n');
  const ops = diffLines(a, b);

  const changeIndices = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type !== 'equal') changeIndices.push(k);
  }
  if (!changeIndices.length) return '';

  const hunkRanges = [];
  let curStart = Math.max(0, changeIndices[0] - context);
  let curEnd = Math.min(ops.length - 1, changeIndices[0] + context);
  for (let k = 1; k < changeIndices.length; k++) {
    const idx = changeIndices[k];
    if (idx - context <= curEnd + 1) {
      curEnd = Math.min(ops.length - 1, idx + context);
    } else {
      hunkRanges.push({ start: curStart, end: curEnd });
      curStart = Math.max(0, idx - context);
      curEnd = Math.min(ops.length - 1, idx + context);
    }
  }
  hunkRanges.push({ start: curStart, end: curEnd });

  const out = [`--- ${oldName}`, `+++ ${newName}`];

  for (const { start, end } of hunkRanges) {
    let aStart = null;
    let bStart = null;
    let aCount = 0;
    let bCount = 0;

    for (let k = start; k <= end; k++) {
      const op = ops[k];
      if (op.type === 'equal') {
        if (aStart === null) aStart = op.aIndex;
        if (bStart === null) bStart = op.bIndex;
        aCount++;
        bCount++;
      } else if (op.type === 'remove') {
        if (aStart === null) aStart = op.aIndex;
        aCount++;
      } else {
        if (bStart === null) bStart = op.bIndex;
        bCount++;
      }
    }

    const aDisplayStart = aCount === 0 ? 0 : (aStart ?? 0) + 1;
    const bDisplayStart = bCount === 0 ? 0 : (bStart ?? 0) + 1;

    out.push(`@@ -${aDisplayStart},${aCount} +${bDisplayStart},${bCount} @@`);
    for (let k = start; k <= end; k++) {
      const op = ops[k];
      const prefix = op.type === 'equal' ? ' ' : op.type === 'add' ? '+' : '-';
      out.push(prefix + op.text);
    }
  }

  return out.join('\n') + '\n';
}

/**
 * 콘솔 출력용 ANSI 색상 적용. NO_COLOR 환경변수 / 비TTY 시 원본 그대로 반환.
 */
export function colorizeDiff(diffText, opts = {}) {
  const color =
    opts.color !== undefined
      ? opts.color
      : Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  if (!color) return diffText;

  const RED = '\x1b[31m';
  const GREEN = '\x1b[32m';
  const CYAN = '\x1b[36m';
  const DIM = '\x1b[2m';
  const RESET = '\x1b[0m';

  return diffText
    .split('\n')
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) return DIM + line + RESET;
      if (line.startsWith('@@')) return CYAN + line + RESET;
      if (line.startsWith('+')) return GREEN + line + RESET;
      if (line.startsWith('-')) return RED + line + RESET;
      return line;
    })
    .join('\n');
}
