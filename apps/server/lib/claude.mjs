import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { REPO_ROOT, claudeBin } from './paths.mjs';

const PROMPTS = {
  gig: (a) => `/gig ${a.url}`,
  proposal: (a) => `/proposal ${a.report ?? a.url ?? ''}`.trim(),
  patterns: () => `/patterns`,
  deep: (a) => `/deep ${a.query ?? a.url ?? ''}`.trim(),
  scan: () => `/scan`,
  followup: () => `/followup`,
  'agent-inbox': () => `/agent-inbox`,
};

export function buildPrompt(mode, args = {}) {
  const fn = PROMPTS[mode];
  if (!fn) throw new Error(`unknown mode: ${mode}`);
  return fn(args);
}

let spawner = (prompt) =>
  spawn(claudeBin, ['-p', prompt, '--output-format', 'stream-json', '--verbose'], { cwd: REPO_ROOT });
export function setSpawner(fn) { spawner = fn; }

const jobs = new Map();
const subscribers = new Map(); // jobId -> Set<emit>
const queue = [];
let active = null;

export function _reset() { jobs.clear(); subscribers.clear(); queue.length = 0; active = null; }

export function getJob(id) { return jobs.get(id); }

export function subscribe(jobId, emit) {
  if (!subscribers.has(jobId)) subscribers.set(jobId, new Set());
  subscribers.get(jobId).add(emit);
  const job = jobs.get(jobId);
  if (job) for (const e of job.replay) emit(e);
  return () => subscribers.get(jobId)?.delete(emit);
}

function push(jobId, event) {
  const job = jobs.get(jobId);
  if (job) job.replay.push(event);
  for (const emit of subscribers.get(jobId) || []) emit(event);
}

export function startJob(mode, args = {}) {
  const jobId = randomUUID();
  const prompt = buildPrompt(mode, args);
  jobs.set(jobId, { id: jobId, mode, prompt, status: 'queued', buffer: '', replay: [] });
  queue.push(jobId);
  drain();
  return { jobId };
}

function drain() {
  if (active || queue.length === 0) return;
  active = queue.shift();
  const job = jobs.get(active);
  job.status = 'running';
  push(active, { type: 'status', data: 'running' });
  const proc = spawner(job.prompt);
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      handleLine(active, line);
    }
  });
  proc.stderr.on('data', (d) => push(active, { type: 'stderr', data: String(d) }));
  proc.on('error', (err) => push(active, { type: 'stderr', data: String(err.message || err) }));
  proc.on('close', (code) => {
    const j = jobs.get(active);
    j.status = code === 0 ? 'done' : 'error';
    push(active, { type: 'done', data: { code, status: j.status } });
    active = null;
    drain();
  });
}

function handleLine(jobId, line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return; }
  if (obj.type === 'assistant' && obj.message?.content) {
    for (const block of obj.message.content) {
      if (block.type === 'text') push(jobId, { type: 'text', data: block.text });
    }
  } else if (obj.type === 'result') {
    push(jobId, { type: 'result', data: obj.result ?? '' });
  }
}
