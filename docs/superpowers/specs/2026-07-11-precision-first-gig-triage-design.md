# Precision-First Gig Triage Design

**Date:** 2026-07-11  
**Status:** Approved for implementation  
**Scope:** Discovery, eligibility classification, fit scoring, source quality, scan observability, and Pipeline presentation.

## Problem

The project currently ranks fetched posts before proving that they are gigs. In the observed dataset, all 361 pending candidates came from Reddit, 312 had no positive demand-keyword match, and five of the six highest-scored items were discussions, job seekers, or unrelated requests.

The failure is architectural:

1. Positive title keywords became ranking hints instead of admission requirements, so broad community feeds are admitted wholesale.
2. The heuristic scorer answers “does this text mention my stack or money?” before answering “is a client offering paid freelance work?”
3. Provider descriptions are discarded before scoring, leaving a title-only classifier.
4. Source priority boosts scores even when the source item is not a gig.
5. The planned model-evaluation tier was deferred, leaving estimated heuristic scores as the visible product decision.
6. Additional providers either drifted from their live response schemas or selected the wrong upstream records.

The result violates the product's core promise: a ranked list should contain real opportunities, not merely text that resembles one.

## Product Decision

The default is precision-first. Missing an ambiguous opportunity is preferable to showing a non-gig as worth reviewing.

The scanner uses a hybrid quality firewall:

1. Deterministic, source-aware rules reject obvious junk cheaply.
2. Every rule survivor is validated and scored by the project's active agent runtime.
3. Only model-confirmed, paid, client-side freelance opportunities enter the ranked Pipeline.
4. Rejected and uncertain candidates remain auditable in derived data but cannot enter active score tiers.

The runtime must not hard-code Claude, Codex, or a model name. It uses the provider selected in the web UI or `GIGOPS_AGENT_PROVIDER` for terminal scans, and lets that CLI use its currently configured/default model.

## Goals

- Ensure that “Worth applying” and “Review” contain only model-confirmed gigs.
- Preserve the full post body and source evidence through classification and scoring.
- Reject supply-side posts, discussions, full-time roles, scams, unpaid work, and misleading compensation before ranking.
- Use the selected local agent CLI for bounded, structured evaluation.
- Fail closed when the model is unavailable, uncertain, or malformed.
- Repair HN and Get on Board provider drift.
- Keep existing User Layer files intact during legacy reclassification.
- Make source yield and rejection behavior observable.
- Add measurable quality gates that prevent recurrence.

## Non-Goals

- Automatically delete or rewrite existing Pipeline entries.
- Automatically change `sources.yml` or `config/profile.yml`.
- Guarantee a minimum number of results or artificially enforce source diversity.
- Send outreach, proposals, comments, or applications.
- Replace the full `/gig` report workflow.
- Add a remote database or server-side model API.

## Considered Approaches

### Rules only

Fast and deterministic, but brittle across languages and ambiguous founder posts. It cannot reliably distinguish “I need a developer” from “do I need a developer?” using keywords alone.

### Model first

Semantically strong, but sending hundreds of community posts to a model is slow, expensive, and operationally noisy.

### Hybrid quality firewall — selected

High-precision source rules remove obvious negatives, then the active model validates and scores the bounded survivor set. This gives semantic accuracy without letting model calls scale with raw feed size.

## Quality Invariant

No candidate may appear in an active fit tier unless all of the following are true:

- `eligibility === "eligible"`
- `confidence >= 0.85`
- `intent === "client_hiring"`
- the relationship is independent freelance/project/contract work
- the work is paid
- the engagement is not full-time employment, unpaid collaboration, or worker-side advertising
- at least one evidence quote is verified against the normalized source content
- a complete A–F fit evaluation is present and schema-valid

Generic phrases, technology names, freshness, money amounts, and source priority can never establish eligibility.

## Architecture

