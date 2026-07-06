# Port agent-inbox & detect-reposts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port two upstream `career-ops` utilities into `gig-ops`, adapted to the freelance/leads model: `agent-inbox.mjs` (a standalone markdown triage queue) and `detect-reposts.mjs` (flags gigs reposted across scans).

**Architecture:** Both are self-contained ESM CLI scripts placed at the repo root, matching the existing `*.mjs` convention. `agent-inbox` is a near-verbatim port with four string renames. `detect-reposts` is a port plus a keying change so it groups Reddit rows (empty `company`) by poster/subreddit + fuzzy title instead of company-only. Each ports upstream by fetching the original source, applying exact edits, and adding a dedicated test.

**Tech Stack:** Node.js ESM (`.mjs`), no build step, no new runtime deps. Reuses the existing `role-matcher.mjs` (`roleFuzzyMatch`). Tests are standalone `node`-runnable scripts using the repo's `assert`-free `pass/fail` style (see `test-all.mjs`), plus registration into `test-all.mjs`'s syntax/dry-run lists.

## Global Constraints

- Language: plain ESM `*.mjs`, no build step, no new dependencies (copied verbatim from `AGENTS.md` "Technical notes").
- Env var naming convention: `GIG_OPS_*` (never `CAREER_OPS_*`).
- Default output language English (`AGENTS.md` "Language / Locale").
- Cardinal rule: never auto-update User Layer files (`config/profile.yml`, `sources.yml`, `data/leads.md`, `reports/*`). New data files these tools create (`data/agent-inbox.md`) are user-owned once created — never overwrite wholesale, only append/rewrite in place.
- Upstream source of truth for ports: `github.com/santifer/career-ops`, fetched via `gh api "repos/santifer/career-ops/contents/<path>" -H "Accept: application/vnd.github.raw"`.
- Commit style: conventional commits, no `Co-Authored-By` line (matches this repo's `/commit` convention).

---

## Task 1: Port `agent-inbox.mjs` (triage queue)

**Files:**
- Create: `agent-inbox.mjs` (fetched from upstream, then edited)
- Create: `agent-inbox.test.mjs`
- Modify: `test-all.mjs` (register in syntax-check + dry-run lists)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a CLI with subcommands `add <url> [note]`, `list`, `resolve <n>` (verbatim from upstream); reads/writes `data/agent-inbox.md`; honors env override `GIG_OPS_INBOX` for the file path. No exported functions relied on by later tasks.

- [ ] **Step 1: Fetch the upstream source verbatim**

Run:
```bash
gh api "repos/santifer/career-ops/contents/agent-inbox.mjs" \
  -H "Accept: application/vnd.github.raw" > agent-inbox.mjs
wc -l agent-inbox.mjs   # expect ~144 lines
```

- [ ] **Step 2: Confirm the exact strings to change**

Run:
```bash
grep -nE "CAREER_OPS_INBOX|career-ops" agent-inbox.mjs
```
Expected: matches on a header comment line (~7), the `const PATH` env read (~32), a header/session-label string (~37), and a second env read (~55). If line numbers differ, use the strings below (they are unique) rather than line numbers.

- [ ] **Step 3: Rename the env var (both occurrences)**

Edit `agent-inbox.mjs`, replacing every occurrence of the env var:
- `process.env.CAREER_OPS_INBOX` → `process.env.GIG_OPS_INBOX`

(There are two: the `const PATH = process.env.CAREER_OPS_INBOX || 'data/agent-inbox.md'` default and one other read. Use replace-all on the exact substring `CAREER_OPS_INBOX`.)

- [ ] **Step 4: Rebrand the header/comment text**

Edit `agent-inbox.mjs`, replacing the product name in the header comment and any session-label string:
- `career-ops` → `gig-ops`

Use replace-all on the exact substring `career-ops`. This covers the top-of-file comment and the human-facing "…session" label. Do not change the CLI subcommand names or the example URL.

- [ ] **Step 5: Verify no career-isms remain**

Run:
```bash
grep -nE "CAREER_OPS|career-ops|Career-Ops" agent-inbox.mjs || echo "CLEAN"
node --check agent-inbox.mjs && echo "SYNTAX OK"
```
Expected: `CLEAN` then `SYNTAX OK`.

- [ ] **Step 6: Write the failing test**

Create `agent-inbox.test.mjs`:
```javascript
#!/usr/bin/env node
// Standalone test for agent-inbox.mjs: add → list → resolve round-trip
// against a throwaway inbox file (GIG_OPS_INBOX override), so it never
// touches the real data/agent-inbox.md.
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, 'agent-inbox.mjs');

let passed = 0, failed = 0;
const pass = (m) => { console.log(`  ✅ ${m}`); passed++; };
const fail = (m) => { console.log(`  ❌ ${m}`); failed++; };

const dir = mkdtempSync(join(tmpdir(), 'gigops-inbox-'));
const inbox = join(dir, 'agent-inbox.md');
const run = (args) =>
  execFileSync('node', [SCRIPT, ...args], {
    env: { ...process.env, GIG_OPS_INBOX: inbox },
    encoding: 'utf-8',
  });

try {
  // add
  run(['add', 'https://www.reddit.com/r/forhire/comments/abc/def/', 'react gig']);
  if (existsSync(inbox)) pass('add creates the inbox file');
  else fail('add did not create the inbox file');

  const afterAdd = readFileSync(inbox, 'utf-8');
  if (afterAdd.includes('react gig') && afterAdd.includes('r/forhire'))
    pass('added item is persisted with note + url');
  else fail('added item missing from inbox file');

  // list shows the item as pending
  const listed = run(['list']);
  if (listed.includes('react gig')) pass('list shows the pending item');
  else fail('list did not show the item');

  // resolve marks it done (checkbox flips to [x])
  run(['resolve', '1']);
  const afterResolve = readFileSync(inbox, 'utf-8');
  if (/\[x\]/i.test(afterResolve)) pass('resolve marks the item done');
  else fail('resolve did not mark the item done');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 7: Run the test — confirm it reflects real behavior**

Run:
```bash
node agent-inbox.test.mjs
```
Expected: all assertions pass (`4 passed, 0 failed`).

If `resolve` is named differently upstream (e.g. `done`/`complete`), adjust the subcommand in Step 6 to match what `run(['list'])` / the script's help output shows, then re-run. The subcommand name is whatever the upstream `switch (cmd)` defines — inspect with `grep -nE "case '" agent-inbox.mjs`. Do NOT rename the subcommand in the script; adapt the test to the script.

- [ ] **Step 8: Register in `test-all.mjs`**

In `test-all.mjs`, find the array/list of script filenames that get a `node --check` syntax pass (search for `agent-inbox` neighbors like `'scan.mjs'`, `'tracker.mjs'`). Add `'agent-inbox.mjs'` to that syntax-check list. Do NOT add it to any `--dry-run` execution list unless the script supports `--dry-run` (it does not; it mutates a file). Leave dedicated behavior coverage to `agent-inbox.test.mjs`.

Run:
```bash
grep -n "agent-inbox.mjs" test-all.mjs
node --check test-all.mjs && echo "SYNTAX OK"
```
Expected: the filename appears in the syntax list; `SYNTAX OK`.

- [ ] **Step 9: Commit**

```bash
git add agent-inbox.mjs agent-inbox.test.mjs test-all.mjs
git commit -m "feat: port agent-inbox triage queue to gig-ops

Standalone markdown triage queue (data/agent-inbox.md). Adapted from
career-ops: GIG_OPS_INBOX env var and gig-ops branding. Adds a round-trip
test and registers the script for syntax checks."
```

---

## Task 2: Port `modes/agent-inbox.md` (mode doc)

**Files:**
- Create: `modes/agent-inbox.md` (fetched from upstream, then edited)

**Interfaces:**
- Consumes: the `agent-inbox.mjs` CLI from Task 1 (references its subcommands).
- Produces: a mode doc discoverable as `/agent-inbox`; no code interface.

- [ ] **Step 1: Fetch the upstream mode doc**

Run:
```bash
gh api "repos/santifer/career-ops/contents/modes/agent-inbox.md" \
  -H "Accept: application/vnd.github.raw" > modes/agent-inbox.md
```

- [ ] **Step 2: Rebrand and re-domain the copy**

Edit `modes/agent-inbox.md`:
- Replace-all `career-ops` → `gig-ops`.
- Replace-all `CAREER_OPS_INBOX` → `GIG_OPS_INBOX` (if present).
- Replace job-application phrasing with gig phrasing where it appears in prose: `application`/`applications` → `lead`/`leads`; `company`/`role` → `poster`/`gig`; `job` → `gig`. Only change prose — do not invent new instructions or change the documented subcommands.

- [ ] **Step 3: Verify**

Run:
```bash
grep -niE "career-ops|CAREER_OPS|application|\bcompany\b|\brole\b" modes/agent-inbox.md || echo "CLEAN"
```
Expected: `CLEAN` (or only incidental, clearly-correct matches — review each; there should be none from the career domain).

- [ ] **Step 4: Register the mode in the modes table (if one is enforced)**

Check whether `AGENTS.md` lists modes in a table and whether a test enforces the list:
```bash
grep -n "agent-inbox\|/pipeline\|Mode | File" AGENTS.md
```
If `AGENTS.md` has the modes table (it does — the `## Modes (slash-commands)` table), add a row:
```
| `/agent-inbox` | `modes/agent-inbox.md` | Work a triage queue of gigs pending a decision |
```
`AGENTS.md` is the source of truth; per its footer, `CLAUDE.md`/`OPENCODE.md` are generated wrappers — regenerate them only if a generator script exists (`grep -rl "generated from" *.md`); otherwise leave the wrappers alone and note it in the commit body.

- [ ] **Step 5: Commit**

```bash
git add modes/agent-inbox.md AGENTS.md
git commit -m "docs: add /agent-inbox mode doc for the triage queue"
```

---

## Task 3: Port `detect-reposts.mjs` with Reddit-aware keying

**Files:**
- Create: `detect-reposts.mjs` (fetched from upstream, then edited)
- Create: `detect-reposts.test.mjs`
- Modify: `test-all.mjs` (register in syntax + dry-run lists)

**Interfaces:**
- Consumes: `role-matcher.mjs`'s `roleFuzzyMatch` (already present in repo); `data/scan-history.tsv` (columns `url, first_seen, portal, title, company, status, location`).
- Produces: a CLI that prints grouped repost report to stdout and exits 0; honors env override `GIG_OPS_SCAN_HISTORY` for the history path; supports `--dry-run` (prints report, no side effects). New internal helpers `posterFromUrl(url)` and `redditBucketFromUrl(url)`.

- [ ] **Step 1: Fetch the upstream source**

Run:
```bash
gh api "repos/santifer/career-ops/contents/detect-reposts.mjs" \
  -H "Accept: application/vnd.github.raw" > detect-reposts.mjs
wc -l detect-reposts.mjs   # expect ~348 lines
```

- [ ] **Step 2: Map the code to be changed**

Run:
```bash
grep -nE "role-matcher|roleFuzzyMatch|scan-history|SCAN_HISTORY|company|const key|\.title|import" detect-reposts.mjs
```
Confirm: an import of `roleFuzzyMatch` from `./role-matcher.mjs`; a scan-history path constant; a "valid rows" filter requiring non-empty `company` and `title`; a grouping key built from `company`. Note the exact identifiers used (they anchor the edits below).

- [ ] **Step 3: Add the two URL-keying helpers**

Add these functions near the top of `detect-reposts.mjs`, after the imports and before the parsing logic:
```javascript
// Best-effort poster from a URL: only reddit /u/<name> or /user/<name>
// profile links carry an author. Post permalinks (/r/<sub>/comments/...) do
// NOT, so this returns '' for them — the subreddit bucket handles those.
export function posterFromUrl(url = '') {
  const m = String(url).match(/reddit\.com\/(?:u|user)\/([A-Za-z0-9_-]+)/i);
  return m ? `u/${m[1].toLowerCase()}` : '';
}

// The stable identity in a reddit post permalink is the subreddit, e.g.
// https://www.reddit.com/r/forhire/comments/abc/slug/ -> 'r/forhire'.
export function redditBucketFromUrl(url = '') {
  const m = String(url).match(/reddit\.com\/r\/([A-Za-z0-9_]+)/i);
  return m ? `r/${m[1].toLowerCase()}` : '';
}
```

- [ ] **Step 4: Add the `GIG_OPS_SCAN_HISTORY` env override**

Find the scan-history path constant (from Step 2). Change it so an env var wins, keeping the same default:
```javascript
// before (illustrative — match the actual constant name/text):
// const SCAN_HISTORY = join(ROOT, 'data', 'scan-history.tsv');
// after:
const SCAN_HISTORY = process.env.GIG_OPS_SCAN_HISTORY
  || join(ROOT, 'data', 'scan-history.tsv');
```
If the path is inlined rather than a constant, introduce the constant and use it at the read site.

- [ ] **Step 5: Relax the row filter and compute a grouping identity**

Locate the "valid rows" filter/map (from Step 2) that requires `company` non-empty. Change it so a row is kept when it has a `title` (company no longer required), and attach a derived identity + bucket. Replace the company-requiring predicate/map with:
```javascript
// Keep any row with a title; derive a grouping identity that works for
// board gigs (company) AND demand-side Reddit gigs (empty company).
.filter(r => r.title && r.title.trim())
.map(r => {
  const identity = (r.company && r.company.trim())
    || posterFromUrl(r.url)
    || '';
  const bucket = identity
    || redditBucketFromUrl(r.url)
    || r.portal
    || 'unknown';
  return { ...r, identity, bucket };
})
```
(Adapt property access to the row shape the upstream parser produces — it may be positional fields rather than a `{company,title,...}` object. If positional, map indices per the header `url, first_seen, portal, title, company, status, location`.)

- [ ] **Step 6: Group by `bucket` instead of `company`**

Find the grouping key line (the `const key = ...company...` from Step 2) and change it to key on the derived bucket:
```javascript
const key = row.bucket.toLowerCase();
```
Leave the downstream within-group fuzzy-title clustering (`roleFuzzyMatch`) unchanged — it now separates distinct gigs inside each subreddit/portal bucket.

- [ ] **Step 7: Re-domain the report wording**

Replace user-facing report strings from role/company phrasing to gig phrasing (prose only, e.g. `role reposted` → `gig reposted`, `Company` column header → `Poster/Source`). Keep the table structure. Verify:
```bash
grep -niE "\brole\b|\bcompany\b" detect-reposts.mjs
```
Review each remaining hit; leave variable names alone, change only human-facing output strings.

- [ ] **Step 8: Syntax check + guard against import-time I/O**

The test in Step 9 `import`s `detect-reposts.mjs` to unit-test the helpers, so the module must NOT read the scan-history file (or run `main`) at import time — only when invoked as the entry point. Verify:
```bash
node --check detect-reposts.mjs && echo "SYNTAX OK"
grep -nE "import\.meta\.url|process\.argv\[1\]|readFileSync|main\(\)" detect-reposts.mjs
```
Expected: `SYNTAX OK`, and any `readFileSync`/`main()` call sits INSIDE the `if (import.meta.url === pathToFileURL(process.argv[1]).href)` entry guard (upstream already structures it this way). If any file read runs at module top level, move it into `main()` so importing the module is side-effect-free.

- [ ] **Step 9: Write the failing test**

Create `detect-reposts.test.mjs`:
```javascript
#!/usr/bin/env node
// Test detect-reposts against a fixture scan-history.tsv via
// GIG_OPS_SCAN_HISTORY. Verifies (a) a Reddit gig reposted under two
// permalinks in the same subreddit is detected despite empty company,
// and (b) two unrelated titles are NOT merged.
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { posterFromUrl, redditBucketFromUrl } from './detect-reposts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, 'detect-reposts.mjs');

let passed = 0, failed = 0;
const pass = (m) => { console.log(`  ✅ ${m}`); passed++; };
const fail = (m) => { console.log(`  ❌ ${m}`); failed++; };

// unit: helpers
if (redditBucketFromUrl('https://www.reddit.com/r/forhire/comments/a/x/') === 'r/forhire')
  pass('redditBucketFromUrl extracts subreddit'); else fail('redditBucketFromUrl');
if (posterFromUrl('https://www.reddit.com/r/forhire/comments/a/x/') === '')
  pass('posterFromUrl is empty for post permalinks'); else fail('posterFromUrl permalink');
if (posterFromUrl('https://www.reddit.com/u/janedev') === 'u/janedev')
  pass('posterFromUrl extracts /u/ author'); else fail('posterFromUrl user');

// integration: fixture history
const dir = mkdtempSync(join(tmpdir(), 'gigops-reposts-'));
const hist = join(dir, 'scan-history.tsv');
const H = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n';
const rows = [
  // same gig, two permalinks, same subreddit, empty company -> should group
  ['https://www.reddit.com/r/forhire/comments/a1/x/', '2026-06-01', 'reddit-api', '[Hiring] React developer for dashboard', '', 'new', 'remote'],
  ['https://www.reddit.com/r/forhire/comments/b2/x/', '2026-06-08', 'reddit-api', '[Hiring] React developer for dashboard', '', 'new', 'remote'],
  // unrelated gig, same subreddit -> should NOT merge with the above
  ['https://www.reddit.com/r/forhire/comments/c3/x/', '2026-06-09', 'reddit-api', '[Hiring] Rust systems audit', '', 'new', 'remote'],
].map(r => r.join('\t')).join('\n') + '\n';
writeFileSync(hist, H + rows);

try {
  const out = execFileSync('node', [SCRIPT, '--dry-run'], {
    env: { ...process.env, GIG_OPS_SCAN_HISTORY: hist },
    encoding: 'utf-8',
  });
  if (/React developer/i.test(out) && /2/.test(out))
    pass('detects the reposted React gig (2 sightings)');
  else fail('did not detect the reposted React gig');
  if (!/Rust systems audit[\s\S]*Rust systems audit/i.test(out))
    pass('does not merge the unrelated Rust gig');
  else fail('incorrectly merged the unrelated Rust gig');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 10: Run the test**

Run:
```bash
node detect-reposts.test.mjs
```
Expected: `5 passed, 0 failed`.

If the assertion on sighting-count (`/2/`) is too loose or too strict for the actual report format, inspect the real output (`node detect-reposts.mjs --dry-run` against the fixture by exporting `GIG_OPS_SCAN_HISTORY`) and tighten the regex to match the report's actual "seen N times / N sightings" wording. Adapt the test to the script's real output; do not change the report format to fit the test.

- [ ] **Step 11: Register in `test-all.mjs`**

Add `'detect-reposts.mjs'` to the `node --check` syntax list. If `test-all.mjs` keeps a list of scripts that are safe to run with `--dry-run`, add `detect-reposts.mjs` there too (it is read-only with `--dry-run`). Then:
```bash
node --check test-all.mjs && echo "SYNTAX OK"
```
Expected: `SYNTAX OK`.

- [ ] **Step 12: Commit**

```bash
git add detect-reposts.mjs detect-reposts.test.mjs test-all.mjs
git commit -m "feat: port detect-reposts with Reddit-aware keying

Flags gigs reposted across scans. Adapted from career-ops: groups by
company||poster||subreddit-bucket (not company-only) so Reddit rows with an
empty company column are still detected via subreddit + fuzzy title. Adds a
GIG_OPS_SCAN_HISTORY test override and a fixture-based test."
```

---

## Task 4: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run:
```bash
node test-all.mjs
```
Expected: existing suite still green; no new failures. If `test-all.mjs` does not auto-discover the two new `*.test.mjs` files, run them explicitly:
```bash
node agent-inbox.test.mjs && node detect-reposts.test.mjs
```
Expected: both exit 0.

- [ ] **Step 2: Smoke-test the CLIs against real data**

Run:
```bash
node detect-reposts.mjs --dry-run   # reads real data/scan-history.tsv if present
node agent-inbox.mjs list           # lists real inbox (empty is fine)
```
Expected: both run without error. `detect-reposts` prints a report (possibly "no reposts found" if history is sparse); `agent-inbox list` prints an empty/short queue.

- [ ] **Step 3: Confirm no User Layer files were modified**

Run:
```bash
git status --porcelain config/ sources.yml data/leads.md reports/ 2>/dev/null || true
```
Expected: no output (no User Layer changes). `data/agent-inbox.md` may appear only if you manually added an item during smoke-testing — if so, discard it (`git checkout -- data/agent-inbox.md` or delete if untracked) unless you intend to keep it.
