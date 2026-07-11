# Precision-First Gig Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admit only model-confirmed, paid, client-side freelance opportunities to active Pipeline tiers while preserving source evidence, using the selected local agent runtime, and failing closed.

**Architecture:** Provider results become normalized full-content candidates. A deterministic source-aware gate removes high-confidence junk, then the selected local agent CLI validates and scores every bounded survivor using a strict JSON contract. Derived candidate/triage/score stores commit atomically before accepted URLs are appended to the existing User Layer scan outputs; the UI separates eligible gigs, low fit, quarantine, and quality-gate rejects.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, built-in `crypto`/`fs`/`child_process`, Express, React, TypeScript, existing local Claude Code/Codex CLI adapters.

## Global Constraints

- Precision-first: ambiguous candidates are quarantined, never promoted.
- No provider or model name is pinned for scan triage; use the selected provider and its configured/default model.
- No new runtime dependency.
- Never automatically modify `config/profile.yml`, `sources.yml`, or existing Pipeline rows.
- A user-triggered enforced scan may append only accepted gigs to `data/pipeline.md` and `data/scan-history.tsv`.
- `data/candidates.json`, `data/triage.json`, and `data/scores.json` are derived and gitignored.
- Model work is read-only and candidate content is untrusted data.
- Confidence below `0.85`, malformed output, timeouts, and capacity overflow fail closed.
- Batch size is 10 and the default per-scan model limit is 30.
- Existing uncommitted work is user-owned. Preserve it and do not create broad commits that include unrelated paths.
- Use TDD for each behavior slice and run focused tests before broader suites.

---

## File Structure

- Create `triage/contracts.mjs` — candidate normalization, compensation shape, content normalization, hashing, constants.
- Create `triage/rules.mjs` — deterministic source-aware reject/survivor/quarantine decisions.
- Create `triage/decision.mjs` — strict model decision validation and acceptance invariant.
- Create `triage/prompt.mjs` — untrusted-data prompt construction and JSON extraction.
- Create `triage/store.mjs` — atomic derived JSON reads/writes and fingerprints.
- Create `triage/engine.mjs` — caching, batching, retries, capacity, result partitioning.
- Create `triage/*.test.mjs` — focused unit and integration tests.
- Create `triage/fixtures/relevance-corpus.json` — 200 reviewed eligibility examples.
- Create `agent-runtime.mjs` — provider-neutral local CLI definitions and structured read-only task execution.
- Modify `apps/server/lib/claude.mjs` — consume shared provider definitions without breaking mode streaming.
- Modify `providers/hn.mjs`, `providers/hn.test.mjs` — exact monthly story selection.
- Modify `providers/getonboard.mjs`, `providers/getonboard.test.mjs` — live `links.public_url` normalization.
- Modify `scan.mjs`, `test-all.mjs` — run triage before User Layer writes and emit machine-readable metrics.
- Modify `.gitignore`, `DATA_CONTRACT.md`, `providers/_types.js` — document derived files and candidate fields.
- Modify `apps/server/lib/paths.mjs`, `apps/server/lib/files.mjs`, `apps/server/routes/scan.mjs`, related tests — merge triage and propagate active provider.
- Modify `apps/web/src/lib/api.ts`, `apps/web/src/routes/scan.tsx`, `apps/web/src/components/PipelineBoard.tsx`, UI tests/styles — four-state presentation and scan metrics.
- Create `quality-eval.mjs`, `quality-eval.test.mjs` — corpus metrics and release-gate checks.

### Task 1: Candidate contract and source-aware rule gate

**Files:**
- Create: `triage/contracts.mjs`
- Create: `triage/rules.mjs`
- Create: `triage/contracts.test.mjs`
- Create: `triage/rules.test.mjs`
- Create: `triage/fixtures/relevance-corpus.json`
- Modify: `providers/_types.js`

**Interfaces:**
- Produces: `normalizeCandidate(offer, context) -> Candidate`
- Produces: `candidateText(candidate) -> string`
- Produces: `contentHash(candidate) -> string`
- Produces: `applyRuleGate(candidate, profile) -> { state: "reject"|"quarantine"|"survivor", reasonCodes: string[], evidence: string[] }`

- [ ] **Step 1: Write failing contract tests**

