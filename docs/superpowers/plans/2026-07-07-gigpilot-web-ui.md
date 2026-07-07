# GigPilot Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a premium web UI (React + Vite + TanStack Router) over an Express adapter so every terminal workflow in gig-ops (scan, evaluate, propose, track, edit config) is doable in a browser, while the flat files stay the source of truth and AI modes still run through headless Claude Code.

**Architecture:** A Node ESM Express server is the ONLY layer that touches flat files and shells out to the existing `.mjs` scripts. It exposes a small REST + SSE API. The React app renders a pipeline-first command center with a slide-out AI console that streams `claude -p` output over SSE. No database; the flat markdown/YAML files are the source of truth.

**Tech Stack:** Node ESM, Express, js-yaml (existing dep), Vitest; React 18, Vite, @tanstack/react-router, TypeScript, plain CSS with design tokens.

## Global Constraints

- **Cardinal Rule:** never auto-mutate User Layer files (`config/profile.yml`, `sources.yml`, `data/leads.md`, `data/pipeline.md`, `reports/*`). Write them ONLY on explicit user action, via atomic write (temp file + `rename`).
- **No Claude API.** AI modes run exclusively via `claude -p` subprocess. No `@anthropic` SDK, no HTTP to Anthropic.
- **No new runtime deps in the existing package** beyond `express` for the server. The web app has its own `package.json` under `apps/web`.
- **Server binds `127.0.0.1` only.** Local single-user, no auth.
- **Repo root** is resolved from `apps/server/lib/paths.mjs` via `REPO_ROOT` (two levels up from `apps/server`), overridable by `GIGOPS_ROOT` env var.
- **Node ESM only** (`"type": "module"` context); all server files are `.mjs`.
- **Design tokens:** bg `#0F172A`, panel `#1E293B`, accent teal `#2DD4BF`/emerald, warning amber `#F59E0B`, primary blue `#818CF8`; fonts Geist + Geist Mono; dark-only.
- **One concurrent Claude job**; additional runs queue FIFO.
- Leads schema is passed through from `tracker.mjs query --json` verbatim (migration in flight — do not hard-code columns).

---

## File Structure

```
package.json                      (modify: add express dep + ui:* scripts)
apps/
  server/
    index.mjs                     app bootstrap, route mounting, static serve, 127.0.0.1 bind
    lib/
      paths.mjs                   REPO_ROOT + resolved file paths + claude bin path
      files.mjs                   parse/serialize pipeline.md; read/write yaml; atomic write
      cli.mjs                     spawn scan.mjs / tracker.mjs; parse output to JSON
      claude.mjs                  claude -p bridge: job registry, spawn, SSE emitter, FIFO queue
    routes/
      pipeline.mjs                GET/POST/PATCH pipeline
      leads.mjs                   GET leads
      reports.mjs                 GET list + GET one
      config.mjs                  GET/PUT profile.yml + sources.yml
      scan.mjs                    POST run scan (SSE)
      modes.mjs                   POST run mode, GET SSE stream
      stats.mjs                   GET dashboard aggregates
    test/
      files.test.mjs
      cli.test.mjs
      claude.test.mjs
  web/
    package.json, vite.config.ts, tsconfig.json, index.html
    src/
      main.tsx, router.tsx
      styles/theme.css
      lib/api.ts                  typed fetch client
      lib/useSSE.ts               SSE hook
      lib/aiConsole.tsx           AI console drawer store + component
      components/                 Sidebar, AppShell, StatCard, StatusChip, Toast, ...
      routes/                     __root.tsx, index.tsx (dashboard), pipeline.tsx, leads.tsx,
                                  reports.tsx, scan.tsx, sources.tsx, profile.tsx, settings.tsx
```

---

## Phase 0 — Scaffolding

### Task 0: Monorepo layout, deps, and root scripts

**Files:**
- Modify: `package.json`
- Create: `apps/server/lib/paths.mjs`, `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/index.html`

**Interfaces:**
- Produces: `paths.mjs` exports `REPO_ROOT`, `paths` object `{ pipeline, profile, sources, leadsMd, reportsDir, scanHistory }`, `claudeBin`.

- [ ] **Step 1: Add express dep and UI scripts to root package.json**

In `package.json`, add to `dependencies`: `"express": "^4.19.2"`. Add to `scripts`:
```json
"ui:server": "node apps/server/index.mjs",
"ui:dev": "concurrently -k \"npm:ui:server\" \"npm --prefix apps/web run dev\"",
"ui:build": "npm --prefix apps/web install && npm --prefix apps/web run build",
"ui": "NODE_ENV=production node apps/server/index.mjs",
"ui:test": "node --test apps/server/test/*.test.mjs"
```
Add `"concurrently": "^9.0.0"` to `devDependencies`. Then run `npm install`.

- [ ] **Step 2: Write `apps/server/lib/paths.mjs`**

```js
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/server/lib -> repo root is three levels up
export const REPO_ROOT = process.env.GIGOPS_ROOT
  ? path.resolve(process.env.GIGOPS_ROOT)
  : path.resolve(here, '..', '..', '..');

export const paths = {
  pipeline: path.join(REPO_ROOT, 'data', 'pipeline.md'),
  profile: path.join(REPO_ROOT, 'config', 'profile.yml'),
  sources: path.join(REPO_ROOT, 'sources.yml'),
  leadsMd: path.join(REPO_ROOT, 'data', 'leads.md'),
  reportsDir: path.join(REPO_ROOT, 'reports'),
  scanHistory: path.join(REPO_ROOT, 'data', 'scan-history.tsv'),
};

export const claudeBin = process.env.GIGOPS_CLAUDE_BIN || 'claude';
```

- [ ] **Step 3: Scaffold the Vite React app**

Create `apps/web/package.json`:
```json
{
  "name": "gigpilot-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@tanstack/react-router": "^1.58.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tanstack/router-plugin": "^1.58.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.0"
  }
}
```

Create `apps/web/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  server: {
    port: 5273,
    proxy: { '/api': 'http://127.0.0.1:4317' },
  },
  build: { outDir: 'dist' },
});
```

Create `apps/web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

Create `apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GigPilot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Install web deps**

Run: `npm --prefix apps/web install`
Expected: completes without error, creates `apps/web/node_modules`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json apps/server/lib/paths.mjs apps/web/package.json apps/web/package-lock.json apps/web/vite.config.ts apps/web/tsconfig.json apps/web/index.html
git commit -m "chore: scaffold web UI monorepo (express server + vite app)"
```

---

## Phase 1 — Server lib: file adapters (TDD)

### Task 1: pipeline.md parse/serialize + atomic write

**Files:**
- Create: `apps/server/lib/files.mjs`
- Test: `apps/server/test/files.test.mjs`

**Interfaces:**
- Produces:
  - `parsePipeline(text) -> { url: string, status: string|null, title: string|null, checked: boolean }[]`
  - `serializePipeline(items, originalText) -> string` (preserves header + non-pending content)
  - `readPipeline() -> Promise<items[]>`, `writePipeline(items) -> Promise<void>`
  - `atomicWrite(filePath, text) -> Promise<void>`
  - `readYaml(filePath) -> Promise<object>`, `writeYaml(filePath, obj) -> Promise<void>`

- [ ] **Step 1: Write failing tests**

`apps/server/test/files.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePipeline, serializePipeline } from '../lib/files.mjs';

