# Multi-Source Priority Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover demand-side gigs from Hacker News and Get on Board, prioritize high-signal sources in scanning and scoring, and make description-only demand discoverable without changing user data outside the explicitly requested `sources.yml` update.

**Architecture:** Add fixture-testable HTTP normalizers for HN and Get on Board. Extend the scanner’s normalized offer metadata with a validated priority that controls target order, tie-breaking, pipeline signals, and scan-history. Thread the priority through the derived scoring input so Block E applies the fixed source-quality adjustment.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, `js-yaml`, existing HTTP context.

## Global Constraints

- Do not add runtime dependencies or browser automation.
- Providers use only `ctx.fetchJson`/`ctx.fetchText`; provider failures remain isolated by `scan.mjs`.
- `sources.yml` is User Layer and is updated only because this request explicitly authorizes the documented source additions; preserve all unrelated user settings.
- Ship only verified unauthenticated providers: HN and Get on Board. Document Contra, Indie Hackers, and YC as deferred because no stable public interface was verified.
- `data/pipeline.md` and `data/scan-history.tsv` remain user-owned; scanner writes preserve backward-compatible, additive formats.
- Priority defaults to 2; accepted values are integers 1, 2, and 3. Tier 1 adds 0.75 to Block E, tier 3 subtracts 0.75, always clamped to 1–5.

---

## File Structure

- Create: `providers/hn.mjs` — HN Algolia feed normalization and HTML-to-text handling.
- Create: `providers/getonboard.mjs` — Get on Board category-feed normalization.
- Create: `providers/hn.test.mjs`, `providers/getonboard.test.mjs` — offline provider fixtures.
- Modify: `scan.mjs` — priority validation/order/stamping/history/pipeline/relevance fallback.
- Modify: `test-all.mjs` — scanner unit/regression coverage using its existing test harness.
- Modify: `score-heuristic.mjs`, `score-heuristic.test.mjs` — priority read-through and Block E adjustment.
- Modify: `providers/_types.js`, `validate-sources.mjs` — document and validate source priority/categories/thread configuration.
- Modify: `sources.yml`, `templates/sources.example.yml` — broaden phrases and add configured sources/tiers.
- Modify: `README.md` or `modes/scan.md` — document the browser-assisted deferred phase and supported source configuration.

### Task 1: Add fixture-tested public providers

**Files:**
- Create: `providers/hn.mjs`, `providers/hn.test.mjs`
- Create: `providers/getonboard.mjs`, `providers/getonboard.test.mjs`

- [ ] **Step 1: Write failing HN normalizer tests**

```js
test('normalizes SEEKING FREELANCER comments into demand-side gigs', () => {
  const gigs = normalizeFreelancerComments([{ objectID: '42', author: 'founder', comment_text: '<p>SEEKING FREELANCER: React work</p>' }]);
  assert.deepEqual(gigs[0], { title: 'SEEKING FREELANCER: React work', url: 'https://news.ycombinator.com/item?id=42', company: 'founder', poster: 'founder', location: '', description: 'SEEKING FREELANCER: React work' });
});
```

- [ ] **Step 2: Run the HN test and confirm it fails because the module is absent**

Run: `node --test providers/hn.test.mjs`

- [ ] **Step 3: Implement `hn.mjs`**

Export pure `stripHtml`, `normalizeFreelancerComments`, and `normalizeWhoIsHiringComments`; default provider `id: 'hn'` selects `entry.thread` (`freelancer` or `whoishiring`), searches Algolia by date for the newest matching story, then reads top-level `story_<id>` comments. Include only comments beginning `SEEKING FREELANCER` for freelancer threads; for Who Is Hiring include contract/freelance/part-time text and reject clearly full-time-only text. Return canonical HN comment permalinks.

- [ ] **Step 4: Run HN tests and confirm they pass**

Run: `node --test providers/hn.test.mjs`

- [ ] **Step 5: Write failing Get on Board normalizer tests**

```js
test('normalizes a public category job with budget and description', () => {
  const gig = normalizeJob({ attributes: { title: 'Contract React developer', url: 'https://www.getonbrd.com/jobs/react', company: 'Acme', remote: true, salary: '$60/hr', description: '<p>Build a dashboard</p>' } });
  assert.equal(gig.title, 'Contract React developer');
  assert.equal(gig.budget, '$60/hr');
  assert.equal(gig.location, 'remote');
});
```

- [ ] **Step 6: Run the Get on Board test and confirm it fails because the module is absent**

Run: `node --test providers/getonboard.test.mjs`

- [ ] **Step 7: Implement `getonboard.mjs`**

Export a pure `normalizeJob` that tolerates documented JSON:API wrappers and only emits valid HTTP URLs. Fetch each configured category from `https://www.getonbrd.com/api/v0/categories/{category}/jobs`; normalize company, location, description, and all available salary/rate fields into `budget`. Reject malformed payload shapes with a descriptive error; do not attempt unauthenticated Contra/IH/YC calls.

- [ ] **Step 8: Run both provider suites**

Run: `node --test providers/hn.test.mjs providers/getonboard.test.mjs`

### Task 2: Make priority first-class scanner metadata

