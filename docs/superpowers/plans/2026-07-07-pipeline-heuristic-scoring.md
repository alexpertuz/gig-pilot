# Pipeline Heuristic Scoring (Tier 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every gig in the pipeline a single 0–5 score with reasons the moment it's scanned, and surface it (plus real title, source, date, budget) on a ranked, junk-sinking, staleness-aware pipeline board.

**Architecture:** A pure heuristic scorer (`score-heuristic.mjs`) reads `data/pipeline.md` + `data/scan-history.tsv` + `config/profile.yml`, computes the existing 6-block rubric from mechanical signals, and writes a derived `data/scores.json`. `scan.mjs` invokes it after each scan. The web server merges `scores.json` + `scan-history.tsv` into the `/api/pipeline` response; the board renders one score per card, sorted, with a "Passed on" junk section and staleness fading.

**Tech Stack:** Plain ESM Node.js (`.mjs`, no build step), `node:test` + `node:assert/strict`, `js-yaml` (existing dep), Express (existing root dep, `^4.19.2`), React + TanStack Router (`apps/web`).

## Global Constraints

- **Cardinal rule:** never mutate User Layer files. `data/pipeline.md` is read-only to this feature. Scores live only in the derived `data/scores.json`.
- **`data/scores.json` is derived** — gitignored, rebuildable from `pipeline.md` + `scan-history.tsv` + `profile.yml`.
- All new runtime code is plain ESM `.mjs`. No new runtime dependencies.
- Rubric is fixed (`modes/_shared.md`): blocks A 25%, B 25%, C 20%, D 15%, E 10%, F 5%; total 0–5; **≥4.0 GO, 3.0–3.9 NEGOTIATE, <3.0 DECLINE**; Budget block == 1 → automatic DECLINE.
- Tier 1 only ever writes `state: "estimated"`. The `state`/`report` fields exist for the Tier-2 follow-up plan but are never set to `"evaluated"` here.
- Profile reads MUST be defensive (optional chaining + fallbacks) — a user's `profile.yml` may omit any field.

## Scope

**In:** heuristic scorer, `scores.json`, `scan.mjs` hook, server merge, board redesign, junk/staleness.
**Out (separate plan):** Claude batch auto-eval (Tier 2), proposals, tracker, leads, `gemini-eval.mjs`.

## File Structure

- Create `score-heuristic.mjs` (repo root) — pure scoring + I/O orchestration + CLI. Exports `parseBudget`, `scoreGig`, `scoreAll`.
- Create `score-heuristic.test.mjs` (repo root) — unit tests for the pure functions.
- Modify `.gitignore` — add `data/scores.json`.
- Modify `scan.mjs` — call `scoreAll()` after the pipeline is written.
- Modify `apps/server/lib/paths.mjs` — add `scores` path.
- Modify `apps/server/lib/files.mjs` — add `readScores`, `readScanHistory`, `mergePipeline`.
- Create `apps/server/test/scoring.test.mjs` — tests for the merge helpers.
- Modify `apps/server/routes/pipeline.mjs` — GET enriches items via merge.
- Modify `apps/web/src/lib/api.ts` — extend `PipelineItem`.
- Modify `apps/web/src/components/PipelineBoard.tsx` — new card, sorting, junk section, staleness.

---

### Task 1: Budget parser

**Files:**
- Create: `score-heuristic.mjs`
- Test: `score-heuristic.test.mjs`

**Interfaces:**
- Produces: `parseBudget(text: string) -> { raw: string, min: number|null, max: number|null, unit: "hourly"|"project"|null } | null` — returns `null` when no money signal is found.

- [ ] **Step 1: Write the failing test**

```js
// score-heuristic.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBudget } from './score-heuristic.mjs';

test('parseBudget reads an hourly range', () => {
  const b = parseBudget('[Hiring] Graphic Designer contract $25 - $35/hourly');
  assert.equal(b.unit, 'hourly');
  assert.equal(b.min, 25);
  assert.equal(b.max, 35);
});

test('parseBudget reads a single hourly rate', () => {
  const b = parseBudget('data annotation remote $20/hr');
  assert.equal(b.unit, 'hourly');
  assert.equal(b.max, 20);
});

test('parseBudget reads a project amount', () => {
  const b = parseBudget('need a floor plan rendered, budget $100');
  assert.equal(b.unit, 'project');
  assert.equal(b.max, 100);
});

test('parseBudget returns null when no money is present', () => {
  assert.equal(parseBudget('dialogue editor for audio drama, long-term'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test score-heuristic.test.mjs`
Expected: FAIL — `parseBudget` is not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