test('parsePipeline reads url | status | title', () => {
  const text = `# Pipeline\n\n## Pending\n\n- [ ] https://x.com/a | new | A gig\n- [x] https://x.com/b | evaluated | B gig\n`;
  const items = parsePipeline(text);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { url: 'https://x.com/a', status: 'new', title: 'A gig', checked: false });
  assert.equal(items[1].checked, true);
  assert.equal(items[1].status, 'evaluated');
});

test('parsePipeline tolerates bare url lines', () => {
  const items = parsePipeline('## Pending\n\n- [ ] https://x.com/c\n');
  assert.deepEqual(items[0], { url: 'https://x.com/c', status: null, title: null, checked: false });
});

test('serializePipeline round-trips and preserves header', () => {
  const original = `# Pipeline\n\nintro line\n\n## Pending\n\n- [ ] https://x.com/a | new | A gig\n`;
  const items = parsePipeline(original);
  items[0].status = 'evaluated';
  const out = serializePipeline(items, original);
  assert.match(out, /# Pipeline/);
  assert.match(out, /intro line/);
  assert.match(out, /- \[ \] https:\/\/x\.com\/a \| evaluated \| A gig/);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test apps/server/test/files.test.mjs`
Expected: FAIL — cannot find module `../lib/files.mjs`.

- [ ] **Step 3: Implement `files.mjs`**

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { paths } from './paths.mjs';

const LINE = /^- \[( |x)\]\s+(.+)$/;

export function parsePipeline(text) {
  const items = [];
  for (const raw of text.split('\n')) {
    const m = raw.match(LINE);
    if (!m) continue;
    const checked = m[1] === 'x';
    const parts = m[2].split('|').map((s) => s.trim());
    const url = parts[0];
    if (!/^https?:\/\//.test(url)) continue;
    items.push({
      url,
      status: parts[1] || null,
      title: parts[2] || null,
      checked,
    });
  }
  return items;
}

function itemToLine(it) {
  const box = it.checked ? 'x' : ' ';
  const segs = [it.url];
  if (it.status || it.title) segs.push(it.status || '');
  if (it.title) segs.push(it.title);
  return `- [${box}] ${segs.join(' | ')}`;
}

export function serializePipeline(items, originalText = '') {
  const lines = originalText.split('\n');
  const kept = [];
  let inserted = false;
  for (const line of lines) {
    if (LINE.test(line)) {
      if (!inserted) {
        for (const it of items) kept.push(itemToLine(it));
        inserted = true;
      }
      // drop original item lines
      continue;
    }
    kept.push(line);
  }
  if (!inserted) {
    if (!/## Pending/.test(originalText)) kept.push('', '## Pending', '');
    for (const it of items) kept.push(itemToLine(it));
  }
  return kept.join('\n');
}

export async function atomicWrite(filePath, text) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, filePath);
}

export async function readPipeline() {
  const text = await fs.readFile(paths.pipeline, 'utf8').catch(() => '');
  return parsePipeline(text);
}

export async function writePipeline(items) {
  const original = await fs.readFile(paths.pipeline, 'utf8').catch(() => '# Pipeline\n\n## Pending\n');
  await atomicWrite(paths.pipeline, serializePipeline(items, original));
}

export async function readYaml(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return yaml.load(text) || {};
}

export async function writeYaml(filePath, obj) {
  const text = yaml.dump(obj, { lineWidth: 100, noRefs: true });
  await atomicWrite(filePath, text);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test apps/server/test/files.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/lib/files.mjs apps/server/test/files.test.mjs
git commit -m "feat(server): pipeline.md + yaml file adapters with atomic write"
```

---

## Phase 2 — Server lib: CLI adapter + Claude bridge (TDD)

### Task 2: CLI adapter for scan + tracker

**Files:**
- Create: `apps/server/lib/cli.mjs`
- Test: `apps/server/test/cli.test.mjs`

**Interfaces:**
- Produces:
  - `runNode(scriptRelPath, args, { onLine }) -> Promise<{ code, stdout, stderr }>` (spawns `node <script>` in REPO_ROOT, streams lines to `onLine`)
  - `queryLeads(opts) -> Promise<object[]>` (wraps `node tracker.mjs query --json`; returns `[]` when leads.md missing)

- [ ] **Step 1: Write failing test**

`apps/server/test/cli.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNode } from '../lib/cli.mjs';

test('runNode captures stdout and streams lines', async () => {
  const seen = [];
  const res = await runNode('-e', ["console.log('hello'); console.log('world')"], {
    onLine: (l) => seen.push(l),
  });
  assert.equal(res.code, 0);
  assert.deepEqual(seen, ['hello', 'world']);
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `node --test apps/server/test/cli.test.mjs`
Expected: FAIL — cannot find `../lib/cli.mjs`.

- [ ] **Step 3: Implement `cli.mjs`**

```js
import { spawn } from 'node:child_process';
import { REPO_ROOT } from './paths.mjs';

export function runNode(script, args = [], { onLine, onErr } = {}) {
  return new Promise((resolve) => {
    const proc = spawn('node', [script, ...args], { cwd: REPO_ROOT });
    let stdout = '';
    let stderr = '';
    let buf = '';
    proc.stdout.on('data', (d) => {
      stdout += d;
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        onLine?.(line);
      }
    });
    proc.stderr.on('data', (d) => {
      stderr += d;
      onErr?.(String(d));
    });
    proc.on('close', (code) => {
      if (buf) onLine?.(buf);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function queryLeads(opts = {}) {
  const args = ['query', '--json'];
  if (opts.status) args.push('--status', opts.status);
  if (opts.limit) args.push('--limit', String(opts.limit));
  const res = await runNode('tracker.mjs', args);
  if (res.code !== 0) {
    if (/not found|no source of truth/i.test(res.stderr)) return [];
    throw new Error(res.stderr.trim() || 'tracker query failed');
  }
  try {
    return JSON.parse(res.stdout);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `node --test apps/server/test/cli.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/lib/cli.mjs apps/server/test/cli.test.mjs
git commit -m "feat(server): CLI adapter for scan/tracker with line streaming"
```

### Task 3: Claude bridge with FIFO single-job queue

**Files:**
- Create: `apps/server/lib/claude.mjs`
- Test: `apps/server/test/claude.test.mjs`

**Interfaces:**
- Produces:
  - `buildPrompt(mode, args) -> string` (e.g. `buildPrompt('gig', { url }) -> "/gig <url>"`)
  - `startJob(mode, args) -> { jobId }` (enqueues; spawns when it reaches head of queue)
  - `subscribe(jobId, emit) -> unsubscribe` where `emit(event)` receives `{ type, data }`
  - `getJob(jobId) -> { id, mode, status, buffer }`
  - Injectable spawner for tests: module-level `setSpawner(fn)`; default spawns `claude`.

- [ ] **Step 1: Write failing tests**

`apps/server/test/claude.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { buildPrompt, startJob, subscribe, getJob, setSpawner, _reset } from '../lib/claude.mjs';

test('buildPrompt maps modes to slash commands', () => {
  assert.equal(buildPrompt('gig', { url: 'https://x/y' }), '/gig https://x/y');
  assert.equal(buildPrompt('proposal', { report: '007' }), '/proposal 007');
});

test('startJob streams assistant text then done', async () => {
  _reset();
  // fake process that emits two stream-json lines then closes 0
  setSpawner(() => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    setImmediate(() => {
      proc.stdout.emit('data', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } }) + '\n');
      proc.emit('close', 0);
    });
    return proc;
  });
  const { jobId } = startJob('gig', { url: 'https://x/y' });
  const events = [];
  await new Promise((resolve) => {
    subscribe(jobId, (e) => {
      events.push(e);
      if (e.type === 'done') resolve();
    });
  });
  assert.ok(events.some((e) => e.type === 'text' && e.data.includes('Hi')));
  assert.equal(getJob(jobId).status, 'done');
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `node --test apps/server/test/claude.test.mjs`
Expected: FAIL — cannot find `../lib/claude.mjs`.

- [ ] **Step 3: Implement `claude.mjs`**

```js
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
```

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test apps/server/test/claude.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/lib/claude.mjs apps/server/test/claude.test.mjs
git commit -m "feat(server): claude -p bridge with SSE replay + FIFO single-job queue"
```

---

## Phase 3 — Server routes + bootstrap

### Task 4: Routes and Express app

**Files:**
- Create: `apps/server/routes/pipeline.mjs`, `apps/server/routes/leads.mjs`, `apps/server/routes/reports.mjs`, `apps/server/routes/config.mjs`, `apps/server/routes/scan.mjs`, `apps/server/routes/modes.mjs`, `apps/server/routes/stats.mjs`, `apps/server/index.mjs`

**Interfaces:**
- Consumes: `files.mjs`, `cli.mjs`, `claude.mjs`, `paths.mjs`.
- Produces REST API:
  - `GET /api/pipeline` → `{ items }`; `POST /api/pipeline` `{ url, title? }`; `PATCH /api/pipeline` `{ url, status?, checked? }`
  - `GET /api/leads?status=&limit=` → `{ leads }`
  - `GET /api/reports` → `{ reports: [{ file, num, slug, date }] }`; `GET /api/reports/:file` → `{ markdown }`
  - `GET /api/config/profile|sources` → `{ data, raw }`; `PUT` same `{ data }` (or `{ raw }`)
  - `POST /api/scan` → SSE stream of `{ type:'line'|'done', data }`
  - `POST /api/modes/run` `{ mode, args }` → `{ jobId }`; `GET /api/modes/stream/:jobId` SSE
  - `GET /api/stats` → funnel aggregates
  - `GET /api/health` → `{ claude: bool, version }`

- [ ] **Step 1: Write `routes/pipeline.mjs`**

```js
import { Router } from 'express';
import { readPipeline, writePipeline } from '../lib/files.mjs';

const r = Router();
r.get('/', async (_req, res) => res.json({ items: await readPipeline() }));
r.post('/', async (req, res) => {
  const { url, title = null } = req.body;
  if (!/^https?:\/\//.test(url || '')) return res.status(400).json({ error: { message: 'invalid url' } });
  const items = await readPipeline();
  if (items.some((i) => i.url === url)) return res.status(409).json({ error: { message: 'already in pipeline' } });
  items.push({ url, status: 'new', title, checked: false });
  await writePipeline(items);
  res.status(201).json({ items });
});
r.patch('/', async (req, res) => {
  const { url, status, checked } = req.body;
  const items = await readPipeline();
  const it = items.find((i) => i.url === url);
  if (!it) return res.status(404).json({ error: { message: 'not found' } });
  if (status !== undefined) it.status = status;
  if (checked !== undefined) it.checked = checked;
  await writePipeline(items);
  res.json({ items });
});
export default r;
```

- [ ] **Step 2: Write `routes/leads.mjs`, `routes/reports.mjs`, `routes/config.mjs`**

`routes/leads.mjs`:
```js
import { Router } from 'express';
import { queryLeads } from '../lib/cli.mjs';
const r = Router();
r.get('/', async (req, res) => {
  try {
    const leads = await queryLeads({ status: req.query.status, limit: req.query.limit });
    res.json({ leads });
  } catch (e) { res.status(500).json({ error: { message: e.message } }); }
});
export default r;
```

`routes/reports.mjs`:
```js
import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../lib/paths.mjs';
const r = Router();
r.get('/', async (_req, res) => {
  const files = await fs.readdir(paths.reportsDir).catch(() => []);
  const reports = files.filter((f) => f.endsWith('.md')).map((file) => {
    const m = file.match(/^(\d+)-(.+)-(\d{4}-\d{2}-\d{2})\.md$/);
    return m ? { file, num: m[1], slug: m[2], date: m[3] } : { file, num: null, slug: file, date: null };
  }).sort((a, b) => (b.num || '').localeCompare(a.num || ''));
  res.json({ reports });
});
r.get('/:file', async (req, res) => {
  const safe = path.basename(req.params.file);
  const markdown = await fs.readFile(path.join(paths.reportsDir, safe), 'utf8').catch(() => null);
  if (markdown === null) return res.status(404).json({ error: { message: 'not found' } });
  res.json({ markdown });
});
export default r;
```

`routes/config.mjs`:
```js
import { Router } from 'express';
import fs from 'node:fs/promises';
import { paths } from '../lib/paths.mjs';
import { readYaml, writeYaml, atomicWrite } from '../lib/files.mjs';
const r = Router();
const FILES = { profile: paths.profile, sources: paths.sources };
r.get('/:name', async (req, res) => {
  const fp = FILES[req.params.name];
  if (!fp) return res.status(404).json({ error: { message: 'unknown config' } });
  const raw = await fs.readFile(fp, 'utf8').catch(() => '');
  const data = raw ? (await readYaml(fp).catch(() => ({}))) : {};
  res.json({ data, raw });
});
r.put('/:name', async (req, res) => {
  const fp = FILES[req.params.name];
  if (!fp) return res.status(404).json({ error: { message: 'unknown config' } });
  try {
    if (typeof req.body.raw === 'string') await atomicWrite(fp, req.body.raw);
    else await writeYaml(fp, req.body.data);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: { message: e.message } }); }
});
export default r;
```

- [ ] **Step 3: Write `routes/scan.mjs` and `routes/modes.mjs` (SSE)**

`routes/scan.mjs`:
```js
import { Router } from 'express';
import { runNode } from '../lib/cli.mjs';
const r = Router();
r.post('/', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders?.();
  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  const args = Array.isArray(req.body?.args) ? req.body.args : [];
  const result = await runNode('scan.mjs', args, { onLine: (l) => send('line', l), onErr: (e) => send('stderr', e) });
  send('done', { code: result.code });
  res.end();
});
export default r;
```

`routes/modes.mjs`:
```js
import { Router } from 'express';
import { startJob, subscribe, getJob } from '../lib/claude.mjs';
const r = Router();
r.post('/run', (req, res) => {
  const { mode, args } = req.body;
  try { res.json(startJob(mode, args || {})); }
  catch (e) { res.status(400).json({ error: { message: e.message } }); }
});
r.get('/stream/:jobId', (req, res) => {
  if (!getJob(req.params.jobId)) return res.status(404).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders?.();
  const unsub = subscribe(req.params.jobId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'done') { unsub(); res.end(); }
  });
  req.on('close', unsub);
});
export default r;
```

- [ ] **Step 4: Write `routes/stats.mjs`**

```js
import { Router } from 'express';
import { readPipeline } from '../lib/files.mjs';
import { queryLeads } from '../lib/cli.mjs';
const r = Router();
r.get('/', async (_req, res) => {
  const [items, leads] = await Promise.all([readPipeline(), queryLeads().catch(() => [])]);
  const byStatus = {};
  for (const l of leads) { const s = (l.status || l.Status || 'unknown').toLowerCase(); byStatus[s] = (byStatus[s] || 0) + 1; }
  res.json({
    pipeline: { total: items.length, unevaluated: items.filter((i) => !i.checked).length },
    leads: { total: leads.length, byStatus },
  });
});
export default r;
```

- [ ] **Step 5: Write `apps/server/index.mjs`**

```js
import express from 'express';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claudeBin, REPO_ROOT } from './lib/paths.mjs';
import pipeline from './routes/pipeline.mjs';
import leads from './routes/leads.mjs';
import reports from './routes/reports.mjs';
import config from './routes/config.mjs';
import scan from './routes/scan.mjs';
import modes from './routes/modes.mjs';
import stats from './routes/stats.mjs';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use('/api/pipeline', pipeline);
app.use('/api/leads', leads);
app.use('/api/reports', reports);
app.use('/api/config', config);
app.use('/api/scan', scan);
app.use('/api/modes', modes);
app.use('/api/stats', stats);

app.get('/api/health', (_req, res) => {
  execFile(claudeBin, ['--version'], (err, stdout) => {
    res.json({ claude: !err, version: err ? null : stdout.trim(), repoRoot: REPO_ROOT });
  });
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT || 4317;
app.listen(PORT, '127.0.0.1', () => console.log(`gig-ops UI server on http://127.0.0.1:${PORT}`));
```

- [ ] **Step 6: Smoke test the API**

Run: `node apps/server/index.mjs &` then `sleep 1 && curl -s http://127.0.0.1:4317/api/pipeline | head -c 200 && curl -s http://127.0.0.1:4317/api/health`
Expected: JSON `{ "items": [...] }` and `{ "claude": true, "version": "2.1.x ..." }`. Then `kill %1`.

- [ ] **Step 7: Commit**

```bash
git add apps/server/routes apps/server/index.mjs
git commit -m "feat(server): REST + SSE routes and express bootstrap"
```

---

## Phase 4 — Web foundation

### Task 5: Router, theme tokens, API client, SSE hook

**Files:**
- Create: `apps/web/src/main.tsx`, `apps/web/src/styles/theme.css`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/useSSE.ts`, `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/index.tsx`

**Interfaces:**
- Produces: `api` object with typed methods; `useSSE(url, { method, body, onEvent })`; TanStack root route with `<AppShell>` outlet.

- [ ] **Step 1: Write `styles/theme.css`**

```css
:root {
  --bg: #0F172A; --panel: #1E293B; --panel-2: #263449;
  --border: #334155; --text: #E2E8F0; --muted: #94A3B8;
  --accent: #2DD4BF; --accent-dim: #14b8a6; --primary: #818CF8;
  --warn: #F59E0B; --danger: #F87171; --go: #34D399;
  --radius: 12px; --radius-lg: 20px;
  --shadow: 0 20px 40px rgba(0,0,0,0.4);
  --mono: 'Geist Mono', ui-monospace, monospace;
  --sans: 'Geist', system-ui, -apple-system, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); }
button { font-family: inherit; cursor: pointer; }
a { color: inherit; text-decoration: none; }
.mono { font-family: var(--mono); }
```

- [ ] **Step 2: Write `lib/api.ts`**

```ts
async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || res.statusText);
  }
  return res.json();
}
export interface PipelineItem { url: string; status: string | null; title: string | null; checked: boolean; }
export const api = {
  pipeline: () => fetch('/api/pipeline').then(j<{ items: PipelineItem[] }>),
  addUrl: (url: string, title?: string) =>
    fetch('/api/pipeline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, title }) }).then(j<{ items: PipelineItem[] }>),
  patchItem: (url: string, patch: { status?: string; checked?: boolean }) =>
    fetch('/api/pipeline', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, ...patch }) }).then(j<{ items: PipelineItem[] }>),
  leads: (q = '') => fetch(`/api/leads${q}`).then(j<{ leads: any[] }>),
  reports: () => fetch('/api/reports').then(j<{ reports: any[] }>),
  report: (file: string) => fetch(`/api/reports/${file}`).then(j<{ markdown: string }>),
  config: (name: string) => fetch(`/api/config/${name}`).then(j<{ data: any; raw: string }>),
  saveConfig: (name: string, payload: { data?: any; raw?: string }) =>
    fetch(`/api/config/${name}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).then(j),
  stats: () => fetch('/api/stats').then(j<any>),
  health: () => fetch('/api/health').then(j<{ claude: boolean; version: string | null }>),
  runMode: (mode: string, args: any) =>
    fetch('/api/modes/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, args }) }).then(j<{ jobId: string }>),
};
```

- [ ] **Step 3: Write `lib/useSSE.ts`**

```ts
import { useEffect, useRef, useState } from 'react';

export interface SSEEvent { type: string; data: any; }

// POST-then-stream: opens a fetch stream (SSE-style) for POST bodies, or GET EventSource for GET.
export function streamPost(url: string, body: any, onEvent: (e: SSEEvent) => void) {
  const ctrl = new AbortController();
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal })
    .then(async (res) => {
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const line = chunk.replace(/^data: /, '');
          try { onEvent(JSON.parse(line)); } catch {}
        }
      }
    })
    .catch(() => {});
  return () => ctrl.abort();
}

export function streamGet(url: string, onEvent: (e: SSEEvent) => void) {
  const es = new EventSource(url);
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch {} };
  return () => es.close();
}
```

- [ ] **Step 4: Write `routes/__root.tsx` and `routes/index.tsx`**

`routes/__root.tsx`:
```tsx
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '../components/AppShell';
import '../styles/theme.css';

export const Route = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
```

`routes/index.tsx` (placeholder dashboard, filled in Task 8):
```tsx
import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/')({ component: () => <div style={{ padding: 32 }}>Dashboard</div> });
```

- [ ] **Step 5: Write `main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

const router = createRouter({ routeTree });
declare module '@tanstack/react-router' { interface Register { router: typeof router; } }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><RouterProvider router={router} /></React.StrictMode>,
);
```

- [ ] **Step 6: Commit** (build verified in Task 7 once AppShell exists)

```bash
git add apps/web/src/main.tsx apps/web/src/styles apps/web/src/lib apps/web/src/routes/__root.tsx apps/web/src/routes/index.tsx
git commit -m "feat(web): router, theme tokens, api client, SSE helpers"
```

---

## Phase 5 — App shell + AI console

### Task 6: AppShell, Sidebar, shared components

**Files:**
- Create: `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/StatusChip.tsx`, `apps/web/src/components/StatCard.tsx`, `apps/web/src/components/ui.css`

**Interfaces:**
- Consumes: `aiConsole` store (Task 7) — import lazily; AppShell renders `<AIConsole />`.
- Produces: `<AppShell>{children}</AppShell>`, `<Sidebar/>`, `<StatusChip status/>`, `<StatCard label value accent?/>`.

- [ ] **Step 1: Write `components/Sidebar.tsx`**

```tsx
import { Link } from '@tanstack/react-router';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◱' },
  { to: '/pipeline', label: 'Pipeline', icon: '▚' },
  { to: '/leads', label: 'Leads', icon: '◎' },
  { to: '/reports', label: 'Reports', icon: '▤' },
  { to: '/scan', label: 'Scan', icon: '⚡' },
  { to: '/sources', label: 'Sources', icon: '⛃' },
  { to: '/profile', label: 'Profile', icon: '◔' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="brand">GigPilot</div>
      {NAV.map((n) => (
        <Link key={n.to} to={n.to} className="nav-item" activeProps={{ className: 'nav-item active' }} activeOptions={{ exact: n.to === '/' }}>
          <span className="nav-icon">{n.icon}</span>{n.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Write `components/StatusChip.tsx` and `StatCard.tsx`**

```tsx
// StatusChip.tsx
const COLORS: Record<string, string> = {
  new: 'var(--muted)', contacted: 'var(--primary)', replied: 'var(--accent)',
  negotiating: 'var(--warn)', won: 'var(--go)', lost: 'var(--danger)', dropped: 'var(--muted)',
  evaluated: 'var(--accent)',
};
export function StatusChip({ status }: { status: string | null }) {
  const s = (status || 'new').toLowerCase();
  return <span className="chip" style={{ color: COLORS[s] || 'var(--muted)', borderColor: COLORS[s] || 'var(--border)' }}>{s}</span>;
}
```
```tsx
// StatCard.tsx
export function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value mono" style={{ color: accent || 'var(--text)' }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
```

- [ ] **Step 3: Write `components/AppShell.tsx`**

```tsx
import { Sidebar } from './Sidebar';
import { AIConsole } from '../lib/aiConsole';
import './ui.css';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">{children}</main>
      <AIConsole />
    </div>
  );
}
```

- [ ] **Step 4: Write `components/ui.css`**

Provide the layout + micro-interactions (grid, sidebar, nav hover/active, chip, stat-card, card hover-lift, skeleton). Include:
```css
.app { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
.sidebar { background: var(--panel); border-right: 1px solid var(--border); padding: 20px 12px; display: flex; flex-direction: column; gap: 4px; }
.brand { font-size: 22px; font-weight: 700; color: var(--primary); padding: 8px 12px 20px; }
.nav-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius); color: var(--muted); transition: background .15s ease, color .15s ease, transform .15s ease; }
.nav-item:hover { background: var(--panel-2); color: var(--text); }
.nav-item.active { background: var(--panel-2); color: var(--text); box-shadow: inset 2px 0 0 var(--accent); }
.nav-icon { width: 18px; text-align: center; }
.main { padding: 28px 32px; overflow: auto; }
.chip { font-size: 12px; padding: 2px 10px; border: 1px solid; border-radius: 999px; font-family: var(--mono); }
.stat-card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; transition: transform .2s ease, box-shadow .2s ease; }
.stat-card:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.stat-value { font-size: 30px; font-weight: 700; }
.stat-label { color: var(--muted); font-size: 13px; margin-top: 6px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; transition: transform .2s ease, box-shadow .2s ease; }
.card:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.btn { background: var(--panel-2); border: 1px solid var(--border); color: var(--text); padding: 8px 14px; border-radius: var(--radius); transition: transform .1s ease, background .15s ease; }
.btn:hover { background: var(--border); } .btn:active { transform: scale(.97); }
.btn-primary { background: var(--primary); border-color: var(--primary); color: #0b1020; font-weight: 600; }
@keyframes shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
.skeleton { background: linear-gradient(90deg, var(--panel) 0%, var(--panel-2) 50%, var(--panel) 100%); background-size: 800px 100%; animation: shimmer 1.4s infinite; border-radius: var(--radius); height: 16px; }
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components
git commit -m "feat(web): app shell, sidebar, shared components + design tokens"
```

### Task 7: AI console drawer (streaming)

**Files:**
- Create: `apps/web/src/lib/aiConsole.tsx`

**Interfaces:**
- Consumes: `api.runMode`, `streamGet` from `useSSE.ts`.
- Produces: `openMode(mode, args, opts?)` global function; `<AIConsole/>` component; `useAIConsole()` hook returning `{ open, running, text, mode }`. `opts.onDone?(status)` callback so callers can refetch.

- [ ] **Step 1: Implement `lib/aiConsole.tsx`**

```tsx
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import { streamGet } from './useSSE';

type State = { open: boolean; running: boolean; mode: string | null; text: string; status: string | null };
let state: State = { open: false, running: false, mode: null, text: '', status: null };
const listeners = new Set<() => void>();
function set(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }

let onDoneCb: ((s: string) => void) | undefined;

export async function openMode(mode: string, args: any, opts?: { onDone?: (s: string) => void }) {
  onDoneCb = opts?.onDone;
  set({ open: true, running: true, mode, text: '', status: 'starting' });
  try {
    const { jobId } = await api.runMode(mode, args);
    streamGet(`/api/modes/stream/${jobId}`, (e) => {
      if (e.type === 'text' || e.type === 'result') set({ text: state.text + e.data });
      else if (e.type === 'status') set({ status: e.data });
      else if (e.type === 'stderr') set({ text: state.text + `\n[stderr] ${e.data}` });
      else if (e.type === 'done') { set({ running: false, status: e.data.status }); onDoneCb?.(e.data.status); }
    });
  } catch (err: any) {
    set({ running: false, status: 'error', text: String(err.message || err) });
  }
}
export function closeConsole() { set({ open: false }); }
export function useAIConsole() { return useSyncExternalStore(subscribe, () => state); }

export function AIConsole() {
  const s = useAIConsole();
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight); }, [s.text]);
  return (
    <aside className={`ai-console ${s.open ? 'open' : ''}`}>
      <header className="ai-head">
        <span className="mono">AI CONSOLE {s.mode ? `· /${s.mode}` : ''}</span>
        <button className="btn" onClick={closeConsole}>✕</button>
      </header>
      <div className="ai-body mono" ref={bodyRef}>
        {s.text}
        {s.running && <span className="cursor">▋</span>}
      </div>
      <footer className="ai-foot">{s.running ? `running… (${s.status})` : `done · ${s.status ?? ''}`}</footer>
    </aside>
  );
}
```

- [ ] **Step 2: Add AI console styles to `components/ui.css`**

```css
.ai-console { position: fixed; top: 0; right: 0; height: 100vh; width: 460px; max-width: 92vw; background: var(--panel); border-left: 1px solid var(--border); box-shadow: var(--shadow); transform: translateX(100%); transition: transform .32s cubic-bezier(.22,1,.36,1); display: flex; flex-direction: column; z-index: 50; }
.ai-console.open { transform: translateX(0); }
.ai-head, .ai-foot { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; color: var(--muted); font-size: 13px; }
.ai-foot { border-top: 1px solid var(--border); border-bottom: none; }
.ai-body { flex: 1; overflow: auto; padding: 18px; white-space: pre-wrap; font-size: 13px; line-height: 1.6; }
.cursor { animation: blink 1s steps(2) infinite; color: var(--accent); }
@keyframes blink { 50% { opacity: 0; } }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/aiConsole.tsx apps/web/src/components/ui.css
git commit -m "feat(web): streaming AI console drawer with spring-slide + token cursor"
```

---

## Phase 6 — Pages

### Task 8: Pipeline page (add URL, evaluate → AI console)

**Files:**
- Create: `apps/web/src/routes/pipeline.tsx`, `apps/web/src/components/PipelineBoard.tsx`

**Interfaces:**
- Consumes: `api.pipeline/addUrl/patchItem`, `openMode`, `StatusChip`.

- [ ] **Step 1: Implement `PipelineBoard.tsx`**

Group items into columns by a derived stage: `unevaluated` (`!checked`), `evaluated` (`checked && status !== 'go'`), `go` (`status includes 'go'`). Render columns of `.card`s; each card shows title/url + an **Evaluate** button calling:
```tsx
openMode('gig', { url: item.url }, { onDone: () => reload() });
```
Include an add-URL input at top calling `api.addUrl`. Optimistically set the card's status to `evaluating` while the console runs (local state), reverting on done+reload.

```tsx
import { useEffect, useState } from 'react';
import { api, PipelineItem } from '../lib/api';
import { openMode } from '../lib/aiConsole';
import { StatusChip } from './StatusChip';

