# Design: Automatic Gig Scoring for the Pipeline

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan
**Scope:** Scoring system only. Does **not** touch proposals, tracker, leads, or followups.

## Problem

gig-ops is a fork of career-ops. career-ops feels useful because **every posting
arrives pre-scored with visible reasons** — you glance at a card and know the fit
score, budget verdict, and red flags without opening anything.

gig-ops has all the scoring machinery (`modes/gig.md` rubric, `modes/_shared.md`,
`gemini-eval.mjs`) but the web UI never runs it by default. Scoring happens only when
the user clicks "Evaluate" on **one gig at a time**. In practice:

- **~0% of the board is scored.** The pipeline is a wall of ungraded URLs.
- **Cards are data-starved.** `PipelineBoard` derives a title from the URL slug and
  shows a truncated URL + status chip. No score, budget, date, source, or reasons —
  even though `data/scan-history.tsv` already holds real titles, `first_seen` dates,
  source, and location.
- **No triage.** Stale gigs (2+ months old) pile up forever, and junk (job-seekers
  posting "looking for work", full-time r/jobbit posts, scams like "earn 50% from
  each payment") looks identical to real leads.

The through-line: **the board should be a ranked, reasoned, fresh triage list — not
an inbox of raw links.**

## The scoring method (from career-ops — unchanged)

career-ops scores with an **LLM given a structured rubric + the user's profile**.
There is no rule-based scorer upstream. The rubric (`modes/_shared.md`) is 6 weighted
blocks:

| Block | Weight | What it judges |
|-------|--------|----------------|
| A | 25% | Archetype Fit |
| B | 25% | Budget Realism |
| C | 20% | Scope Clarity |
| D | 15% | Poster Legitimacy |
| E | 10% | Channel |
| F | 5%  | Timing |

Weighted total is 0–5. **≥4.0 = GO, 3.0–3.9 = NEGOTIATE, <3.0 = DECLINE.** A `1` on
Budget is an automatic decline. The LLM writes a per-block reason and a machine-readable
`---SCORE_SUMMARY---` tail that gets parsed into a `reports/` file.

We keep this method verbatim. We change **when it runs and how results are surfaced.**

## Approach: two tiers of the same rubric, one visible score

The core insight: the current LLM scorer is high-fidelity per gig but scores nothing by
default. A cheap heuristic that scores **100% of gigs instantly** is strictly better at
the thing that's broken (ranking + junk removal), and it makes running the expensive LLM
method affordable — Claude only evaluates gigs that survive triage.

The two tiers produce **one score on one scale**, not two competing numbers.

### Tier 1 — Heuristic prospect score (every gig, at scan time, free)

A new pure module `score-heuristic.mjs`:

```
scoreHeuristic(gig, profile) -> {
  total,            // 0-5, weighted over the 6 blocks
  blocks: { A, B, C, D, E, F },
  reasons: [string],   // rule-derived, e.g. "$20/hr below $40 walk-away"
  redFlags: [string],
  verdict,          // "GO" | "NEGOTIATE" | "DECLINE"
  state: "estimated"
}
```

It judges the **mechanical** blocks from data we already have, and leaves the
**judgment** blocks at a neutral default (so it can't over-claim):

- **B Budget Realism** — parse `$`/rate from title+body; compare to
  `rate_card.hourly.walk_away` (40), `.target` (75), `project.min` (500). Below
  walk-away → low; unpaid/equity/revenue_share (`rate_card.declined_models`) → hard 1.
- **A Archetype Fit** — keyword match of title+body against `archetypes[].stack` and
  `services.primary/secondary`. Primary hit scores higher than secondary.
- **F Timing** — from `first_seen`; recent scores full, decays with age.
- **E Channel** — contact method if detectable (dm/email/apply).
- **C Scope Clarity** — neutral default (2.5), nudged by `ideal_gig.green_flags` /
  `yellow_flags` / `avoid_scope` keyword presence.
- **D Poster Legitimacy** — neutral default, nudged by hard junk phrases only.

**Hard-decline / junk detection** (drives auto-sink): `declined_models` phrases,
job-seeker signals ("looking for a job", "looking for work", "21M looking for"),
scam phrases ("earn 50%", "daily income", "turn your charm"). Any hit → verdict
DECLINE with the matched phrase as a red flag.

Runs for every new gig during `scan.mjs` (or a post-scan pass). Writes to `scores.json`
with `state: "estimated"`.

### Tier 2 — Claude auto-eval (survivors only, real rubric)

Reuses the existing `/gig` rubric flow. After a scan, gigs with an estimated score
**≥ 3.0** (threshold configurable) are evaluated by Claude in batch. For each:

- Claude runs the full 6-block rubric (now genuinely judging C Scope and D Legitimacy).
- It writes the `reports/{num}-{slug}-{date}.md` report as today.
- It **overwrites** that gig's `scores.json` entry with the real blocks/reasons and
  flips `state` to `"evaluated"`.

Scam posts that scored 1.2 never reach Tier 2, so no Claude run is spent on them.

## Data model — new derived file `data/scores.json`

The score data is **derived** (recomputable from gig text + `config/profile.yml`), so it
is System/derived layer — safe to delete and rebuild. This respects the cardinal rule:
`data/pipeline.md` stays the user's untouched URL inbox and is never mutated by scoring.

`data/scores.json` is keyed by gig URL:

```json
{
  "https://www.reddit.com/r/forhire/comments/…/": {
    "title": "[Hiring] Graphic Designer — Contract $25–35/hr",
    "source": "r/forhire",
    "first_seen": "2026-06-24",
    "budget": { "raw": "$25 $35/Hourly", "min": 25, "max": 35, "unit": "hourly" },
    "score": 3.6,
    "blocks": { "A": 4.0, "B": 2.5, "C": 2.5, "D": 3.0, "E": 3.0, "F": 4.0 },
    "reasons": ["Matches archetype: Frontend", "$25/hr below $40 walk-away"],
    "redFlags": [],
    "verdict": "NEGOTIATE",
    "state": "estimated",
    "report": null,
    "scoredAt": "2026-07-07T…"
  }
}
```

It is added to `.gitignore` (derived, like `data/leads.db`). A rebuild command
(`node score-heuristic.mjs --rebuild` or a scan flag) regenerates it from
`pipeline.md` + `scan-history.tsv` + profile.

## Server & UI changes

**Server (`apps/server`):** `GET /api/pipeline` merges three sources per URL —
`pipeline.md` (which URLs are in the inbox + checked state), `scan-history.tsv`
(title, `first_seen`, source, location), and `scores.json` (score, blocks, reasons,
verdict, state). `PipelineItem` gains: `score`, `verdict`, `state`, `budget`,
`source`, `firstSeen`, `reasons`, `redFlags`, `report`.

**Card UI (`PipelineBoard.tsx`):**

- **One score number**, colored by verdict (GO green / NEGOTIATE amber / DECLINE red).
- A single dim state marker — `estimated` → `evaluated` — the only hint of tier. It is
  a label, **never a second number**. (May be dropped entirely if it still reads as
  clutter.)
- Real title, source, `first_seen` (relative, e.g. "12d ago"), parsed budget.
- Top 1–2 reasons inline; full block breakdown on expand.
- **Sorted by score descending.**
- **Junk auto-sinks:** DECLINE/hard-decline gigs collapse into a low "Passed on"
  section. **Stale gigs** (old `first_seen`, threshold configurable) fade and are
  eligible for expiry/prune.

## Out of scope (explicit)

- No changes to proposal generation, tracker/leads, or followups.
- Not fixing/using the `gemini-eval.mjs` free-tier path — auto-eval runs through Claude
  per the user's decision. (`gemini-eval.mjs` migration debt is noted but untouched.)
- No new scoring rubric — the 6 blocks and thresholds in `modes/_shared.md` are reused.

## Open implementation questions (for the plan, not the design)

1. Exact per-block heuristic formulas and weights for the "nudge" defaults on C/D.
2. Where Tier-1 scoring hooks in: inside `scan.mjs` vs. a separate post-scan pass.
3. How Tier-2 batch eval is triggered from the web UI (auto after scan vs. a button)
   and how it reports progress (reuse the SSE job stream already used by `scan.tsx`).
4. Staleness threshold + whether expiry auto-checks the `pipeline.md` box or just fades.