```js
// score-heuristic.mjs
const HOURLY_HINT = /\b(hour|hourly|\/\s*hr|per hour|\/hr|an hour)\b/i;

export function parseBudget(text) {
  if (!text) return null;
  const amounts = [];
  // $25, $1,200, $35.50 — capture the numeric value
  const re = /\$\s*([\d,]+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n)) amounts.push(n);
  }
  if (amounts.length === 0) return null;
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const unit = HOURLY_HINT.test(text) || max <= 200 ? 'hourly' : 'project';
  // A bare "$100" with no hourly hint reads as a small project; keep the heuristic
  // simple: hourly hint wins, otherwise small numbers are hourly, large are project.
  const resolvedUnit = HOURLY_HINT.test(text) ? 'hourly' : max >= 200 ? 'project' : 'hourly';
  return {
    raw: text.match(/\$[\s\d,.\-–to/a-z]*/i)?.[0]?.trim() ?? `$${max}`,
    min: amounts.length > 1 ? min : null,
    max,
    unit: resolvedUnit,
  };
}
```

> Note: the `unit` local is unused; keep only `resolvedUnit`. Inline it if you prefer — the test only checks `resolvedUnit`'s value via the returned `unit`. Rename `resolvedUnit` to `unit` in the return and delete the dead line:

```js
  const unit = HOURLY_HINT.test(text) ? 'hourly' : max >= 200 ? 'project' : 'hourly';
  return {
    raw: text.match(/\$[\s\d,.\-–to/a-z]*/i)?.[0]?.trim() ?? `$${max}`,
    min: amounts.length > 1 ? min : null,
    max,
    unit,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test score-heuristic.test.mjs`
Expected: PASS (4 budget tests).

- [ ] **Step 5: Commit**

```bash
git add score-heuristic.mjs score-heuristic.test.mjs
git commit -m "feat(scoring): budget parser for heuristic gig scoring"
```

---

### Task 2: Block scorers and `scoreGig`

**Files:**
- Modify: `score-heuristic.mjs`
- Test: `score-heuristic.test.mjs`

**Interfaces:**
- Consumes: `parseBudget` (Task 1).
- Produces:
  `scoreGig(gig, profile) -> { score: number, blocks: {A,B,C,D,E,F}, reasons: string[], redFlags: string[], verdict: "GO"|"NEGOTIATE"|"DECLINE", budget }`
  where `gig = { title, body, source, firstSeen, url }` (any field may be `""`/`null`) and `profile` is the parsed `profile.yml` object. `score` is rounded to 1 decimal. Blocks are 1–5.

- [ ] **Step 1: Write the failing test**

```js
// append to score-heuristic.test.mjs
import { scoreGig } from './score-heuristic.mjs';

const PROFILE = {
  services: { primary: ['Full-stack development'] },
  archetypes: [
    { name: 'Frontend', stack: ['React.js', 'Next.js', 'Node.js'] },
    { name: 'Backend', stack: ['Node.js', 'FastAPI', 'Python', 'PostgreSQL'] },
  ],
  rate_card: {
    hourly: { target: 75, walk_away: 40 },
    project: { min: 500 },
    declined_models: ['unpaid', 'equity', 'revenue_share'],
  },
  ideal_gig: {
    green_flags: ['clear scope', 'ongoing'],
    yellow_flags: ['quick', 'just need', 'simple'],
    avoid_scope: ['unpaid test task'],
  },
};

test('scoreGig hard-declines an unpaid gig regardless of fit', () => {
  const r = scoreGig(
    { title: 'React dev needed for equity only, no budget', body: '', source: 'r/forhire', firstSeen: '2026-07-06' },
    PROFILE,
  );
  assert.equal(r.verdict, 'DECLINE');
  assert.ok(r.redFlags.length >= 1);
});

test('scoreGig flags a job-seeker post as decline', () => {
  const r = scoreGig(
    { title: '21M looking for work, any job', body: '', source: 'r/jobbit', firstSeen: '2026-07-01' },
    PROFILE,
  );
  assert.equal(r.verdict, 'DECLINE');
  assert.ok(r.redFlags.some((f) => /job-seeker/i.test(f)));
});

test('scoreGig rewards a well-paid on-archetype gig', () => {
  const r = scoreGig(
    { title: '[Hiring] React + Node dashboard, ongoing, $90/hr', body: 'clear scope', source: 'r/forhire', firstSeen: '2026-07-06' },
    PROFILE,
  );
  assert.ok(r.score >= 4.0, `expected GO-range score, got ${r.score}`);
  assert.equal(r.verdict, 'GO');
  assert.ok(r.reasons.some((x) => /archetype|React|Node/i.test(x)));
});

test('scoreGig marks below-walk-away rate as negotiate-or-lower', () => {
  const r = scoreGig(
    { title: '[Hiring] React work $20/hr', body: '', source: 'r/forhire', firstSeen: '2026-07-06' },
    PROFILE,
  );
  assert.ok(r.blocks.B <= 2, `budget block should be low, got ${r.blocks.B}`);
  assert.ok(r.reasons.some((x) => /walk-away|below/i.test(x)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test score-heuristic.test.mjs`
