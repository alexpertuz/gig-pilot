# Design: Port three career-ops pieces to the gig/leads model

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan

## Goal

Port three features from the upstream `santifer/career-ops` project into
`gig-ops`, adapting each from the job-application domain to the freelance
gig/leads domain. Explicitly **out of scope:** the Next.js web dashboard, and
the pieces that turned out to be poor fits on source review (`process-quality`
= interview-round friction, `_trust-validator` = employer/ATS domain,
`match-star` = STAR interview answers, `classify-tier` = role seniority tiers).

## Context

- gig-ops is a flat-file, ESM (`*.mjs`), no-build pipeline. Git is the sync
  layer. See `AGENTS.md`.
- **Cardinal rule:** never auto-update User Layer files (`config/profile.yml`,
  `sources.yml`, `data/leads.md`, `reports/*`). These ports touch System Layer
  scripts and *read* user data; new data files they create (`data/agent-inbox.md`,
  `data/follow-ups.md`) are user-owned once created and must not be clobbered.
- Canonical lead status model (`AGENTS.md`): `new | contacted | replied |
  negotiating | won | lost | dropped`. There is no interview stage.
- Env var convention already in use locally: `GIG_OPS_*` (rename from
  `CAREER_OPS_*` already done in the fork).
- Existing local dependencies available for reuse: `role-matcher.mjs`
  (`roleFuzzyMatch`), `followup-cadence.mjs`, `providers/_http.mjs`,
  `data/scan-history.tsv` (columns: `url, first_seen, portal, title, company,
  status, location`).

### Known migration debt (noted, NOT fixed in this pass)

- `followup-cadence.mjs` still carries the career model: `applied_first` /
  `applied_subsequent` cadence keys, `parseAppliedDate`, `normalizeStatus`
  around `applied`, and reads `applications.md`.
- `merge-tracker.mjs`, `normalize-statuses.mjs`, `test-all.mjs`, and
  `tracker-columns-tests.mjs` still reference `Applied` / `Interview` statuses.

These are pre-existing and out of scope. Unit 3 layers on top without
rewriting them.

## Units

The three units are independent, independently testable, and shipped in order
1 → 2 → 3 (easy → hard).

### Unit 1 — `agent-inbox.mjs` (+ `modes/agent-inbox.md`, test)

A standalone markdown triage queue backed by `data/agent-inbox.md`. Not coupled
to the web app (verified: 144-line CLI, no web imports).

**What it does:** append/list/complete triage items so an agent (or the user)
can work a queue of gigs pending a decision.

**Adaptation from upstream:**
- Env var `CAREER_OPS_INBOX` → `GIG_OPS_INBOX`.
- Header / session-label text `career-ops` → `gig-ops`.
- Item columns lead-oriented (poster / gig) rather than company / role.

**Dependencies:** none.
**Interface:** CLI subcommands (`add <url> [note]`, `list`, `done <n>`), same
shape as upstream. Reads/writes `data/agent-inbox.md`.

### Unit 2 — `detect-reposts.mjs` (+ test)

Reads `data/scan-history.tsv` and flags near-identical postings seen across
multiple scans — a strong "still-open / repeatedly-posting" signal for gigs.

**Keying decision (approved):** grouping identity =
`company || poster-derived-from-reddit-URL`. When that identity is empty, fall
back to **fuzzy title within the same portal** (via `role-matcher.roleFuzzyMatch`).
This catches Reddit reposts, whose `company` column is empty. Rationale: Reddit
is the primary demand-side source; company-only keying (upstream behavior) would
detect zero Reddit reposts.

**Adaptation from upstream:**
- Add a `posterFromUrl(url)` helper for `reddit.com/u|user/<name>` and
  comment/post permalinks; fall through to `''` for non-Reddit URLs.
- Grouping key builder: `company || posterFromUrl(url) || fuzzy-title-bucket`.
- Report wording: "gig reposted" rather than "role reposted".

**Dependencies:** `role-matcher.mjs` (present), `data/scan-history.tsv`.
**Interface:** CLI, prints grouped repost report; exit 0 always (informational).

### Unit 3 — `followup-seed.mjs` (+ new `tracker-parse.mjs`, test)

Seeds a `next_followup` date into the tracker the moment a lead reaches
`contacted`, so follow-ups are never "born dead" (missing a due date).

**Scope decision (approved):** seed only. Trigger retargeted `Applied` →
`contacted`; reads `data/leads.md`. Does **not** rewrite `followup-cadence.mjs`'s
career model — that debt is noted above and left for a separate pass.

**New dependency:** a small `tracker-parse.mjs` exporting `resolveColumns` and
`parseTrackerRow`, tuned to the `leads.md` column order documented in `AGENTS.md`
(`num, date, source, poster, gig, channel, status, score, rate, next_followup,
report`). This is a focused parsing helper, not a port of the whole upstream
tracker stack.

**Adaptation from upstream:**
- Env vars `CAREER_OPS_*` → `GIG_OPS_*`.
- Tracker path `applications.md` → `data/leads.md`.
- `follow-ups.md` row columns → lead-oriented (`num, leadNum, date, poster, gig,
  channel, contact, notes`).
- Status trigger `applied` → `contacted`; terminology `appNum` → `leadNum`.
- Lock-file prefix `career-ops` → `gig-ops`.

**Interface:** CLI; scans `leads.md`, seeds missing `next_followup` for
`contacted` leads, appends to `data/follow-ups.md`. Idempotent (never
double-seeds an already-seeded lead).

## Testing

- Match the existing local test style. Upstream ships `*.test.mjs` / inline
  test blocks; each unit gets a test covering: happy path, the adaptation edge
  (Reddit poster keying for Unit 2, `contacted` trigger + idempotency for
  Unit 3, add/list/done for Unit 1).
- Wire into `test-all.mjs` if that is the aggregate runner; otherwise standalone
  `node <unit>.test.mjs`.

## Error handling

- All three degrade gracefully on missing input files (empty scan-history /
  leads → empty report / no-op, never throw).
- Unit 3 is idempotent and lock-guarded (ported lock, `gig-ops` prefix) so
  concurrent runs don't corrupt `follow-ups.md`.
- User Layer files are read-only inputs; only System Layer + the two new
  user-owned data files are written, and never overwritten wholesale.

## Out of scope

Next.js web dashboard; `process-quality`; `_trust-validator`; `match-star`;
`classify-tier`; `_registry` (no duplication to remove yet); rewriting
`followup-cadence.mjs` / the lingering `Applied`/`Interview` status references.
