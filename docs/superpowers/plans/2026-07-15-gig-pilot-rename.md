# Gig-Pilot Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the repository and active project identity from `gig-ops` to `gig-pilot` without changing user-layer data or losing existing work.

**Architecture:** This is a case-aware identity migration, not an application redesign. A focused verification script will define active-name expectations; source, package, documentation, plugin, dashboard, and test references will be migrated consistently before the checkout directory is moved.

**Tech Stack:** Node.js ESM, npm metadata, Go module metadata, Markdown, YAML, shell scripts, Git.

## Global Constraints

- Never edit `config/profile.yml`, `sources.yml`, `data/leads.md`, `data/pipeline.md`, or `reports/`.
- Preserve all existing uncommitted changes; never run reset, checkout, restore, clean, or stash.
- Replace active `gig-ops`, `Gig-Ops`, `gig_ops`, and `GIGOPS` identities with their `gig-pilot` equivalents.
- Keep only intentional historical wording about the prior career-ops upstream relationship.
- Do not provide legacy aliases for old names, paths, plugin directories, or environment-variable prefixes.
- Prefix every shell command with `rtk`.

---

### Task 1: Define executable identity checks

**Files:**
- Create: `project-identity.test.mjs`

**Interfaces:**
- Consumes: repository root files and the `process.cwd()` path.
- Produces: `node project-identity.test.mjs`, exiting `0` when active project identity is `gig-pilot` and `1` with specific stale-reference diagnostics otherwise.

- [ ] **Step 1: Write the failing identity test**

Create `project-identity.test.mjs` using Node assertions. It must assert the package name is exactly `gig-pilot`, the checkout folder basename is `gig-pilot`, and active repository files do not contain `gig-ops`, `Gig-Ops`, `gig_ops`, or `GIGOPS`. Exclude `.git`, `node_modules`, generated web assets, user-layer paths, the historical upstream paragraph in `README.md`, and prior design/plan documents.

```js
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const skip = new Set(['.git', 'node_modules', 'config/profile.yml', 'sources.yml', 'project-identity.test.mjs']);
const ignoredPrefixes = ['apps/web/dist/', 'data/', 'reports/', 'docs/superpowers/'];
const oldIdentity = /gig-ops|gig_ops|gigops/i;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const repoPath = relative(root, path);
    if (skip.has(repoPath) || ignoredPrefixes.some((prefix) => repoPath.startsWith(prefix))) return [];
    if (statSync(path).isDirectory()) return files(path);
    return [path];
  });
}

assert.equal(basename(root), 'gig-pilot');
assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name, 'gig-pilot');
const stale = files(root).flatMap((path) => {
  const text = readFileSync(path, 'utf8');
  return text.split('\n').flatMap((line, index) => oldIdentity.test(line)
    ? [`${relative(root, path)}:${index + 1}: ${line.trim()}`]
    : []);
});
assert.deepEqual(stale, [], `stale project identity references:\n${stale.join('\n')}`);
```

- [ ] **Step 2: Run the test to verify it fails before migration**

Run: `rtk node project-identity.test.mjs`

Expected: FAIL because the folder basename and `package.json` name remain `gig-ops`, and active files still contain old-name references.

- [ ] **Step 3: Stage only the standalone test harness if a commit is desired**

Run: `rtk git add project-identity.test.mjs && rtk git commit -m "test: define gig-pilot identity checks"`

Expected: a commit containing only the new identity harness; the test is expected to fail until Task 2. Skip this optional commit if the worktree’s existing state makes any commit undesirable.

### Task 2: Migrate active project identity references

**Files:**
- Modify: root JavaScript, Markdown, YAML templates, shell scripts, package metadata, plugin manifests, and tests returned by `rtk proxy rg -l -i -uu -g '!node_modules/**' -g '!.git/**' -g '!apps/web/dist/**' -g '!apps/web/vite.config.ts.timestamp-*' -g '!config/profile.yml' -g '!sources.yml' -g '!data/**' -g '!reports/**' 'gig-ops|gig_ops|gigops' .`
- Rename: `.claude/skills/gig-ops/` to `.claude/skills/gig-pilot/`
- Rename: `.opencode/skills/gig-ops/` to `.opencode/skills/gig-pilot/`
- Rename: `.antigravitycli/skills/gig-ops/` to `.antigravitycli/skills/gig-pilot/`
- Rename: `.qwen/skills/gig-ops/` to `.qwen/skills/gig-pilot/`
- Rename: `.opencode/commands/gig-ops-interview-prep.md` to `.opencode/commands/gig-pilot-interview-prep.md`
- Rename: `.opencode/commands/gig-ops-interview-intel.md` to `.opencode/commands/gig-pilot-interview-intel.md`
- Modify: `dashboard/go.mod` and every `dashboard/**/*.go` import that uses `github.com/santifer/gig-ops/dashboard`