Expected: FAIL — `scoreGig` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `score-heuristic.mjs`:

```js
const JOB_SEEKER = [
  'looking for a job', 'looking for work', 'looking for any', 'looking for a part',
  'looking for side', 'need a job', 'hire me', 'i am available for', 'seeking work',
  'looking for people ready to work', 'willing to learn',
];
const SCAM = [
  'daily income', 'turn your charm', '% from each', 'earn 50', 'earn $', 'copy paste',
  'copy-paste', 'per day', '/day', 'passive income', 'no experience needed',
];

const lc = (s) => (s || '').toLowerCase();
const clamp = (n, lo = 1, hi = 5) => Math.max(lo, Math.min(hi, n));

function archetypeKeywords(profile) {
  const stacks = (profile.archetypes || []).flatMap((a) => a.stack || []);
  const services = [
    ...(Array.isArray(profile.services?.primary) ? profile.services.primary : []),
    ...(Array.isArray(profile.services?.secondary) ? profile.services.secondary : []),
  ];
  return [...stacks, ...services]
    .map((s) => lc(s).replace(/\.js$/, '').trim())
    .filter(Boolean);
}

function daysSince(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

export function scoreGig(gig, profile = {}) {
  const text = lc(`${gig.title || ''} ${gig.body || ''}`);
  const reasons = [];
  const redFlags = [];
  const rc = profile.rate_card || {};
  const declined = (rc.declined_models || ['unpaid', 'equity', 'revenue_share']).map((d) =>
    lc(d).replace(/_/g, ' '),
  );

  // ---- Hard-decline signals ----
  let hardDecline = false;
  for (const phrase of declined.concat(['unpaid', 'for exposure', 'for your portfolio'])) {
    if (text.includes(phrase)) {
      redFlags.push(`Unpaid/declined model: "${phrase}"`);
      hardDecline = true;
    }
  }
  for (const phrase of JOB_SEEKER) {
    if (text.includes(phrase)) {
      redFlags.push(`Job-seeker, not a client: "${phrase}"`);
      hardDecline = true;
      break;
    }
  }
  for (const phrase of SCAM) {
    if (text.includes(phrase)) {
      redFlags.push(`Scam pattern: "${phrase}"`);
      hardDecline = true;
      break;
    }
  }

  // ---- B: Budget ----
  const budget = parseBudget(`${gig.title || ''} ${gig.body || ''}`);
  const walk = rc.hourly?.walk_away ?? 30;
  const target = rc.hourly?.target ?? 60;
  const projMin = rc.project?.min ?? 300;
  let B = 2.5;
  if (declined.some((d) => text.includes(d))) {
    B = 1;
    reasons.push('Budget: unpaid / declined model');
  } else if (budget) {
    if (budget.unit === 'hourly') {
      const rate = budget.max;
      if (rate < walk) { B = 1.5; reasons.push(`$${rate}/hr below $${walk} walk-away`); }
      else if (rate < target) { B = 3.5; reasons.push(`$${rate}/hr between walk-away and target`); }
      else { B = 5; reasons.push(`$${rate}/hr at or above $${target} target`); }
    } else {
      const val = budget.max;
      if (val < projMin) { B = 2; reasons.push(`$${val} project below $${projMin} minimum`); }
      else { B = 4; reasons.push(`$${val} project at or above minimum`); }
    }
  } else {
    reasons.push('Budget not specified');
  }

  // ---- A: Archetype fit ----
  const keys = archetypeKeywords(profile);
  const hits = [...new Set(keys.filter((k) => k && text.includes(k)))];
  let A;
  if (hits.length >= 2) { A = 5; reasons.push(`Strong archetype match: ${hits.slice(0, 3).join(', ')}`); }
  else if (hits.length === 1) { A = 3.5; reasons.push(`Partial archetype match: ${hits[0]}`); }
  else { A = 2; reasons.push('No archetype keyword match'); }

  // ---- C: Scope clarity (nudged only) ----
  const green = (profile.ideal_gig?.green_flags || []).map(lc);
  const yellow = (profile.ideal_gig?.yellow_flags || []).map(lc);
  const avoid = (profile.ideal_gig?.avoid_scope || []).map(lc);
  let C = 2.5;
  C += Math.min(1.5, green.filter((g) => g && text.includes(g)).length * 0.75);
  C -= Math.min(1.5, yellow.filter((y) => y && text.includes(y)).length * 0.75);
  if (avoid.some((a) => a && text.includes(a))) C = Math.min(C, 2);
  C = clamp(C);

  // ---- D: Legitimacy (nudged only) ----
  let D = 3;
  if (hardDecline) D = 1;

  // ---- E: Channel ----
  let E = 3;
  if (/\b(dm|pm me|message me)\b/.test(text)) E = 3.5;
  else if (/@|\bemail\b/.test(text)) E = 4;

  // ---- F: Timing ----
  const age = daysSince(gig.firstSeen);
  let F = 3;
  if (age === null) F = 3;
  else if (age <= 7) F = 5;
  else if (age <= 21) F = 4;
  else if (age <= 45) F = 3;
  else if (age <= 90) F = 2;
  else { F = 1; reasons.push(`Stale: ${age} days old`); }

  const blocks = { A, B, C, D, E, F };
  let score = A * 0.25 + B * 0.25 + C * 0.2 + D * 0.15 + E * 0.1 + F * 0.05;
  score = Math.round(score * 10) / 10;

  let verdict;
  if (hardDecline || B === 1) verdict = 'DECLINE';
  else if (score >= 4.0) verdict = 'GO';
  else if (score >= 3.0) verdict = 'NEGOTIATE';
  else verdict = 'DECLINE';

  return { score, blocks, reasons, redFlags, verdict, budget };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test score-heuristic.test.mjs`