```js
test('normalizeCandidate preserves full body and stable content hash', () => {
  const a = normalizeCandidate({
    url: 'https://reddit.test/r/forhire/1', title: '[Hiring] React checkout',
    description: 'Need a contractor to ship Stripe. Budget $90/hr.', source: 'r/forhire',
    budget: '$90/hr', paymentModel: 'hourly', poster: 'buyer',
  }, { provider: 'reddit', firstSeen: '2026-07-11' });
  const b = normalizeCandidate({ ...a }, { provider: 'reddit', firstSeen: '2026-07-11' });
  assert.equal(a.description, 'Need a contractor to ship Stripe. Budget $90/hr.');
  assert.equal(a.compensation.cadence, 'hourly');
  assert.equal(a.contentHash, b.contentHash);
});

test('normalizeCandidate caps untrusted content and rejects malformed URLs', () => {
  assert.throws(() => normalizeCandidate({ url: 'javascript:alert(1)', title: 'x' }, {}), /http/i);
  const candidate = normalizeCandidate({ url: 'https://x.test/1', title: 'x', description: 'a'.repeat(20_000) }, {});
  assert.ok(candidate.description.length <= MAX_CONTENT_CHARS);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `rtk test node --test triage/contracts.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `triage/contracts.mjs`.

- [ ] **Step 3: Implement the candidate contract**

```js
export const MAX_CONTENT_CHARS = 12_000;
export const CLASSIFIER_VERSION = 'precision-triage-v1';
export const RUBRIC_VERSION = 'gig-rubric-v1';

export function normalizeCandidate(offer, context = {}) {
  const url = normalizeHttpUrl(offer?.url);
  const title = normalizeText(offer?.title, 500);
  if (!url || !title) throw new Error('candidate requires an HTTP URL and title');
  const description = normalizeText(offer?.description, MAX_CONTENT_CHARS);
  const compensation = normalizeCompensation(offer?.budget, `${title}\n${description}`);
  const candidate = {
    url, title, description,
    source: normalizeText(offer?.source || context.source, 120) || new URL(url).hostname,
    provider: normalizeText(context.provider || offer?.provider, 80) || 'unknown',
    poster: nullableText(offer?.poster, 120), company: nullableText(offer?.company, 160),
    postedAt: nullableText(offer?.postedAt, 40), firstSeen: context.firstSeen || new Date().toISOString().slice(0, 10),
    location: nullableText(offer?.location, 200), compensation,
    paymentModel: nullableText(offer?.paymentModel, 40),
    sourceSignals: normalizeSignals(offer?.sourceSignals),
  };
  return { ...candidate, contentHash: hashJson(candidate) };
}
```

- [ ] **Step 4: Run contract tests and verify pass**

Run: `rtk test node --test triage/contracts.test.mjs`

Expected: all candidate contract tests PASS.

- [ ] **Step 5: Write failing rule tests with named regressions**

```js
for (const [title, source, reason] of [
  ['27-F- need $1000 for rent!', 'r/jobbit', 'source_policy'],
  ['no se si por Expo go + React navigation me van a dar una crisis nerviosa', 'r/programacion', 'discussion'],
  ['Building the Next Billion-Dollar Fintech from Kerala', 'r/ycombinator', 'source_policy'],
  ['Why wont my password pop up in my email?', 'r/beermoney', 'discussion'],
]) {
  test(`rejects regression: ${title}`, () => {
    const result = applyRuleGate(candidate({ title, source }), PROFILE);
    assert.equal(result.state, 'reject');
    assert.ok(result.reasonCodes.includes(reason));
  });
}

test('survives a client-side paid r/forhire request', () => {
  const result = applyRuleGate(candidate({
    title: '[Hiring] React developer for Stripe checkout — $90/hr', source: 'r/forhire',
    description: 'We need an independent contractor to deliver the checkout flow.',
  }), PROFILE);
  assert.equal(result.state, 'survivor');
});
```

- [ ] **Step 6: Implement the rule gate and 200-case corpus**

Implement ordered high-precision checks: malformed/missing content, supply-side phrases, explicit discussion/advice patterns, annual/full-time employment, unpaid/scam, configured rate floor, then source policies. Populate `relevance-corpus.json` with 200 labeled `{id,title,description,source,expected}` records covering the approved categories and languages; include the six named failures verbatim.

- [ ] **Step 7: Run contract/rule tests**

Run: `rtk test node --test triage/contracts.test.mjs triage/rules.test.mjs`

Expected: PASS, including all named regressions and corpus count `>= 200`.

### Task 2: Model decision schema and prompt boundary

**Files:**
- Create: `triage/decision.mjs`
- Create: `triage/prompt.mjs`
- Create: `triage/decision.test.mjs`
- Create: `triage/prompt.test.mjs`