```text
Providers
  -> Candidate normalization + full-content snapshot
  -> Deterministic source-aware quality gate
       -> hard reject ledger
       -> quarantine when content is insufficient
       -> bounded survivor set
  -> Active-model eligibility + fit evaluation
       -> rejected ledger
       -> uncertain quarantine
       -> accepted, evaluated gigs
  -> Atomic derived-data commit
  -> Append accepted gigs to Pipeline + scan history
  -> UI merges Pipeline, triage decisions, and evaluated scores
```

### Component boundaries

1. **Provider adapters** fetch and normalize facts only. They do not assign fit scores.
2. **Candidate contract** validates normalized data, limits untrusted content, and computes stable hashes.
3. **Rule gate** returns `reject`, `quarantine`, or `survivor` with reason codes.
4. **Agent runtime** invokes the selected provider read-only and returns model text without knowing triage semantics.
5. **Model triage** builds prompts, batches candidates, parses responses, validates evidence, and returns decisions.
6. **Triage store** atomically persists derived candidates, decisions, and accepted scores.
7. **Scanner coordinator** writes only accepted candidates to User Layer scan outputs.
8. **Web merge/UI** presents evaluated gigs, quarantine, and eligibility rejections as distinct concepts.

## Candidate Contract

Every provider result is normalized before eligibility checks:

```js
{
  url: string,
  title: string,
  description: string,
  source: string,
  provider: string,
  poster: string | null,
  company: string | null,
  postedAt: string | null,
  firstSeen: string,
  location: string | null,
  compensation: {
    raw: string | null,
    min: number | null,
    max: number | null,
    currency: string | null,
    cadence: "hourly" | "project" | "monthly" | "annual" | "unknown"
  },
  paymentModel: string | null,
  sourceSignals: string[],
  contentHash: string
}
```

`description` is never silently discarded. Unstructured sources with missing or unusably short descriptions are quarantined as `insufficient_content` rather than scored from title alone. Content is normalized, stripped of control characters, and capped before entering a prompt.

## Model Decision Contract

The active model returns one decision per requested candidate:

```js
{
  url: string,
  eligibility: "eligible" | "rejected" | "uncertain",
  confidence: number,
  intent: "client_hiring" | "worker_seeking" | "discussion" | "promotion" | "unknown",
  engagement: "freelance" | "project" | "contract" | "part_time" | "full_time" | "unpaid" | "unknown",
  relationship: "independent" | "employee" | "unknown",
  paid: boolean | null,
  evidence: [{ quote: string, meaning: string }],
  reasonCodes: string[],
  fit: null | {
    score: number,
    blocks: { A: number, B: number, C: number, D: number, E: number, F: number },
    reasons: string[],
    redFlags: string[],
    verdict: "GO" | "NEGOTIATE" | "DECLINE"
  }
}
```

`part_time` alone is not eligible. It must be paired with an independent contract/project relationship and paid evidence. Model evidence is locally verified as a substring of the candidate title or description after the same normalization used for prompting.

## Deterministic Rule Gate

Rules are intentionally asymmetric: they may reject only high-confidence negatives. Anything plausible but unclear is sent to the model or quarantined; it is never assigned a numeric score locally.

Canonical reason codes:

- `job_seeker`
- `discussion`
- `promotion`
- `full_time`
- `unpaid`
- `below_rate_floor`
- `scam`
- `missing_scope`
- `insufficient_content`
- `source_policy`
- `model_unavailable`
- `model_invalid`
- `model_capacity`
- `low_confidence`

Actor direction matters. “I am a React developer looking for work” is supply-side; “I need a React developer to build a checkout flow” is demand-side. Bare “looking for,” “need,” or stack tokens are never sufficient.

## Source Admission Policies