**Files:**
- Modify: `scan.mjs`, `test-all.mjs`, `providers/_types.js`, `validate-sources.mjs`

- [ ] **Step 1: Add failing scanner tests**

Add tests asserting `normalizePriority(undefined) === 2`, invalid values become 2, targets sort `[1, 2, 3]`, `formatPipelineOffer` emits `tier:1`, and `formatScanHistoryRow` appends priority as the eighth TSV column.

- [ ] **Step 2: Run the scanner harness and confirm the added assertions fail**

Run: `node test-all.mjs`

- [ ] **Step 3: Implement validated priority flow**

Export `normalizePriority(value)` and `sortTargetsByPriority(targets)`. Stamp each accepted offer with the resolved entry priority. Sort targets before creating fetch tasks; sort final offers by descending relevance then ascending priority, preserving stable source order for ties. Extend the pipeline signal to `relevance:N tier:N [...]`, and append a `priority` header/field to scan history only when creating/writing rows. Existing rows remain readable because all consumers index named/leading columns.

- [ ] **Step 4: Extend config contract validation**

Validate `gig_boards[*].priority` as an integer in `[1,3]`; validate HN `thread` values and Get on Board `categories` as nonempty string arrays. Document `priority`, `thread`, and `categories` in `_types.js`.

- [ ] **Step 5: Re-run scanner and validator tests**

Run: `node test-all.mjs && node validate-sources.mjs --self-test`

### Task 3: Add description relevance fallback and score adjustment

**Files:**
- Modify: `scan.mjs`, `test-all.mjs`, `score-heuristic.mjs`, `score-heuristic.test.mjs`

- [ ] **Step 1: Write failing relevance and scoring tests**

```js
assert.deepEqual(matchOfferRelevance(titleFilter, { title: 'Monthly thread', description: 'Need help with a React integration' }).matched, ['need help with']);
assert.equal(scoreGig({ title: 'React work $90/hr', priority: 1 }, PROFILE).blocks.E, 3.75);
assert.equal(scoreGig({ title: 'React work $90/hr', priority: 3 }, PROFILE).blocks.E, 2.25);
```

- [ ] **Step 2: Run the focused suites and confirm the new tests fail**

Run: `node test-all.mjs && node --test score-heuristic.test.mjs`

- [ ] **Step 3: Implement fallback and priority propagation**

Create an exported helper that first evaluates the title, returns title hits unchanged, and only when title hits are empty evaluates `job.description`; title negative matches still reject before fallback, while content filtering remains unchanged. Persist `priority` in `scoreAll`’s pipeline/history parsing and pass it to `scoreGig`. In Block E, apply `+0.75` for tier 1 and `-0.75` for tier 3 after channel detection, clamping the final block score.

- [ ] **Step 4: Run focused suites**

Run: `node test-all.mjs && node --test score-heuristic.test.mjs`

### Task 4: Configure sources and document deferred browser phase

**Files:**
- Modify: `sources.yml`, `templates/sources.example.yml`, `modes/scan.md` (or `README.md`)

- [ ] **Step 1: Update the template and explicitly authorized user configuration**

Add the approved demand phrases to `title_filter.positive`. Set source priority defaults: `r/ycombinator` and HN tier 1; `r/forhire`, `r/jobbit`, Get on Board tier 2; `r/slavelabour`, `r/beermoney` tier 3. Add enabled HN freelancer/Who Is Hiring entries and enabled Get on Board category entries. Do not add Contra/IH/YC entries as enabled sources.

- [ ] **Step 2: Document source constraints**

State that Contra, Indie Hackers, YC Work at a Startup, LinkedIn, Facebook, Wellfound, and Discord require a future browser-assisted or authenticated phase; no credentials or browser session are used by `node scan.mjs`.

- [ ] **Step 3: Validate both configurations**

Run: `node validate-sources.mjs && node validate-sources.mjs --file templates/sources.example.yml`

### Task 5: Verify the complete feature

**Files:**
- Verify only

- [ ] **Step 1: Run all feature tests**

Run: `node --test providers/hn.test.mjs providers/getonboard.test.mjs score-heuristic.test.mjs apps/server/test/scoring.test.mjs && node test-all.mjs`

- [ ] **Step 2: Run source validation and a non-mutating scan**

Run: `node validate-sources.mjs && node scan.mjs --dry-run`

- [ ] **Step 3: Inspect the diff against this plan**

Run: `git diff --check && git diff -- providers/hn.mjs providers/getonboard.mjs scan.mjs score-heuristic.mjs sources.yml templates/sources.example.yml`

- [ ] **Step 4: Commit only feature-owned paths if the shared worktree permits it**

Run: `git add providers/hn.mjs providers/hn.test.mjs providers/getonboard.mjs providers/getonboard.test.mjs scan.mjs score-heuristic.mjs score-heuristic.test.mjs test-all.mjs providers/_types.js validate-sources.mjs sources.yml templates/sources.example.yml modes/scan.md docs/superpowers/plans/2026-07-09-multi-source-priority-scanning.md && git commit -m "feat(scan): add prioritized multi-source gig discovery"`

If unrelated shared changes make a clean feature commit unsafe, do not commit; report the verified file list instead.