**Interfaces:**
- Produces: `validateDecision(raw, candidate) -> ValidatedDecision`
- Produces: `isAcceptedDecision(decision) -> boolean`
- Produces: `buildTriagePrompt(candidates, profile) -> string`
- Produces: `parseDecisionEnvelope(text) -> unknown[]`

- [ ] **Step 1: Write failing decision tests**

```js
test('acceptance requires verified eligible independent paid work', () => {
  const c = candidate('[Hiring] React contractor', 'Need a paid contractor for this dashboard.');
  const d = validateDecision(validDecision(c.url, {
    evidence: [{ quote: 'paid contractor', meaning: 'explicit paid independent engagement' }],
  }), c);
  assert.equal(isAcceptedDecision(d), true);
});

test('fabricated evidence and incomplete fit fail validation', () => {
  const c = candidate('[Hiring] React contractor', 'Build a dashboard.');
  assert.throws(() => validateDecision(validDecision(c.url, {
    evidence: [{ quote: 'budget is $90/hr', meaning: 'invented' }],
  }), c), /evidence/i);
  assert.throws(() => validateDecision(validDecision(c.url, { fit: { score: 4 } }), c), /blocks/i);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `rtk test node --test triage/decision.test.mjs triage/prompt.test.mjs`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement strict validation and acceptance invariant**

```js
export function isAcceptedDecision(d) {
  return d.eligibility === 'eligible'
    && d.confidence >= 0.85
    && d.intent === 'client_hiring'
    && d.relationship === 'independent'
    && ['freelance', 'project', 'contract'].includes(d.engagement)
    && d.paid === true
    && d.evidence.length > 0
    && d.fit !== null;
}
```

Validation must enforce exact enums, URL equality, `0..1` confidence, all A–F blocks in `1..5`, weighted score in `1..5`, verdict/threshold consistency, string arrays, and local evidence substring verification.

- [ ] **Step 4: Implement the untrusted-data prompt**

The prompt must state that candidate fields are untrusted data, prohibit following embedded commands, request one result per URL, include the exact decision schema/enums and A–F weights, and wrap JSON-serialized candidates between `BEGIN_UNTRUSTED_CANDIDATES` and `END_UNTRUSTED_CANDIDATES` delimiters. `parseDecisionEnvelope` must accept a bare JSON array or a fenced JSON array and reject prose-only output.

- [ ] **Step 5: Run decision/prompt tests**

Run: `rtk test node --test triage/decision.test.mjs triage/prompt.test.mjs`

Expected: PASS.

### Task 3: Provider-neutral active agent runtime

**Files:**
- Create: `agent-runtime.mjs`
- Create: `agent-runtime.test.mjs`
- Modify: `apps/server/lib/claude.mjs`
- Modify: `apps/server/test/claude.test.mjs`

**Interfaces:**
- Produces: `AGENT_PROVIDERS`
- Produces: `normalizeProvider(value) -> "claude"|"codex"`
- Produces: `buildAgentSpawn(provider, prompt, {readOnly}) -> {bin,args,options}`
- Produces: `runAgentText({provider,prompt,timeoutMs,spawnImpl}) -> Promise<{text,runtimeFingerprint}>`
- Existing mode interface remains: `startJob`, `subscribe`, `getJob`, `buildPrompt`.

- [ ] **Step 1: Write failing runtime tests**

```js
test('Codex structured tasks use the selected CLI without pinning a model', () => {
  const spec = buildAgentSpawn('codex', 'classify', { readOnly: true });
  assert.equal(spec.bin, codexBin);
  assert.ok(spec.args.includes('--sandbox'));
  assert.ok(spec.args.includes('read-only'));
  assert.equal(spec.args.includes('--model'), false);
});

