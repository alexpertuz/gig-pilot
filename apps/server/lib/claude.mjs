import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  AGENT_PROVIDERS,
  buildAgentSpawn,
  normalizeProvider,
} from '../../../agent-runtime.mjs';

export { AGENT_PROVIDERS, normalizeProvider } from '../../../agent-runtime.mjs';

const MODES = {
  gig: { slash: 'gig', file: 'modes/gig.md', input: (a) => a.url },
  proposal: { slash: 'proposal', file: 'modes/proposal.md', input: (a) => a.report ?? a.url ?? '' },
  patterns: { slash: 'patterns', file: 'modes/patterns.md' },
  deep: { slash: 'deep', file: 'modes/deep.md', input: (a) => a.query ?? a.url ?? '' },
  scan: { slash: 'scan', file: 'modes/scan.md' },
  followup: { slash: 'followup', file: 'modes/followup.md' },
  'agent-inbox': { slash: 'agent-inbox', file: 'modes/agent-inbox.md' },
};

function buildClaudePrompt(mode, args = {}) {
  const spec = MODES[mode];
  const input = spec.input?.(args) ?? '';
  return `/${spec.slash} ${input}`.trim();
}

function buildCodexPrompt(mode, args = {}) {
  const spec = MODES[mode];
  const input = spec.input?.(args);
  const lines = [
    `Run the gig-ops mode defined in ${spec.file}.`,
    'Read that file and follow its instructions for this task.',
  ];
  if (input) lines.push(`Task input: ${input}`);
  return lines.join('\n');
}

export function buildPrompt(mode, args = {}, provider = 'claude') {
  if (!MODES[mode]) throw new Error(`unknown mode: ${mode}`);
  const providerId = normalizeProvider(provider);
  if (providerId === 'codex') return buildCodexPrompt(mode, args);
  return buildClaudePrompt(mode, args);
}

let spawner = (prompt, providerId = normalizeProvider()) => {
  const spec = buildAgentSpawn(providerId, prompt, { readOnly: false, ephemeral: false });
  return { process: spawn(spec.bin, spec.args, spec.options), stdin: spec.stdin };
};
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

export function startJob(mode, args = {}, provider = process.env.GIGOPS_AGENT_PROVIDER || 'claude') {
  const providerId = normalizeProvider(provider);
  const jobId = randomUUID();
  const prompt = buildPrompt(mode, args, providerId);
  jobs.set(jobId, { id: jobId, mode, provider: providerId, prompt, status: 'queued', buffer: '', replay: [] });
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
  const spawned = spawner(job.prompt, job.provider);
  const proc = spawned?.process || spawned;
  const stdin = spawned?.process ? spawned.stdin : undefined;
  proc.stdin?.end?.(stdin);
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      handleLine(active, line, job.provider);
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

function handleLine(jobId, line, providerId) {
  let obj;
  try { obj = JSON.parse(line); } catch { return; }
  if (providerId === 'codex') return handleCodexLine(jobId, obj);
  handleClaudeLine(jobId, obj);
}

function handleClaudeLine(jobId, obj) {
  if (obj.type === 'assistant' && obj.message?.content) {
    for (const block of obj.message.content) {
      if (block.type === 'text') push(jobId, { type: 'text', data: block.text });
    }
  } else if (obj.type === 'result') {
    push(jobId, { type: 'result', data: obj.result ?? '' });
  }
}

function handleCodexLine(jobId, obj) {
  if (obj.type === 'item.completed' && obj.item?.type === 'agent_message' && obj.item.text) {
    push(jobId, { type: 'text', data: obj.item.text });
    return;
  }
  const payload = obj.payload ?? obj;
  if (payload.type === 'agent_message' && payload.message) {
    push(jobId, { type: 'text', data: payload.message });
  } else if (payload.type === 'task_complete' && payload.last_agent_message) {
    push(jobId, { type: 'result', data: payload.last_agent_message });
  } else if (typeof payload.message === 'string' && /assistant|agent/.test(String(payload.type || ''))) {
    push(jobId, { type: 'text', data: payload.message });
  } else if (typeof payload.text === 'string' && /assistant|agent/.test(String(payload.type || ''))) {
    push(jobId, { type: 'text', data: payload.text });
  }
}