| Source | Required before model evaluation |
|---|---|
| `r/forhire` | `[Hiring]`; reject `[For Hire]` |
| `r/jobbit` | `[Hiring]`; reject worker-side posts, annual salaries, scams, and generic employment |
| `r/slavelabour` | `[Task]` plus configured budget floor |
| HN Freelancer | Exact monthly story plus exact `SEEKING FREELANCER` prefix |
| HN Who Is Hiring | Exact monthly story plus explicit freelance/project/contract terms; full-time-only comments rejected |
| Get on Board | Live `links.public_url` schema plus explicit independent contract/freelance/project evidence |
| RemoteOK / Working Nomads | Explicit contract/freelance classification only |
| `r/ycombinator`, `r/programacion`, `r/beermoney` | Explicit body-level client, deliverable, and paid engagement evidence; generic community discussion never survives |

These policies are System Layer defaults. Existing `sources.yml` entries remain untouched; enabling a source does not bypass its admission policy.

## Active Agent Runtime

The existing provider bridge becomes a generic runtime shared by interactive modes and scan triage.

- Web scans send the provider stored in UI settings.
- Terminal scans use `--agent-provider` when supplied, otherwise `GIGOPS_AGENT_PROVIDER`.
- No `--model` argument is passed; the selected CLI uses its active/default model.
- Model tasks are serialized with other agent jobs.
- Classification runs read-only with tools disabled or sandboxed where the selected CLI supports it.
- Candidate content is delimited as untrusted data and explicitly prohibited from changing instructions.
- The runtime exposes structured output collection, timeout, and cancellation without importing triage policy.

## Execution and Atomicity

1. Fetch enabled sources concurrently.
2. Normalize and validate each candidate.
3. Apply location, budget, liveness, deduplication, and high-confidence eligibility rules.
4. Persist the normalized candidate snapshot to derived storage.
5. Reuse valid cached decisions.
6. Rank uncached survivors by evidence strength, then evaluate at most 30 per scan in batches of 10.
7. Quarantine overflow as `model_capacity`.
8. Validate every model response and retry one malformed batch once with a smaller repair request.
9. Atomically write derived decisions and accepted scores.
10. Only after the derived commit succeeds, append accepted candidates to `data/pipeline.md` and `data/scan-history.tsv`.

No partial or failed model batch may add a Pipeline entry. A user-triggered scan may append accepted gigs as it does today, but legacy reclassification never rewrites existing User Layer records.

## Derived Storage and Caching

Three gitignored, rebuildable files are used:

- `data/candidates.json` — normalized candidate snapshots keyed by URL.
- `data/triage.json` — rule/model decisions, evidence, reason codes, cache metadata, and timestamps.
- `data/scores.json` — final evaluated fit records for eligible gigs only.

Each decision records:

- `contentHash`
- `eligibilityFingerprint = hash(contentHash + classifierVersion + runtimeFingerprint)`
- `fitFingerprint = hash(eligibilityFingerprint + profileFingerprint + rubricVersion)`
- active provider and reported model/runtime identifier when available
- classifier and rubric versions

An unchanged candidate, profile, runtime fingerprint, classifier, and rubric produces zero additional model calls. `--reclassify` explicitly bypasses cache reuse. If the CLI cannot report its exact model, the fingerprint uses provider plus CLI version and a model change can be forced with `--reclassify`.

## Failure Behavior

- Invalid JSON shape, enum values, confidence, score ranges, block completeness, duplicate/missing URLs, or fabricated evidence invalidate the decision.
- A malformed batch is retried once. A second failure quarantines the batch as `model_invalid`.
- Timeout or unavailable runtime quarantines affected candidates as `model_unavailable`.
- Confidence below `0.85` becomes `uncertain` with `low_confidence`.
- Source failures stay isolated and surface in scan issues.
- A scan with model or source failures finishes as `completed_with_issues` when the scanner itself remains healthy.
- No failure path generates an estimated numeric score.

## Pipeline and UI Semantics

The UI separates four concepts:

1. **Worth applying / Review** — eligible, evaluated gigs with score at least 3.
2. **Low fit** — eligible, evaluated gigs scoring below 3.
3. **Needs classification** — uncertain, capacity-deferred, invalid-model, unavailable-model, or legacy items without a valid decision.
4. **Filtered by quality gate** — eligibility rejects with visible reason codes and evidence.