Expected: PASS (all budget + scoreGig tests).

- [ ] **Step 5: Commit**

```bash
git add score-heuristic.mjs score-heuristic.test.mjs
git commit -m "feat(scoring): 6-block heuristic scoreGig with red-flag detection"
```

---

### Task 3: `scoreAll` I/O + CLI + gitignore

**Files:**
- Modify: `score-heuristic.mjs`
- Test: `score-heuristic.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `scoreGig` (Task 2).
- Produces: `scoreAll({ pipelinePath, scanHistoryPath, profilePath, scoresPath }) -> Promise<Record<url, ScoreEntry>>` where
  `ScoreEntry = { title, source, first_seen, budget, score, blocks, reasons, redFlags, verdict, state: "estimated", report: null, scoredAt }`.
  Also writes that object as JSON to `scoresPath`.

- [ ] **Step 1: Write the failing test**

```js
// append to score-heuristic.test.mjs
import { scoreAll } from './score-heuristic.mjs';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('scoreAll writes one scored entry per pipeline url', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gigscore-'));
  const pipeline = join(dir, 'pipeline.md');
  const history = join(dir, 'scan-history.tsv');
  const profile = join(dir, 'profile.yml');
  const scores = join(dir, 'scores.json');

  await writeFile(
    pipeline,
    '# Pipeline\n## Pending\n- [ ] https://x.test/a |  | [Hiring] React dev $90/hr\n- [ ] https://x.test/b |  | 21M looking for work\n',
  );
  await writeFile(
    history,
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n' +
      'https://x.test/a\t2026-07-06\treddit-api\t[Hiring] React dev $90/hr\t\tadded\tremote\n',
  );
  await writeFile(
    profile,
    'archetypes:\n  - name: FE\n    stack: ["React.js", "Node.js"]\nrate_card:\n  hourly:\n    target: 75\n    walk_away: 40\n',
  );

  const out = await scoreAll({ pipelinePath: pipeline, scanHistoryPath: history, profilePath: profile, scoresPath: scores });
  assert.equal(Object.keys(out).length, 2);
  assert.equal(out['https://x.test/a'].verdict, 'GO');
  assert.equal(out['https://x.test/b'].verdict, 'DECLINE');
  assert.equal(out['https://x.test/a'].state, 'estimated');

  const onDisk = JSON.parse(await readFile(scores, 'utf8'));
  assert.equal(onDisk['https://x.test/a'].score, out['https://x.test/a'].score);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test score-heuristic.test.mjs`
Expected: FAIL — `scoreAll` not exported.

- [ ] **Step 3: Write minimal implementation**

Add imports at the **top** of `score-heuristic.mjs`:

```js
import { readFile, writeFile } from 'node:fs/promises';
import yaml from 'js-yaml';
```

Append to `score-heuristic.mjs`:

```js
const PIPE_LINE = /^- \[( |x)\]\s+(.+)$/;

function parsePipelineLines(text) {
  const items = [];
  for (const raw of text.split('\n')) {
    const m = raw.match(PIPE_LINE);
    if (!m) continue;
    const parts = m[2].split('|').map((s) => s.trim());
    const url = parts[0];
    if (!/^https?:\/\//.test(url)) continue;
    items.push({ url, status: parts[1] || null, title: parts[2] || null });
  }
  return items;
}

function parseScanHistory(text) {
  const rows = {};
  const lines = text.split('\n').filter(Boolean);
  if (lines.length === 0) return rows;
  const header = lines[0].split('\t');
  const idx = (name) => header.indexOf(name);
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    const url = cols[idx('url')];
    if (!url) continue;
    rows[url] = {
      first_seen: cols[idx('first_seen')] || null,
      portal: cols[idx('portal')] || null,
      title: cols[idx('title')] || null,
      location: cols[idx('location')] || null,
    };
  }
  return rows;
}

function sourceFromUrl(url) {
  const m = url.match(/reddit\.com\/r\/([^/]+)/i);
  if (m) return `r/${m[1]}`;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

export async function scoreAll({ pipelinePath, scanHistoryPath, profilePath, scoresPath }) {
  const [pipelineText, historyText, profileText] = await Promise.all([
    readFile(pipelinePath, 'utf8').catch(() => ''),
    readFile(scanHistoryPath, 'utf8').catch(() => ''),
    readFile(profilePath, 'utf8').catch(() => ''),
  ]);
  const profile = (profileText && yaml.load(profileText)) || {};
  const items = parsePipelineLines(pipelineText);
  const history = parseScanHistory(historyText);

  const out = {};
  for (const it of items) {
    const h = history[it.url] || {};
    const title = h.title || it.title || it.url;
    const gig = {
      url: it.url,
      title,
      body: '',
      source: sourceFromUrl(it.url) || h.portal || null,
      firstSeen: h.first_seen || null,
    };
    const r = scoreGig(gig, profile);
    out[it.url] = {
      title,
      source: gig.source,
      first_seen: gig.firstSeen,
      budget: r.budget,
      score: r.score,
      blocks: r.blocks,
      reasons: r.reasons,
      redFlags: r.redFlags,
      verdict: r.verdict,
      state: 'estimated',
      report: null,
      scoredAt: new Date().toISOString(),
    };
  }
  await writeFile(scoresPath, JSON.stringify(out, null, 2));
  return out;
}
```

Add a CLI entry at the **end** of `score-heuristic.mjs`:

```js
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = process.cwd();
  scoreAll({
    pipelinePath: path.join(root, 'data', 'pipeline.md'),
    scanHistoryPath: path.join(root, 'data', 'scan-history.tsv'),
    profilePath: path.join(root, 'config', 'profile.yml'),
    scoresPath: path.join(root, 'data', 'scores.json'),
  })
    .then((out) => console.log(`Scored ${Object.keys(out).length} gigs → data/scores.json`))
    .catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 2b: Add scores.json to .gitignore**

Add this line to `.gitignore` (near the existing `data/leads.db` entry):

```
data/scores.json
```

- [ ] **Step 4: Run tests and a real end-to-end pass**

Run: `node --test score-heuristic.test.mjs`
Expected: PASS.

Run: `node score-heuristic.mjs`
Expected: prints `Scored 127 gigs → data/scores.json` (count matches your real pipeline) and creates `data/scores.json`.

- [ ] **Step 5: Commit**

```bash
git add score-heuristic.mjs score-heuristic.test.mjs .gitignore
git commit -m "feat(scoring): scoreAll writes derived data/scores.json + CLI"
```

---

### Task 4: Run scoring after each scan

**Files:**
- Modify: `scan.mjs`

**Interfaces:**
- Consumes: `scoreAll` (Task 3).

- [ ] **Step 1: Locate the end of the scan run**

Run: `grep -n "pipeline.md\|Done\|console.log\|main(" scan.mjs | tail -20`
Identify the point after new URLs have been written to `data/pipeline.md` (the end of the main scan routine).

- [ ] **Step 2: Add the scoring call**

At the top of `scan.mjs`, add:

```js
import { scoreAll } from './score-heuristic.mjs';
```

After the pipeline write completes (end of the main flow), add:

```js
try {
  const scored = await scoreAll({
    pipelinePath: 'data/pipeline.md',
    scanHistoryPath: 'data/scan-history.tsv',
    profilePath: 'config/profile.yml',
    scoresPath: 'data/scores.json',
  });
  console.log(`Scored ${Object.keys(scored).length} gigs → data/scores.json`);
} catch (e) {
  console.error('Heuristic scoring failed (non-fatal):', e.message);
}
```

> Scoring failure must never fail a scan — keep it in the try/catch. If `scan.mjs`'s main flow is not `async`, wrap the call in the existing final `.then()`/callback instead; do not convert the whole file to top-level await.

- [ ] **Step 3: Verify end-to-end**

Run: `node scan.mjs` (or `npm run scan`)
Expected: scan completes and prints the `Scored N gigs` line; `data/scores.json` is refreshed.

- [ ] **Step 4: Commit**

```bash
git add scan.mjs
git commit -m "feat(scoring): run heuristic scoring at the end of every scan"
```

---

### Task 5: Server merge helpers

**Files:**
- Modify: `apps/server/lib/paths.mjs`
- Modify: `apps/server/lib/files.mjs`
- Test: `apps/server/test/scoring.test.mjs` (create)

**Interfaces:**
- Consumes: existing `parsePipeline` from `files.mjs`.
- Produces (in `files.mjs`):
  - `readScores() -> Promise<Record<url, ScoreEntry>>` (returns `{}` if file missing).
  - `readScanHistory() -> Promise<Record<url, {first_seen, portal, title, location}>>`.
  - `mergePipeline(items, scores, history) -> EnrichedItem[]` where `EnrichedItem` adds `score, verdict, state, budget, source, firstSeen, reasons, redFlags, report` (nulls when unscored).

- [ ] **Step 1: Add the scores path**

In `apps/server/lib/paths.mjs`, add to the `paths` object (after `scanHistory`):

```js
  scores: path.join(REPO_ROOT, 'data', 'scores.json'),
```

- [ ] **Step 2: Write the failing test**

```js
// apps/server/test/scoring.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePipeline } from '../lib/files.mjs';

test('mergePipeline enriches items and leaves unscored ones with nulls', () => {
  const items = [
    { url: 'https://x.test/a', status: null, title: 'A', checked: false },
    { url: 'https://x.test/b', status: null, title: 'B', checked: false },
  ];
  const scores = {
    'https://x.test/a': {
      title: 'A real', source: 'r/forhire', first_seen: '2026-07-06',
      budget: { max: 90, unit: 'hourly' }, score: 4.3, verdict: 'GO',
      blocks: {}, reasons: ['x'], redFlags: [], state: 'estimated', report: null,
    },
  };
  const history = { 'https://x.test/b': { first_seen: '2026-05-01', title: 'B hist', portal: 'reddit-api', location: 'remote' } };

  const merged = mergePipeline(items, scores, history);
  const a = merged.find((i) => i.url === 'https://x.test/a');
  const b = merged.find((i) => i.url === 'https://x.test/b');

  assert.equal(a.score, 4.3);
  assert.equal(a.verdict, 'GO');
  assert.equal(a.title, 'A real');
  assert.equal(a.firstSeen, '2026-07-06');
  assert.equal(b.score, null);
  assert.equal(b.verdict, null);
  assert.equal(b.title, 'B hist');       // falls back to history title
  assert.equal(b.firstSeen, '2026-05-01');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test apps/server/test/scoring.test.mjs`
Expected: FAIL — `mergePipeline` not exported.

- [ ] **Step 4: Implement in `apps/server/lib/files.mjs`**

Add near the top (the file already imports `fs`, `path`, `yaml`, `paths`):

```js
export async function readScores() {
  const text = await fs.readFile(paths.scores, 'utf8').catch(() => '');
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

export async function readScanHistory() {
  const text = await fs.readFile(paths.scanHistory, 'utf8').catch(() => '');
  const rows = {};
  const lines = text.split('\n').filter(Boolean);
  if (lines.length === 0) return rows;
  const header = lines[0].split('\t');
  const idx = (n) => header.indexOf(n);
  for (const line of lines.slice(1)) {
    const c = line.split('\t');
    const url = c[idx('url')];
    if (!url) continue;
    rows[url] = {
      first_seen: c[idx('first_seen')] || null,
      portal: c[idx('portal')] || null,
      title: c[idx('title')] || null,
      location: c[idx('location')] || null,
    };
  }
  return rows;
}

export function mergePipeline(items, scores = {}, history = {}) {
  return items.map((it) => {
    const s = scores[it.url] || null;
    const h = history[it.url] || null;
    return {
      ...it,
      title: (s && s.title) || (h && h.title) || it.title || it.url,
      source: (s && s.source) || (h && h.portal) || null,
      firstSeen: (s && s.first_seen) || (h && h.first_seen) || null,
      budget: s ? s.budget : null,
      score: s ? s.score : null,
      verdict: s ? s.verdict : null,
      state: s ? s.state : null,
      reasons: s ? s.reasons : [],
      redFlags: s ? s.redFlags : [],
      report: s ? s.report : null,
    };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test apps/server/test/scoring.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/lib/paths.mjs apps/server/lib/files.mjs apps/server/test/scoring.test.mjs
git commit -m "feat(ui-server): merge scores + scan-history into pipeline items"
```

---

### Task 6: Enrich the `/api/pipeline` GET response

**Files:**
- Modify: `apps/server/routes/pipeline.mjs`

**Interfaces:**
- Consumes: `readScores`, `readScanHistory`, `mergePipeline` (Task 5), existing `readPipeline`.

- [ ] **Step 1: Update the imports and GET handler**

Replace the top import and the `r.get('/')` line in `apps/server/routes/pipeline.mjs`:

```js
import { Router } from 'express';
import { readPipeline, writePipeline, readScores, readScanHistory, mergePipeline } from '../lib/files.mjs';

const r = Router();
r.get('/', async (_req, res) => {
  const [items, scores, history] = await Promise.all([readPipeline(), readScores(), readScanHistory()]);
  res.json({ items: mergePipeline(items, scores, history) });
});
```

Leave the existing `POST` and `PATCH` handlers unchanged.

- [ ] **Step 2: Verify by hand**

Run (in one terminal): `npm run ui:server`
Run (in another): `curl -s localhost:3000/api/pipeline | head -c 600`
Expected: items now include `score`, `verdict`, `firstSeen`, `budget`, `source` keys (values populated for gigs present in `data/scores.json`).

> If the port differs, read it from the server's startup log.

- [ ] **Step 3: Run the server test suite**

Run: `npm run ui:test`
Expected: PASS (existing + new `scoring.test.mjs`).

- [ ] **Step 4: Commit**

```bash
git add apps/server/routes/pipeline.mjs
git commit -m "feat(ui-server): /api/pipeline returns scored, enriched items"
```

---

### Task 7: Extend the web API type

**Files:**
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Produces: extended `PipelineItem` used by `PipelineBoard`.

- [ ] **Step 1: Replace the `PipelineItem` interface**

In `apps/web/src/lib/api.ts`:

```ts
export interface Budget {
  raw?: string;
  min?: number | null;
  max?: number | null;
  unit?: 'hourly' | 'project' | null;
}

export interface PipelineItem {
  url: string;
  status: string | null;
  title: string | null;
  checked: boolean;
  score: number | null;
  verdict: 'GO' | 'NEGOTIATE' | 'DECLINE' | null;
  state: 'estimated' | 'evaluated' | null;
  budget: Budget | null;
  source: string | null;
  firstSeen: string | null;
  reasons: string[];
  redFlags: string[];
  report: string | null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm --prefix apps/web run build`
Expected: build succeeds (TypeScript sees the new optional fields; `PipelineBoard` still compiles because it only reads existing fields until Task 8).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): extend PipelineItem with score fields"
```

---

### Task 8: Redesign the pipeline board

**Files:**
- Modify: `apps/web/src/components/PipelineBoard.tsx`

**Interfaces:**
- Consumes: extended `PipelineItem` (Task 7), existing `api.pipeline()`, `openMode`, `StatusChip`.

This task is UI; verification is by running the app (no unit-test harness exists in `apps/web`). Follow the existing component's imports/patterns.

- [ ] **Step 1: Implement the new board**

Replace the body of `apps/web/src/components/PipelineBoard.tsx` with a version that:

1. Fetches `api.pipeline()`.
2. Splits items into **active** (`verdict !== 'DECLINE'` or unscored) and **passedOn** (`verdict === 'DECLINE'`).
3. Sorts active by `score` descending (unscored, `score === null`, sort last).
4. Renders each active card with: **score badge** colored by verdict, the small `state` marker, title, `source` · relative `firstSeen`, budget (`budget.raw` or `${min}–{max}/{unit}`), top 2 `reasons`, red-flag chips, and the existing **Evaluate** button (`openMode('gig', { url })`).
5. Fades cards whose `firstSeen` is older than 45 days (add a `stale` class).
6. Renders `passedOn` collapsed under a "Passed on ({n})" toggle.

```tsx
import { useEffect, useMemo, useState } from 'react';
import { api, type PipelineItem } from '../lib/api';
import { openMode } from '../lib/aiConsole';

const VERDICT_COLOR: Record<string, string> = {
  GO: 'var(--go)',
  NEGOTIATE: 'var(--warn)',
  DECLINE: 'var(--danger, #c0392b)',
};

function relDays(iso: string | null): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (Number.isNaN(days)) return '';
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

function budgetLabel(it: PipelineItem): string {
  const b = it.budget;
  if (!b) return '';
  if (b.raw) return b.raw;
  const unit = b.unit === 'hourly' ? '/hr' : '';
  if (b.min && b.max && b.min !== b.max) return `$${b.min}–${b.max}${unit}`;
  if (b.max) return `$${b.max}${unit}`;
  return '';
}

function isStale(iso: string | null): boolean {
  if (!iso) return false;
  return (Date.now() - Date.parse(iso)) / 86400000 > 45;
}

function Card({ it }: { it: PipelineItem }) {
  const color = it.verdict ? VERDICT_COLOR[it.verdict] : 'var(--muted, #888)';
  return (
    <div className={`card gig-card ${isStale(it.firstSeen) ? 'stale' : ''}`}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <a href={it.url} target="_blank" rel="noreferrer" className="gig-title">
            {it.title || it.url}
          </a>
          <div className="gig-meta">
            {it.source && <span>{it.source}</span>}
            {it.firstSeen && <span> · {relDays(it.firstSeen)}</span>}
            {budgetLabel(it) && <span> · {budgetLabel(it)}</span>}
          </div>
        </div>
        <div className="gig-score" style={{ color, borderColor: color }}>
          <span className="gig-score-num">{it.score ?? '—'}</span>
          {it.state && <span className="gig-score-state">{it.state}</span>}
        </div>
      </div>
      {it.reasons?.length > 0 && (
        <ul className="gig-reasons">
          {it.reasons.slice(0, 2).map((rn, i) => <li key={i}>{rn}</li>)}
        </ul>
      )}
      {it.redFlags?.length > 0 && (
        <div className="gig-flags">
          {it.redFlags.map((f, i) => <span key={i} className="flag-chip">{f}</span>)}
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn btn-sm" onClick={() => openMode('gig', { url: it.url })}>
          Evaluate
        </button>
      </div>
    </div>
  );
}

export function PipelineBoard() {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [showPassed, setShowPassed] = useState(false);

  useEffect(() => {
    api.pipeline().then((r) => setItems(r.items));
  }, []);

  const { active, passedOn } = useMemo(() => {
    const active: PipelineItem[] = [];
    const passedOn: PipelineItem[] = [];
    for (const it of items) (it.verdict === 'DECLINE' ? passedOn : active).push(it);
    active.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    return { active, passedOn };
  }, [items]);

  if (!items.length) return <div className="empty">No gigs yet. Run a scan to populate the pipeline.</div>;

  return (
    <div>
      <div className="gig-grid">
        {active.map((it) => <Card key={it.url} it={it} />)}
      </div>
      {passedOn.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button className="link" onClick={() => setShowPassed((v) => !v)}>
            {showPassed ? '▾' : '▸'} Passed on ({passedOn.length})
          </button>
          {showPassed && (
            <div className="gig-grid" style={{ marginTop: 12 }}>
              {passedOn.map((it) => <Card key={it.url} it={it} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add minimal styles**

Append to `apps/web/src/components/ui.css` (match existing token names; adjust if the codebase uses different CSS variables):

```css
.gig-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
.gig-card.stale { opacity: 0.55; }
.gig-title { font-weight: 600; display: block; text-decoration: none; }
.gig-meta { font-size: 12px; color: var(--muted, #888); margin-top: 2px; }
.gig-score { border: 1px solid; border-radius: 8px; padding: 4px 8px; text-align: center; min-width: 52px; }
.gig-score-num { font-size: 18px; font-weight: 700; display: block; }
.gig-score-state { font-size: 10px; text-transform: uppercase; opacity: 0.7; }
.gig-reasons { margin: 8px 0 0; padding-left: 16px; font-size: 13px; }
.gig-flags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.flag-chip { font-size: 11px; background: var(--danger-bg, #fdecea); color: var(--danger, #c0392b); border-radius: 4px; padding: 2px 6px; }
```

- [ ] **Step 3: Verify in the running app**

Run: `npm run ui:dev`
Open the Pipeline page. Expected:
- Cards show a score badge (color by verdict), title, source · age · budget, and 1–2 reasons.
- Cards are sorted highest-score first.
- Scam / job-seeker gigs are hidden under "Passed on (N)".
- Gigs older than 45 days appear faded.

(Use the `run` skill / browser tools to screenshot and confirm, or verify manually.)

- [ ] **Step 4: Build to confirm types**

Run: `npm --prefix apps/web run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PipelineBoard.tsx apps/web/src/components/ui.css
git commit -m "feat(web): ranked, reasoned pipeline board with score cards"
```

---

## Self-Review

**Spec coverage:**
- One visible score, state not a second number → Task 8 Card (`gig-score-num` + `gig-score-state` label). ✓
- Heuristic mechanical blocks (B/A/F/E) + neutral C/D nudges → Task 2. ✓
- `data/scores.json` derived + gitignored → Task 3. ✓
- Runs at scan time → Task 4. ✓
- Server merges pipeline + scan-history + scores → Tasks 5–6. ✓
- Rich cards (title/source/date/budget/reasons) → Tasks 7–8. ✓
- Sorted by score, junk auto-sinks, staleness fades → Task 8. ✓
- Cardinal rule (pipeline.md never mutated) → scorer only reads it; scores in scores.json. ✓
- Tier 2 (Claude auto-eval) explicitly deferred to a follow-up plan. ✓ (spec §Tier 2 / open questions)

**Placeholder scan:** No TBD/TODO; every code step shows full code. Task 1 Step 3 notes the dead-variable cleanup explicitly rather than leaving it ambiguous. ✓

**Type consistency:** `scoreGig` returns `{score, blocks, reasons, redFlags, verdict, budget}` (Task 2) — consumed unchanged by `scoreAll` (Task 3). `ScoreEntry` fields written in Task 3 (`first_seen`, `redFlags`, `state`, `report`) match what `mergePipeline` reads in Task 5 and what `PipelineItem` declares in Task 7 (`firstSeen` is the camelCase server-mapped field; `first_seen` is the on-disk/json field — mapping happens in `mergePipeline`). ✓

**Known soft spots to watch during execution:**
- Profile field names (`rate_card.hourly.walk_away`, `archetypes[].stack`, `ideal_gig.*`) are read defensively with fallbacks, so a schema mismatch degrades gracefully rather than crashing.
- `scan.mjs` main-flow shape is unknown; Task 4 Step 1 locates the hook point and Step 2 warns against converting to top-level await.
- `ui.css` variable names (`--go`, `--warn`, `--muted`) may differ; Task 8 Step 2 says to adjust to the codebase's tokens.