export function PipelineBoard() {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = () => api.pipeline().then((r) => setItems(r.items)).finally(() => setLoading(false));
  useEffect(() => { reload(); }, []);
  const add = async () => { if (!url) return; await api.addUrl(url).catch(() => {}); setUrl(''); reload(); };
  const cols = {
    'To evaluate': items.filter((i) => !i.checked),
    'Evaluated': items.filter((i) => i.checked && !/go/i.test(i.status || '')),
    'Go': items.filter((i) => /go/i.test(i.status || '')),
  };
  return (
    <div>
      <div className="row">
        <input className="input" placeholder="Paste a gig URL…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn btn-primary" onClick={add}>Add</button>
      </div>
      {loading ? <div className="skeleton" style={{ height: 120, marginTop: 16 }} /> : (
        <div className="board">
          {Object.entries(cols).map(([name, list]) => (
            <div key={name} className="board-col">
              <h3 className="col-title">{name} <span className="mono">{list.length}</span></h3>
              {list.map((it) => (
                <div key={it.url} className="card gig-card">
                  <div className="gig-title">{it.title || it.url}</div>
                  <a className="gig-url mono" href={it.url} target="_blank" rel="noreferrer">{new URL(it.url).pathname.slice(0, 40)}</a>
                  <div className="gig-foot">
                    <StatusChip status={it.status} />
                    <button className="btn" onClick={() => openMode('gig', { url: it.url }, { onDone: reload })}>Evaluate</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `routes/pipeline.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { PipelineBoard } from '../components/PipelineBoard';
export const Route = createFileRoute('/pipeline')({
  component: () => (<div><h1 className="page-title">Pipeline</h1><PipelineBoard /></div>),
});
```

- [ ] **Step 3: Add board/input/page styles to `ui.css`**

```css
.page-title { font-size: 24px; margin: 0 0 20px; }
.row { display: flex; gap: 10px; }
.input { flex: 1; background: var(--panel); border: 1px solid var(--border); color: var(--text); padding: 10px 14px; border-radius: var(--radius); font-family: var(--mono); }
.input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(129,140,248,.2); }
.board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 20px; }
.col-title { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.gig-card { margin-bottom: 12px; }
.gig-title { font-weight: 600; margin-bottom: 6px; }
.gig-url { color: var(--muted); font-size: 12px; }
.gig-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
```

- [ ] **Step 4: Verify in-app**

Run `npm run ui:dev`, open `http://localhost:5273/pipeline`. Expect existing pipeline URLs render in "To evaluate". Click **Evaluate** → AI console slides in and streams `/gig` output. (Requires `claude` logged in.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/pipeline.tsx apps/web/src/components/PipelineBoard.tsx apps/web/src/components/ui.css
git commit -m "feat(web): pipeline board with evaluate → AI console"
```

### Task 9: Leads page + Reports page

**Files:**
- Create: `apps/web/src/routes/leads.tsx`, `apps/web/src/routes/reports.tsx`, `apps/web/src/components/Markdown.tsx`

**Interfaces:**
- Consumes: `api.leads/reports/report`, `openMode`, `StatusChip`.
- Produces: `<Markdown text/>` — a minimal markdown renderer (headings, bold, lists, code, links). Use a tiny inline renderer (no new dep): convert with regex to HTML and `dangerouslySetInnerHTML` (content is local, trusted).

- [ ] **Step 1: Implement `components/Markdown.tsx`**

```tsx
function render(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\- (.*)$/gm, '<li>$1</li>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\n{2,}/g, '<br/><br/>');
}
export function Markdown({ text }: { text: string }) {
  return <div className="md" dangerouslySetInnerHTML={{ __html: render(text) }} />;
}
```

- [ ] **Step 2: Implement `routes/leads.tsx`**

Render a table over `api.leads()`. Column keys are discovered from the first row (`Object.keys`) so it survives the leads-schema migration. Render a status column via `StatusChip` when a `status`/`Status` key exists; add a **Proposal** action per row calling `openMode('proposal', { report: row.report || row.Report || row.num })`.

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { openMode } from '../lib/aiConsole';
import { StatusChip } from '../components/StatusChip';

function Leads() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.leads().then((r) => setRows(r.leads)).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="skeleton" style={{ height: 200 }} />;
  if (!rows.length) return <div className="empty">No leads yet. Evaluate gigs from the Pipeline to create leads.</div>;
  const cols = Object.keys(rows[0]).filter((k) => k.toLowerCase() !== 'notes');
  return (
    <table className="tbl">
      <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}<th></th></tr></thead>
      <tbody>{rows.map((row, i) => (
        <tr key={i}>{cols.map((c) => <td key={c}>{/status/i.test(c) ? <StatusChip status={row[c]} /> : String(row[c] ?? '')}</td>)}
          <td><button className="btn" onClick={() => openMode('proposal', { report: row.report || row.Report || row.num || row['#'] })}>Proposal</button></td>
        </tr>
      ))}</tbody>
    </table>
  );
}
export const Route = createFileRoute('/leads')({ component: () => (<div><h1 className="page-title">Leads</h1><Leads /></div>) });
```

- [ ] **Step 3: Implement `routes/reports.tsx`**

Two-pane: list on the left (from `api.reports()`), rendered `<Markdown>` on the right (from `api.report(file)`).

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Markdown } from '../components/Markdown';

function Reports() {
  const [list, setList] = useState<any[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [md, setMd] = useState('');
  useEffect(() => { api.reports().then((r) => { setList(r.reports); if (r.reports[0]) setSel(r.reports[0].file); }); }, []);
  useEffect(() => { if (sel) api.report(sel).then((r) => setMd(r.markdown)); }, [sel]);
  return (
    <div className="split">
      <div className="split-list">
        {list.map((r) => <button key={r.file} className={`list-item ${sel === r.file ? 'active' : ''}`} onClick={() => setSel(r.file)}>
          <span className="mono">{r.num}</span> {r.slug}<div className="list-sub">{r.date}</div>
        </button>)}
        {!list.length && <div className="empty">No reports yet.</div>}
      </div>
      <div className="split-body card"><Markdown text={md} /></div>
    </div>
  );
}
export const Route = createFileRoute('/reports')({ component: () => (<div><h1 className="page-title">Reports</h1><Reports /></div>) });
```

- [ ] **Step 4: Add table/split/md/empty styles to `ui.css`**

```css
.tbl { width: 100%; border-collapse: collapse; }
.tbl th { text-align: left; color: var(--muted); font-size: 12px; text-transform: uppercase; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.tbl td { padding: 12px; border-bottom: 1px solid var(--border); font-size: 14px; }
.tbl tr:hover td { background: var(--panel); }
.empty { color: var(--muted); padding: 40px; text-align: center; border: 1px dashed var(--border); border-radius: var(--radius); }
.split { display: grid; grid-template-columns: 280px 1fr; gap: 16px; }
.split-list { display: flex; flex-direction: column; gap: 6px; }
.list-item { text-align: left; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; color: var(--text); transition: background .15s; }
.list-item:hover, .list-item.active { background: var(--panel-2); border-color: var(--accent); }
.list-sub { color: var(--muted); font-size: 12px; }
.split-body { min-height: 60vh; }
.md h1 { font-size: 22px; } .md h2 { font-size: 18px; } .md code { font-family: var(--mono); background: var(--panel-2); padding: 1px 5px; border-radius: 5px; }
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/leads.tsx apps/web/src/routes/reports.tsx apps/web/src/components/Markdown.tsx apps/web/src/components/ui.css
git commit -m "feat(web): leads table + reports viewer with proposal action"
```

### Task 10: Scan page

**Files:**
- Create: `apps/web/src/routes/scan.tsx`

**Interfaces:**
- Consumes: `streamPost` from `useSSE.ts`, `api.pipeline`.

- [ ] **Step 1: Implement `routes/scan.tsx`**

A "Run scan" button that calls `streamPost('/api/scan', { args: [] }, onEvent)`, appends `line` events to a live log panel (mono), and on `done` refetches pipeline count to show "N new gigs in pipeline".

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { streamPost } from '../lib/useSSE';
import { api } from '../lib/api';

function Scan() {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const run = () => {
    setLog([]); setRunning(true); setCount(null);
    streamPost('/api/scan', { args: [] }, (e) => {
      if (e.type === 'line' || e.type === 'stderr') setLog((l) => [...l, String(e.data)]);
      if (e.type === 'done') { setRunning(false); api.pipeline().then((r) => setCount(r.items.length)); }
    });
  };
  return (
    <div>
      <h1 className="page-title">Scan sources</h1>
      <button className="btn btn-primary" onClick={run} disabled={running}>{running ? 'Scanning…' : 'Run scan'}</button>
      {count !== null && <span style={{ marginLeft: 12, color: 'var(--accent)' }}>Pipeline now has {count} gigs.</span>}
      <pre className="scan-log mono">{log.join('\n')}</pre>
    </div>
  );
}
export const Route = createFileRoute('/scan')({ component: Scan });
```

- [ ] **Step 2: Add `.scan-log` style to `ui.css`**

```css
.scan-log { margin-top: 18px; background: #0b1220; border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; height: 50vh; overflow: auto; font-size: 12px; color: var(--accent); white-space: pre-wrap; }
```

- [ ] **Step 3: Verify**

Run `npm run ui:dev`, open `/scan`, click **Run scan**. Expect scan.mjs output streaming and a pipeline count on completion.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/scan.tsx apps/web/src/components/ui.css
git commit -m "feat(web): scan page with live streamed log"
```

### Task 11: Sources + Profile config pages (form + raw YAML)

**Files:**
- Create: `apps/web/src/routes/sources.tsx`, `apps/web/src/routes/profile.tsx`, `apps/web/src/components/ConfigEditor.tsx`

**Interfaces:**
- Consumes: `api.config/saveConfig`.
- Produces: `<ConfigEditor name/>` — a tabbed editor with a **Form** view (renders known fields) and a **Raw YAML** view (textarea over `raw`); Save persists via `api.saveConfig`. Because full form modeling of arbitrary YAML is large, v1 renders top-level scalar fields as inputs and provides the raw editor as the escape hatch for nested structures (as speced).

- [ ] **Step 1: Implement `components/ConfigEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function ConfigEditor({ name }: { name: string }) {
  const [raw, setRaw] = useState('');
  const [data, setData] = useState<any>({});
  const [tab, setTab] = useState<'form' | 'raw'>('form');
  const [saved, setSaved] = useState(false);
  useEffect(() => { api.config(name).then((r) => { setRaw(r.raw); setData(r.data || {}); }); }, [name]);
  const scalars = Object.entries(data).filter(([, v]) => typeof v !== 'object' || v === null);
  const save = async () => {
    if (tab === 'raw') await api.saveConfig(name, { raw });
    else await api.saveConfig(name, { data });
    setSaved(true); setTimeout(() => setSaved(false), 1500);
    api.config(name).then((r) => setRaw(r.raw));
  };
  return (
    <div>
      <div className="tabs">
        <button className={`tab ${tab === 'form' ? 'active' : ''}`} onClick={() => setTab('form')}>Form</button>
        <button className={`tab ${tab === 'raw' ? 'active' : ''}`} onClick={() => setTab('raw')}>Raw YAML</button>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
      </div>
      {tab === 'form' ? (
        <div className="form">
          {scalars.map(([k, v]) => (
            <label key={k} className="field">
              <span>{k}</span>
              <input className="input" value={String(v ?? '')} onChange={(e) => setData({ ...data, [k]: e.target.value })} />
            </label>
          ))}
          <p className="hint">Nested fields (lists, objects) are edited in the <b>Raw YAML</b> tab.</p>
        </div>
      ) : (
        <textarea className="yaml" value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `routes/sources.tsx` and `routes/profile.tsx`**

```tsx
// sources.tsx
import { createFileRoute } from '@tanstack/react-router';
import { ConfigEditor } from '../components/ConfigEditor';
export const Route = createFileRoute('/sources')({ component: () => (<div><h1 className="page-title">Sources</h1><ConfigEditor name="sources" /></div>) });
```
```tsx
// profile.tsx
import { createFileRoute } from '@tanstack/react-router';
import { ConfigEditor } from '../components/ConfigEditor';
export const Route = createFileRoute('/profile')({ component: () => (<div><h1 className="page-title">Profile</h1><ConfigEditor name="profile" /></div>) });
```

- [ ] **Step 3: Add tabs/form/yaml styles to `ui.css`**

```css
.tabs { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; }
.tab { background: none; border: 1px solid var(--border); color: var(--muted); padding: 8px 16px; border-radius: var(--radius); }
.tab.active { background: var(--panel-2); color: var(--text); border-color: var(--accent); }
.form { display: grid; gap: 14px; max-width: 640px; }
.field { display: grid; gap: 6px; } .field span { color: var(--muted); font-size: 13px; }
.hint { color: var(--muted); font-size: 13px; }
.yaml { width: 100%; min-height: 60vh; background: #0b1220; border: 1px solid var(--border); color: var(--text); border-radius: var(--radius); padding: 16px; font-family: var(--mono); font-size: 13px; line-height: 1.6; }
```

- [ ] **Step 4: Verify** — edit a scalar in `/profile`, Save, confirm `config/profile.yml` updated on disk (`git diff config/profile.yml`), then revert the test edit.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/sources.tsx apps/web/src/routes/profile.tsx apps/web/src/components/ConfigEditor.tsx apps/web/src/components/ui.css
git commit -m "feat(web): sources + profile config editors (form + raw YAML)"
```

### Task 12: Dashboard + Settings pages

**Files:**
- Modify: `apps/web/src/routes/index.tsx`
- Create: `apps/web/src/routes/settings.tsx`

**Interfaces:**
- Consumes: `api.stats/health`, `openMode`, `StatCard`.

- [ ] **Step 1: Implement dashboard `routes/index.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { StatCard } from '../components/StatCard';
import { openMode } from '../lib/aiConsole';

function Dashboard() {
  const [s, setS] = useState<any>(null);
  useEffect(() => { api.stats().then(setS); }, []);
  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <div className="grid-4">
        <StatCard label="In pipeline" value={s?.pipeline.total ?? '—'} accent="var(--primary)" />
        <StatCard label="Unevaluated" value={s?.pipeline.unevaluated ?? '—'} accent="var(--warn)" />
        <StatCard label="Total leads" value={s?.leads.total ?? '—'} accent="var(--accent)" />
        <StatCard label="Won" value={s?.leads.byStatus?.won ?? 0} accent="var(--go)" />
      </div>
      <div className="row" style={{ marginTop: 24 }}>
        <button className="btn btn-primary" onClick={() => (window.location.href = '/scan')}>Run a scan</button>
        <button className="btn" onClick={() => openMode('patterns', {})}>Analyze win/loss patterns</button>
      </div>
    </div>
  );
}
export const Route = createFileRoute('/')({ component: Dashboard });
```

- [ ] **Step 2: Implement `routes/settings.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

function Settings() {
  const [h, setH] = useState<any>(null);
  useEffect(() => { api.health().then(setH); }, []);
  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <div className="card" style={{ maxWidth: 560 }}>
        <h3>Claude Code bridge</h3>
        <p className="hint">Status: {h ? (h.claude ? <span style={{ color: 'var(--go)' }}>connected · {h.version}</span> : <span style={{ color: 'var(--danger)' }}>claude CLI not found on PATH</span>) : '…'}</p>
        <p className="hint">Repo root: <span className="mono">{h?.repoRoot}</span></p>
        <p className="hint">Set <span className="mono">GIGOPS_CLAUDE_BIN</span> to override the claude binary path.</p>
      </div>
    </div>
  );
}
export const Route = createFileRoute('/settings')({ component: Settings });
```

- [ ] **Step 3: Add `.grid-4` style to `ui.css`**

```css
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/index.tsx apps/web/src/routes/settings.tsx apps/web/src/components/ui.css
git commit -m "feat(web): dashboard stats + settings/health page"
```

---

## Phase 7 — Build, docs, verify

### Task 13: Production build wiring + README

**Files:**
- Create: `apps/README.md`
- Modify: `.gitignore` (ignore `apps/web/dist`, `apps/*/node_modules`)

- [ ] **Step 1: Update `.gitignore`**

Append:
```
apps/web/dist
apps/web/node_modules
apps/server/node_modules
```

- [ ] **Step 2: Build the web app**

Run: `npm run ui:build`
Expected: `apps/web/dist/index.html` produced, no TS errors.

- [ ] **Step 3: Full-stack smoke test (prod mode)**

Run: `npm run ui:build && NODE_ENV=production PORT=4317 node apps/server/index.mjs &` then `sleep 1 && curl -s http://127.0.0.1:4317/ | grep -o '<div id="root">'` then `kill %1`.
Expected: matches `<div id="root">` (static serve works).

- [ ] **Step 4: Write `apps/README.md`**

Document: `npm run ui:dev` (dev, ports 5273 web / 4317 api), `npm run ui:build`, `npm run ui` (prod, single port 4317), env vars `PORT`, `GIGOPS_ROOT`, `GIGOPS_CLAUDE_BIN`, and the note that AI actions require `claude` logged in. Explain the Cardinal Rule guarantee (UI only writes User Layer files on explicit action).

- [ ] **Step 5: Run all server tests**

Run: `npm run ui:test`
Expected: all tests across `files/cli/claude` pass.

- [ ] **Step 6: Commit**

```bash
git add .gitignore apps/README.md
git commit -m "docs: web UI build wiring + README"
```

### Task 14: End-to-end verification pass

- [ ] **Step 1:** Start `npm run ui:dev`. Walk every page: Dashboard shows stats; Pipeline lists existing URLs; Leads shows empty state; Reports empty state; Scan streams; Sources/Profile load YAML; Settings shows claude connected.
- [ ] **Step 2:** Add a URL in Pipeline → confirm it appears and `data/pipeline.md` gains the line (`git diff data/pipeline.md`), then revert.
- [ ] **Step 3:** Click Evaluate on one gig → AI console streams `/gig`, a report appears in Reports after done. (Confirms the full bridge.)
- [ ] **Step 4:** Confirm no User Layer file changed except the ones you intentionally acted on (`git status`).
- [ ] **Step 5:** Final commit if any fixes were needed.

---

## Self-Review Notes

- **Spec coverage:** architecture (Tasks 0,4,5), Cardinal Rule + atomic write (Task 1, verified Task 14), Claude bridge/SSE/FIFO queue (Task 3), all eight pages (Tasks 8–12), in-page actions for patterns/proposal/followup (Tasks 9,12), design tokens + micro-interactions (Tasks 6,7), error handling as JSON→toast/empty states (routes + pages), testing (Tasks 1–3, 13). Deferred items stay deferred.
- **Leads migration risk:** handled by schema-passthrough (Task 9 discovers columns from data).
- **Type consistency:** `PipelineItem`, `openMode(mode,args,opts)`, `streamGet/streamPost`, `api.*` names are used identically across tasks.
