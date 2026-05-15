/**
 * child_process spawn 으로 기존 CLI 스크립트를 실행하고
 * stdout/stderr 를 라인 단위로 수집·중계합니다.
 *
 * 단일 사용자(나 자신) 대시보드 가정 — 동시에 하나의 job 만 실행됩니다.
 * 진행 중인 작업이 있으면 startJob 은 ConcurrencyError 를 던집니다.
 *
 * 로그는 메모리 ring buffer 에 최근 MAX_LOG_LINES 줄만 보관합니다.
 * SSE 구독자는 subscribeSse 로 등록 — 등록 시 ring buffer 를 먼저 일괄 전송한 뒤
 * 이후 라인을 실시간으로 push 합니다. 작업이 끝난 job 도 즉시 'done' 을 받습니다.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const MAX_LOG_LINES = 2000;

const jobs = new Map();
let activeJobId = null;

export class ConcurrencyError extends Error {
  constructor(activeId) {
    super(`다른 작업이 실행 중입니다 (id=${activeId}). 끝날 때까지 기다려주세요.`);
    this.code = 'CONCURRENCY';
    this.activeId = activeId;
  }
}

/**
 * 새 작업 시작.
 *
 * @param {object} opts
 * @param {string} opts.kind        — 'blog-auto' | 'naver-draft' 등 라벨용 식별자
 * @param {string} opts.label       — 사람이 읽는 라벨 (예: "외도 증거 / infidelity")
 * @param {string[]} opts.args      — node 에 넘길 인자 (스크립트 경로 포함)
 * @param {string|null} [opts.folder] — 결과 폴더 (UI 에서 미리보기 등에 사용)
 * @returns {object} job — subscribers 를 제외한 public 형태
 */
export function startJob({ kind, label, args, folder = null }) {
  if (activeJobId) {
    throw new ConcurrencyError(activeJobId);
  }

  const id = randomUUID();
  const job = {
    id,
    kind,
    label,
    args,
    folder,
    pid: null,
    status: 'running',
    exitCode: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    logs: [],
    subscribers: new Set(),
  };

  jobs.set(id, job);
  activeJobId = id;

  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  job.pid = child.pid;
  job.child = child;

  child.stdout.on('data', makeLineHandler(job, 'stdout'));
  child.stderr.on('data', makeLineHandler(job, 'stderr'));

  child.on('error', (err) => {
    pushLine(job, `[runner] spawn 실패: ${err.message}`, 'stderr');
    finalize(job, 1);
  });
  child.on('close', (code) => finalize(job, code ?? 0));

  return publicJob(job);
}

export function getJob(id) {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}

export function getActiveJobId() {
  return activeJobId;
}

export function listJobs() {
  return [...jobs.values()].map(publicJob);
}

/**
 * SSE 응답에 이 job 의 로그를 연결합니다.
 *
 * - 이미 쌓인 라인을 먼저 전송
 * - 작업이 끝났으면 즉시 'done' 보내고 응답 종료
 * - 진행 중이면 subscribers 에 추가, 이후 라인이 들어올 때마다 push
 */
export function subscribeSse(jobId, res) {
  const job = jobs.get(jobId);
  if (!job) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'job not found' }));
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
    connection: 'keep-alive',
  });

  for (const entry of job.logs) {
    writeSse(res, 'message', { type: 'log', ...entry });
  }

  if (job.status !== 'running') {
    writeSse(res, 'done', donePayload(job));
    res.end();
    return;
  }

  job.subscribers.add(res);
  res.on('close', () => job.subscribers.delete(res));
}

// ─────────────────────────── 내부 ───────────────────────────

function makeLineHandler(job, stream) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      pushLine(job, line, stream);
    }
  };
}

function pushLine(job, rawLine, stream) {
  const line = stripAnsi(String(rawLine));
  const entry = { ts: Date.now(), stream, line };
  job.logs.push(entry);
  if (job.logs.length > MAX_LOG_LINES) {
    job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
  }
  for (const sub of job.subscribers) {
    try {
      writeSse(sub, 'message', { type: 'log', ...entry });
    } catch {
      /* 연결 끊긴 구독자는 close 핸들러가 처리 */
    }
  }
}

function stripAnsi(s) {
  // ESC(0x1b) 다음 '[' 가 오면 ANSI escape sequence — 종결 문자(@-~) 까지 잘라냄.
  // 정규식 리터럴이 ESC 를 못 받는 워크플로우 때문에 charCode 로 직접 검사.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 27 && s[i + 1] === '[') {
      i += 2;
      while (i < s.length) {
        const c = s.charCodeAt(i);
        if (c >= 0x40 && c <= 0x7e) break;
        i++;
      }
    } else {
      out += s[i];
    }
  }
  return out;
}

function finalize(job, exitCode) {
  job.status = exitCode === 0 ? 'completed' : 'failed';
  job.exitCode = exitCode;
  job.endedAt = new Date().toISOString();
  job.child = null;

  for (const sub of job.subscribers) {
    try {
      writeSse(sub, 'done', donePayload(job));
      sub.end();
    } catch {
      /* noop */
    }
  }
  job.subscribers.clear();

  if (activeJobId === job.id) activeJobId = null;
}

function donePayload(job) {
  return {
    id: job.id,
    status: job.status,
    exitCode: job.exitCode,
    folder: job.folder,
    endedAt: job.endedAt,
  };
}

function writeSse(res, event, data) {
  const payload = JSON.stringify(data);
  if (event === 'message') {
    res.write(`data: ${payload}\n\n`);
  } else {
    res.write(`event: ${event}\ndata: ${payload}\n\n`);
  }
}

function publicJob(job) {
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    args: job.args,
    folder: job.folder,
    pid: job.pid,
    status: job.status,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    logCount: job.logs.length,
  };
}
