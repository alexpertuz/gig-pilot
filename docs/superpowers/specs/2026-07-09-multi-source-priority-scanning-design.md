# Multi-Source Priority Scanning — Design

**Date:** 2026-07-09
**Status:** Approved

## Problem

gig-ops currently sources gigs almost exclusively from Reddit (plus two disabled
full-time job boards). Founders and startups post their needs in other places —
Hacker News, startup job boards, freelance marketplaces — and there is no notion
of source priority: a gig from a high-signal founder community ranks the same as
one from a low-signal microtask subreddit.

## Goals

1. Add new zero-token HTTP providers: Hacker News, Get on Board, Contra
   (best-effort), and Indie Hackers / YC Work at a Startup (investigate-first).
2. Add per-source priority tiers that affect both scan order and heuristic score.
3. Broaden demand detection beyond the literal word "freelancer".
4. Document (not build) the browser-assisted phase for auth-walled sources.

## Non-Goals (deferred)

LinkedIn posts, Facebook groups, Wellfound, and Discord cannot be scanned with
plain unauthenticated HTTP. They are deferred to a future **browser-assisted
scan phase**: a `/scan-social` mode where Claude drives the user's logged-in
Chrome session via claude-in-chrome, extracts candidate posts, and appends them
to `data/pipeline.md` through the same dedup/filter path. Discord alternatively
via a user-created bot token in servers that permit bots. Out of scope here.

## Design

### 1. New providers (`providers/*.mjs`)

Each follows the existing contract: default export `{ id, fetch(entry, ctx) }`,
pure HTTP+JSON, per-source errors are non-fatal (scan.mjs already isolates
provider failures).

**`hn.mjs` — Hacker News (tier 1).** Free Algolia API
(`hn.algolia.com/api/v1`). Two feeds, selected per sources.yml entry:

- `thread: freelancer` — finds the latest monthly *"Freelancer? Seeking
  freelancer?"* story, fetches its top-level comments. Comments starting with
  `SEEKING FREELANCER` are demand-side by thread convention → gigs. Poster =
  HN username, url = comment permalink, description = comment body (HTML
  stripped).
- `thread: whoishiring` — latest *"Ask HN: Who is hiring?"* story, comments
  filtered to contract/freelance/part-time mentions (full-time-only comments
  dropped in the provider, since this thread is mostly FTE).

**`getonboard.mjs` — Get on Board (tier 1–2).** Public JSON API
(`getonbrd.com/api/v0/categories/{category}/jobs`). Configurable `categories`
list. Payload includes salary/budget fields → mapped to `budget` so the
existing budget filter applies. Prefer `remote: true` filtering server-side if
the API supports it, otherwise client-side on the payload.

**`contra.mjs` — Contra (tier 2, best-effort).** Internal GraphQL endpoint —
exact query verified at implementation time. Must fail soft: any schema change
surfaces as a per-source error, never breaks the scan. If no stable
unauthenticated endpoint exists at implementation time, ship the provider
disabled with a comment, or drop it to the deferred phase.

**Indie Hackers / YC Work at a Startup — investigate-first.** Checked during
implementation for a reachable JSON surface (IH internal API, YC's public
JSON). If either requires a browser, it moves to the deferred phase instead of
shipping broken. Not a blocking item.

### 2. Priority tiers

- Each `gig_boards` entry in `sources.yml` may set `priority: 1|2|3`
  (1 = founder/startup communities, 2 = default when absent, 3 = low-signal).
- `scan.mjs` sorts resolved targets by priority ascending before fetching, so
  tier-1 sources are scanned first and their gigs land first at equal relevance.
- Each offer is stamped with `priority`; it is written as a new trailing
  scan-history column (format already tolerates added columns) and included in
  the pipeline line's trailing signal (e.g. `relevance:2 tier:1 [...]`).
- `score-heuristic.mjs` Block E (Channel): tier 1 → +0.75, tier 3 → −0.75,
  clamped to [1, 5].
- Suggested default tiers in sources.yml: HN threads and r/ycombinator = 1;
  r/forhire, r/jobbit, Get on Board, Contra = 2; r/slavelabour, r/beermoney = 3.

### 3. Broader demand detection

- Expand `title_filter.positive` in `sources.yml` (and the template) with
  demand phrases beyond "freelancer": *need help with, anyone available, who
  can build, hire someone, looking to hire, budget of, paying, part-time,
  consultant, contractor, short-term, quick project, small project, recommend
  a developer, recommend an agency, dev needed, help wanted*.
- `scan.mjs` relevance: when the title produces zero positive matches but the
  gig has a `description`, run the same positive matcher against the
  description and use those hits for relevance/matched-keywords (title-only
  behavior unchanged when the title hits). Negative keywords keep rejecting on
  title as today; description negatives remain the job of `content_filter`.
  This is what makes HN comments (rich body, no meaningful title) rankable.

### 4. Testing

- Provider normalizers tested with fixture payloads (no network).
- Priority: target sort order; offer stamping; scan-history column round-trip.
- Scoring: tier 1/2/3 → Block E adjustments, clamping.
- Relevance fallback: title miss + description hit → description keywords used.

## Data-contract note

`sources.yml` is User Layer. The implementation updates
`templates/sources.example.yml` and adds the new entries to the user's
`sources.yml` only as part of this explicitly requested change — new sources
default `enabled: true` for HN/Get on Board, `enabled: false` for best-effort
providers until verified live.