**Interfaces:**
- Consumes: old project-name strings and directory entries.
- Produces: `gig-pilot`, `Gig-Pilot`, `gig_pilot`, and `GIGPILOT` forms appropriate to their original casing, with matching imports, test fixtures, command names, plugin names, and environment-variable documentation.

- [ ] **Step 1: Replace active textual identities by casing class**

Use targeted patches rather than a blind global substitution. Apply these mappings in active code, test names and fixtures, documentation, plugins, templates, UI copy, package metadata, Go module/import paths, and runtime environment names:

```text
gig-ops  -> gig-pilot
Gig-Ops  -> Gig-Pilot
gig_ops  -> gig_pilot
GIGOPS   -> GIGPILOT
```

Do not change matches inside protected user-layer files. In `README.md`, retain the upstream history sentence but change its subject to `gig-pilot`.

- [ ] **Step 2: Rename plugin and command filesystem entries**

Run each rename with Git awareness so the move is represented cleanly:

```bash
rtk git mv .claude/skills/gig-ops .claude/skills/gig-pilot
rtk git mv .opencode/skills/gig-ops .opencode/skills/gig-pilot
rtk git mv .antigravitycli/skills/gig-ops .antigravitycli/skills/gig-pilot
rtk git mv .qwen/skills/gig-ops .qwen/skills/gig-pilot
rtk git mv .opencode/commands/gig-ops-interview-prep.md .opencode/commands/gig-pilot-interview-prep.md
rtk git mv .opencode/commands/gig-ops-interview-intel.md .opencode/commands/gig-pilot-interview-intel.md
```

- [ ] **Step 3: Regenerate instruction wrappers if a local generator exists**

Inspect the repository’s documented wrapper-generation command, run it if available, then verify `CLAUDE.md` and `OPENCODE.md` reflect the updated `AGENTS.md` identity. If no generator exists, patch only those wrapper files’ active project-name references.

Run: `rtk proxy rg -n -i 'gig-ops|gig_ops|gigops' AGENTS.md CLAUDE.md OPENCODE.md`

Expected: no active references.

- [ ] **Step 4: Confirm active source has no stale old-name references**

Run: `rtk proxy rg -n -i -uu -g '!node_modules/**' -g '!.git/**' -g '!apps/web/dist/**' -g '!apps/web/vite.config.ts.timestamp-*' -g '!config/profile.yml' -g '!sources.yml' -g '!data/**' -g '!reports/**' -g '!docs/superpowers/**' 'gig-ops|gig_ops|gigops' .`

Expected: no output, except an explicitly retained upstream-history mention if it still uses the former product name.

- [ ] **Step 5: Run focused tests before moving the checkout**

Run: `rtk node --test apps/server/test/cli.test.mjs apps/server/test/scan-session.test.mjs apps/server/test/scan-progress.test.mjs && rtk node --test scan-triage.test.mjs agent-runtime.test.mjs`

Expected: PASS. Do not run `project-identity.test.mjs` yet because the checkout folder has not moved.

- [ ] **Step 6: Review the migration diff without staging unrelated existing work**

Run: `rtk git status --short && rtk git diff --check`

Expected: no whitespace errors, and the output distinguishes rename-related edits from pre-existing user changes. Do not use `git add -A` or create a mixed commit in this dirty worktree.

### Task 3: Move the repository folder and perform final verification

**Files:**
- Rename directory: `/Users/antoniopertuz/Documents/work/gig-ops` to `/Users/antoniopertuz/Documents/work/gig-pilot`

**Interfaces:**
- Consumes: the migrated repository directory and its existing `.git` metadata.
- Produces: a working checkout rooted at `/Users/antoniopertuz/Documents/work/gig-pilot`.

- [ ] **Step 1: Move the checkout directory**

Run from its parent directory after confirming the destination does not exist:

```bash
rtk ls /Users/antoniopertuz/Documents/work
rtk mv /Users/antoniopertuz/Documents/work/gig-ops /Users/antoniopertuz/Documents/work/gig-pilot
```

Expected: the source folder no longer exists and `gig-pilot` contains the same `.git` directory and working files.

- [ ] **Step 2: Run the identity test from the new root**

Run: `rtk node project-identity.test.mjs`

Expected: PASS with no stale-reference diagnostics.

- [ ] **Step 3: Run the project’s quick regression suite**

Run: `rtk node test-all.mjs --quick`

Expected: PASS; user-data checks may emit only the existing documented warnings.

- [ ] **Step 4: Verify repository continuity and untouched user data**

Run: `rtk git status --short && rtk git log -3 --oneline && rtk proxy git diff -- config/profile.yml sources.yml data/leads.md data/pipeline.md reports`

Expected: the original uncommitted entries remain visible, no protected user-layer content is changed by this rename, and the rename commits remain in history.

- [ ] **Step 5: Commit any folder-path-only test correction, if required**

If a verification step required a targeted correction, run: `rtk git add <exact-corrected-files> && rtk git commit -m "test: finalize gig-pilot rename verification"`.

Expected: no commit is created when the migration already passes unchanged.