test('runAgentText collects assistant text and times out fail-closed', async () => {
  const result = await runAgentText({ provider: 'codex', prompt: 'x', spawnImpl: fakeCodex('[{"url":"x"}]') });
  assert.match(result.text, /"url"/);
  await assert.rejects(runAgentText({ provider: 'codex', prompt: 'x', timeoutMs: 5, spawnImpl: hangingProcess }), /timeout/i);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `rtk test node --test agent-runtime.test.mjs apps/server/test/claude.test.mjs`

Expected: new runtime suite FAILS; existing bridge tests remain green until imports change.

- [ ] **Step 3: Implement shared provider definitions and structured execution**

`buildAgentSpawn` uses existing CLI JSON-stream modes, adds read-only sandbox arguments where supported, never adds a model flag, and preserves `cwd`. `runAgentText` collects provider-specific assistant/result JSONL, kills the child on timeout, rejects non-zero exits, and returns a fingerprint from provider plus CLI/runtime metadata.

- [ ] **Step 4: Refactor the server bridge to import shared definitions**

Keep all existing exports and queue behavior. Replace duplicate `AGENT_PROVIDERS`/`normalizeProvider` declarations with imports/re-exports from `../../../agent-runtime.mjs`. Interactive mode prompts and SSE parsing must remain behavior-compatible.

- [ ] **Step 5: Run runtime and server tests**

Run: `rtk test node --test agent-runtime.test.mjs apps/server/test/claude.test.mjs`

Expected: PASS.

### Task 4: Atomic triage store and engine

**Files:**
- Create: `triage/store.mjs`
- Create: `triage/engine.mjs`
- Create: `triage/store.test.mjs`
- Create: `triage/engine.test.mjs`
- Modify: `.gitignore`
- Modify: `DATA_CONTRACT.md`

**Interfaces:**
- Produces: `readDerivedState(paths) -> {candidates,triage,scores}`
- Produces: `writeDerivedStateAtomic(paths,state) -> Promise<void>`
- Produces: `triageCandidates(candidates, options) -> Promise<TriageResult>`
- `TriageResult = {accepted,rejected,uncertain,scores,decisions,metrics,issues}`.

- [ ] **Step 1: Write failing store/engine tests**

```js
test('unchanged decisions are cache hits and make zero model calls', async () => {
  let calls = 0;
  const first = await triageCandidates([GOOD], options({ runModel: async () => { calls++; return [GOOD_DECISION]; } }));
  const second = await triageCandidates([GOOD], options({ cache: first.decisions, runModel: async () => { calls++; return []; } }));
  assert.equal(calls, 1);
  assert.equal(second.metrics.cached, 1);
});

test('model failure and capacity overflow never accept candidates', async () => {
  const result = await triageCandidates(manySurvivors(35), options({
    maxModelCandidates: 30,
    runModel: async () => { throw new Error('offline'); },
  }));
  assert.equal(result.accepted.length, 0);
  assert.equal(result.uncertain.length, 35);
  assert.ok(result.issues.some((x) => /offline/i.test(x)));
});
```

- [ ] **Step 2: Run and verify failure**

Run: `rtk test node --test triage/store.test.mjs triage/engine.test.mjs`

Expected: FAIL because store/engine modules do not exist.

- [ ] **Step 3: Implement atomic derived store**

Read absent/corrupt derived files as empty objects plus a surfaced issue for corrupt JSON. Write each complete JSON document to a same-directory temporary file, then rename. Do not expose temporary filenames to model output.

- [ ] **Step 4: Implement triage orchestration**

Apply rules first, fingerprint cache entries, sort survivors by source evidence/relevance, cap at 30, batch by 10, call the injected model runner, validate one decision per requested URL, retry invalid batches once, and partition with `isAcceptedDecision`. Build `scores` only from accepted decisions with `state: "evaluated"` and `eligibility: "eligible"`.

- [ ] **Step 5: Document derived files and run tests**

Add `data/candidates.json` and `data/triage.json` to `.gitignore`; document them as rebuildable derived state without reclassifying existing User Layer files automatically.

Run: `rtk test node --test triage/store.test.mjs triage/engine.test.mjs`

Expected: PASS.

### Task 5: Repair live provider contracts

**Files:**
- Modify: `providers/getonboard.mjs`
- Modify: `providers/getonboard.test.mjs`
- Modify: `providers/hn.mjs`
- Modify: `providers/hn.test.mjs`

**Interfaces:**
- `normalizeJob(resource)` accepts JSON:API `resource.links.public_url`.
- `selectMonthlyStory(hits, thread) -> story|null` rejects fuzzy unrelated hits.

- [ ] **Step 1: Add failing live-shape fixtures**

```js
test('normalizes live Get on Board links.public_url shape', () => {
  const gig = normalizeJob({
    id: 'react-contract', type: 'job', links: { public_url: 'https://www.getonbrd.com/jobs/react-contract' },
    attributes: { title: 'React contractor', description: '<p>Project contract</p>', remote: true },
  });
  assert.equal(gig.url, 'https://www.getonbrd.com/jobs/react-contract');
});

test('HN ignores a newer fuzzy Show HN result', () => {
  const story = selectMonthlyStory([
    { objectID: 'wrong', title: 'Show HN: UI for Who is hiring posts' },
    { objectID: 'right', title: 'Ask HN: Who is hiring? (July 2026)' },
  ], 'whoishiring');
  assert.equal(story.objectID, 'right');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `rtk test node --test providers/getonboard.test.mjs providers/hn.test.mjs`

Expected: both new assertions FAIL.

- [ ] **Step 3: Implement schema and story-selection repairs**

Get on Board URL precedence: `resource.links.public_url`, then attribute URL fallbacks. HN search requests multiple hits and selects an exact approved monthly title regex for the requested thread before fetching comments; absence is a descriptive source error, not a fallback to hit zero.

- [ ] **Step 4: Run provider tests**

Run: `rtk test node --test providers/getonboard.test.mjs providers/hn.test.mjs`

Expected: PASS.

### Task 6: Integrate triage before scanner writes

**Files:**
- Modify: `scan.mjs`
- Modify: `test-all.mjs`
- Modify: `apps/server/routes/scan.mjs`
- Modify: `apps/server/lib/scan-session.mjs`
- Modify: `apps/server/test/scan-session.test.mjs`
- Modify: `apps/server/test/scan-progress.test.mjs`

**Interfaces:**
- `scan.mjs --agent-provider=<id> [--triage-mode=shadow|enforced] [--reclassify]`
- Scanner emits `::gig-ops-scan::{"type":"triage",...}`.
- UI route accepts `{args:string[],provider?:string}`.

- [ ] **Step 1: Write failing scanner/session tests**

Assert that rejected/uncertain offers are absent from formatted Pipeline output, only accepted offers reach `appendToPipeline`, the selected provider reaches triage, and triage machine events populate `phase: "triaging"` plus metrics.

- [ ] **Step 2: Run and verify failure**

Run: `rtk test node test-all.mjs`

Run: `rtk test node --test apps/server/test/scan-session.test.mjs apps/server/test/scan-progress.test.mjs`

Expected: new triage assertions FAIL.

- [ ] **Step 3: Insert triage after optional liveness and before writes**

Normalize verified offers, call `triageCandidates`, atomically persist derived state, replace `verifiedOffers` with accepted offers only in enforced mode, and remove the post-write `scoreAll` heuristic call. Shadow mode records decisions/metrics but preserves current write behavior only during rollout tests. Default new behavior is enforced once verification passes.

- [ ] **Step 4: Add provider propagation and machine metrics**

Validate the requested provider, append `--agent-provider=<id>` to the scanner child args, emit/parse fetched, ruleRejected, modelEvaluated, cached, accepted, quarantined, and sourceErrors fields, and surface failures as `completed_with_issues` without a non-zero scan exit when acquisition succeeded.

- [ ] **Step 5: Run scanner/server suites**

Run: `rtk test node test-all.mjs`

Run: `rtk test node --test apps/server/test/scan-session.test.mjs apps/server/test/scan-progress.test.mjs`

Expected: PASS.

### Task 7: Merge triage into the server and migrate UI semantics

**Files:**
- Modify: `apps/server/lib/paths.mjs`
- Modify: `apps/server/lib/files.mjs`
- Modify: `apps/server/routes/pipeline.mjs`
- Modify: `apps/server/test/files.test.mjs`
- Modify: `apps/server/test/scoring.test.mjs`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/routes/scan.tsx`
- Modify: `apps/web/src/components/PipelineBoard.tsx`
- Modify: `apps/web/src/components/ui.css`

**Interfaces:**
- `readTriage() -> Record<url,TriageDecision>`
- `mergePipeline(items,scores,history,triage) -> PipelineItem[]`
- `PipelineItem` adds `eligibility`, `confidence`, `intent`, `engagement`, `triageReasons`, `triageEvidence`.

- [ ] **Step 1: Write failing merge and classification tests**

```js
test('legacy estimated items become uncertain, never active eligible gigs', () => {
  const [item] = mergePipeline([PIPELINE_ITEM], { [URL]: { score: 3.4, state: 'estimated' } }, {}, {});
  assert.equal(item.eligibility, 'uncertain');
  assert.equal(item.state, 'estimated');
});

test('eligible evaluated triage decisions merge into active items', () => {
  const [item] = mergePipeline([PIPELINE_ITEM], SCORES, {}, { [URL]: ELIGIBLE_DECISION });
  assert.equal(item.eligibility, 'eligible');
  assert.equal(item.state, 'evaluated');
});
```

- [ ] **Step 2: Run server tests and verify failure**

Run: `rtk test node --test apps/server/test/files.test.mjs apps/server/test/scoring.test.mjs`

Expected: FAIL on missing triage merge fields.

- [ ] **Step 3: Implement server merge and API types**

Read corrupt/absent triage as empty. A score can be active only when triage says eligible and score state is evaluated. Map legacy/no-decision items to `eligibility: "uncertain"` without mutating Pipeline.

- [ ] **Step 4: Implement four UI buckets**

Partition items into:

```ts
const active = item.eligibility === 'eligible' && item.state === 'evaluated' && (item.score ?? 0) >= 3;
const lowFit = item.eligibility === 'eligible' && item.state === 'evaluated' && (item.score ?? 0) < 3;
const rejected = item.eligibility === 'rejected';
const quarantine = !active && !lowFit && !rejected;
```

Render active GO/Review tiers, collapsed Low fit, Needs classification, and Filtered by quality gate. Display triage reason/evidence. Never render estimated scores as guidance.

- [ ] **Step 5: Pass active provider into scans and render new metrics**

`scan.tsx` sends `provider: getAgentProvider()` and supports the new triaging phase/summary fields. “New gigs” equals accepted only.

- [ ] **Step 6: Run server and web verification**

Run: `rtk test node --test apps/server/test/*.test.mjs`

Run: `rtk npm --prefix apps/web run build`

Expected: all server tests PASS and Vite production build succeeds.

### Task 8: Quality evaluator and complete verification

**Files:**
- Create: `quality-eval.mjs`
- Create: `quality-eval.test.mjs`
- Modify: `package.json`
- Modify: `README.md` or `modes/scan.md`

**Interfaces:**
- `evaluateQuality(corpus, decisions) -> {precision,recall,hardNegativeLeakage,top20Leakage,schemaValidity,passed,failures}`
- CLI: `node quality-eval.mjs --replay <file>` and `node quality-eval.mjs --active-provider`.

- [ ] **Step 1: Write failing release-gate tests**

```js
test('quality gates reject one discussion leaked into active results', () => {
  const result = evaluateQuality(CORPUS, decisionsWithDiscussionLeak());
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((x) => /hard-negative|top 20/i.test(x)));
});

test('quality gates pass 95% precision, 70% recall, and zero hard-negative leakage', () => {
  const result = evaluateQuality(CORPUS, passingDecisions());
  assert.equal(result.passed, true);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `rtk test node --test quality-eval.test.mjs`

Expected: FAIL because `quality-eval.mjs` does not exist.

- [ ] **Step 3: Implement metrics and CLI**

Calculate exact accepted precision/eligible recall, count worker/discussion/full-time leakage, validate top-20 ordering by score, and exit non-zero on any approved threshold failure. Active-provider mode runs the same prompt/runtime path and writes only an explicitly supplied replay output path, never User Layer files.

- [ ] **Step 4: Add scripts and operational documentation**

Add `quality:test`, document enforced/default behavior, `--reclassify`, selected provider semantics, quarantine, derived cache removal, and source-quality metrics.

- [ ] **Step 5: Run complete verification**

Run: `rtk test node --test triage/*.test.mjs agent-runtime.test.mjs providers/hn.test.mjs providers/getonboard.test.mjs quality-eval.test.mjs apps/server/test/*.test.mjs`

Run: `rtk test node test-all.mjs`

Run: `rtk npm --prefix apps/web run build`

Run: `rtk git diff --check`

Expected: all tests PASS, build succeeds, and diff check emits no errors.

- [ ] **Step 6: Run non-writing source and quality smoke checks**

Run: `rtk proxy node scan.mjs --dry-run --company "Hacker News" --triage-mode=shadow`

Run: `rtk proxy node scan.mjs --dry-run --company "Get on Board" --triage-mode=shadow`

Run: `rtk proxy node quality-eval.mjs --active-provider`

Expected: providers either return correctly normalized candidates or a precise upstream/no-demand result; the quality evaluator satisfies every release gate without writing User Layer files.

## Plan Self-Review

- Spec coverage: candidate contract, source gate, selected runtime, model validation, atomic storage, caching, provider repairs, scanner ordering, UI migration, quality corpus, release gates, and rollout behavior are each owned by a task.
- Placeholder scan: no deferred implementation markers or undefined follow-up tasks remain.
- Type consistency: `Candidate`, `ValidatedDecision`, `TriageResult`, and merged `PipelineItem` field names are stable across producer/consumer tasks.
- Scope: proposals, outreach, tracker behavior, and automatic legacy cleanup remain excluded.