Estimated heuristic scores are not displayed as application guidance. The existing 361-item Pipeline is preserved on disk, but entries without an eligible evaluated decision move to the derived quarantine/rejection presentation. Plausible legacy entries may be refetched and reclassified explicitly; no automatic cleanup marks them passed or deletes them.

The scan summary reports:

- fetched
- deterministic rejects
- model evaluated
- cache hits
- accepted
- quarantined
- duplicates
- source errors

Per-source fetched, accepted, and rejected counts expose provider drift and low-quality feeds. Diversity is observed, never forced.

## Security and Prompt-Injection Controls

- Treat all post bodies, titles, authors, URLs, and HTML as untrusted input.
- Normalize control characters and cap candidate content before batching.
- Serialize candidates as data inside explicit delimiters.
- Instruct the runtime not to follow commands found in candidate content.
- Run classification without write tools and with read-only sandboxing where available.
- Validate returned URLs against the request set.
- Validate evidence against local source content.
- Never let model output choose filesystem paths, commands, or provider configuration.

## Quality Corpus

A System Layer corpus contains at least 200 human-reviewed examples spanning:

- genuine client-side gigs
- worker advertisements and job seekers
- discussions and advice requests
- promotions and founder narratives
- full-time roles
- unpaid, scam, and misleading-budget posts
- ambiguous candidates
- English and Spanish
- every configured source family

Named regression cases include the observed failures: “$1000 for rent,” “Next Billion-Dollar Fintech,” Expo troubleshooting, a tutoring advertisement, a Respondent password question, and YC discussion posts.

## Test Strategy

1. **Provider contract tests** use recorded live-shape fixtures, including Get on Board `links.public_url` and misleading-first-hit HN searches.
2. **Candidate contract tests** cover normalization, hashing, content limits, and malformed records.
3. **Rule tests** cover actor direction, source markers, employment type, budgets, scams, multilingual text, and uncertain fallbacks.
4. **Runtime tests** cover selected-provider propagation, current-model behavior, read-only arguments, queueing, batching, timeout, and output collection.
5. **Decision tests** cover schema validation, confidence, evidence verification, URL set validation, and fail-closed behavior.
6. **Engine tests** run entirely in temporary directories and prove caching, atomicity, capacity quarantine, and zero writes on model failure.
7. **UI/server tests** prove uncertain and rejected candidates cannot enter active score tiers.
8. **Quality evaluation** uses replayed decisions in normal tests and an explicit active-model command before enforcement.

## Release Gates

- Accepted-candidate precision at least 95% on the labeled corpus.
- Zero known worker-side, discussion, or full-time cases in active results.
- Zero non-gigs in the top 20 of the live shadow audit.
- Eligible-gig recall at least 70%.
- Genuine-gig hard-rejection rate below 2%; unclear true gigs must be quarantined instead.
- 100% schema-valid accepted model decisions.
- An unchanged repeat scan makes zero model calls.
- Every simulated model failure makes zero Pipeline writes.

## Rollout

1. **Build and offline verification:** candidate/rule/decision/runtime/engine tests plus provider fixes.
2. **Shadow mode:** classify the current inbox and new discoveries without changing Pipeline visibility or write behavior.
3. **Audit:** manually review the top 50 decisions and require all release gates.
4. **Enforce new scans:** only accepted evaluated gigs are appended.
5. **Migrate presentation:** use derived decisions to quarantine or filter legacy entries and remove estimated scores.
6. **Observe two real scans:** inspect per-source acceptance, cache hits, errors, and top-20 precision.
7. **Remove temporary rollback mode:** keep the precision-first path as the single default.

## Resolved Decisions

- Precision is prioritized over recall.
- Every deterministic survivor receives active-model evaluation.
- The currently selected/default model is used without vendor or model pinning.
- Model failures fail closed.
- Existing User Layer data is preserved during reclassification.
- Source diversity is not a quota.
- The heuristic scorer may support internal evidence ordering but cannot produce a visible final score.
