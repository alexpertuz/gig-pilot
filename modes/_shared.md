# gig-pilot Scoring System

<!-- Imported by modes/gig.md and modes/auto-pipeline.md. Do not invoke directly. -->

## Overview

Every gig evaluation produces a score from **1–5** across 6 blocks (A–F).

| Block | Name | Weight | What it measures |
|-------|------|--------|-----------------|
| A | Archetype Fit | 25% | Does this match your services? |
| B | Budget Realism | 25% | Is compensation fair and real? |
| C | Scope Clarity | 20% | Is the deliverable well-defined? |
| D | Poster Legitimacy | 15% | Is the poster credible? |
| E | Channel & Terms | 10% | Is the engagement channel sane? |
| F | Timing & Urgency | 5% | Is the timeline realistic? |

Final score = weighted average. Round to one decimal place.

---

## Block A — Archetype Fit (25%)

Read `config/profile.yml` → `archetypes`.

| Score | Criteria |
|-------|----------|
| 5 | Primary archetype exact match: stack, domain, level all align |
| 4 | Primary archetype strong match: 1 minor gap (adjacent stack, slightly different level) |
| 3 | Secondary archetype or stretch primary |
| 2 | Adjacent archetype — can do it but wouldn't pick it |
| 1 | Not a match — wrong domain or requires skills you don't have |

---

## Block B — Budget Realism (25%)

Read `config/profile.yml` → `rate_card`.

**Hard stops (auto-score 1, recommend DECLINE):**
- "unpaid", "for your portfolio", "in exchange for exposure/testimonial"
- "equity only" or "rev share only" with zero upfront
- No mention of any compensation whatsoever
- Budget below walk-away rate

| Score | Criteria |
|-------|----------|
| 5 | Budget at or above target rate; payment model in `accepted_models` |
| 4 | Budget 20% below target but above walk-away; or model is acceptable |
| 3 | Budget at walk-away floor; or partially undisclosed ("negotiable" with signals it's fair) |
| 2 | Budget vague or slightly below walk-away; may be negotiable |
| 1 | Budget is a hard stop (see above) |

---

## Block C — Scope Clarity (20%)

| Score | Criteria |
|-------|----------|
| 5 | Specific deliverable, defined acceptance criteria, existing design/spec, clear end date |
| 4 | Clear deliverable with minor gaps (e.g. design done, scope mostly defined) |
| 3 | Deliverable identifiable but missing key details (no design, unclear integrations) |
| 2 | Vague description; catchphrases like "simple app", "just need X", "ASAP" without context |
| 1 | Fully vague ("build me a startup", "co-founder wanted", "help with everything") |

**Scope creep signals (each drops score by 0.5, minimum 1):**
- "MVP" without defined feature list
- "ASAP" or "urgent" without justification
- "simple" or "quick" (almost always isn't)
- "and also..." (scope expansion mid-description)

---

## Block D — Poster Legitimacy (15%)

For Reddit sources: check post history, account age, karma signals.
For other sources: check company/profile existence, post history, contact method clarity.

| Score | Criteria |
|-------|----------|
| 5 | Verified account/company, clear contact, post history shows paid work, portfolio/website linked |
| 4 | Real account, reasonable history, no red flags |
| 3 | New or low-activity account but post is genuine; or no history available (non-Reddit source) |
| 2 | Account < 30 days old OR zero relevant post history; or contact method unclear |
| 1 | Strong red flags: no post history + new account + vague contact; or post reads like a template dump |

**Auto-flag red flags (mark in report, push score toward 1):**
- Account created < 1 week ago AND first post is a hiring request
- Post is copy-paste of a known template
- Contact is only "DM me" with no other info
- Previously removed posts visible in history
- Requests "test task" or "trial period" for free before any agreement

---

## Block E — Channel & Terms (10%)

| Score | Criteria |
|-------|----------|
| 5 | Clear channel (email or DM with contact info), reasonable IP/contract terms indicated |
| 4 | DM-only but reasonable (normal for Reddit gigs) |
| 3 | Apply via external form; no contract/IP terms but not concerning for scope |
| 2 | Ambiguous channel; or signs of IP overreach ("we own everything you create, including prior work") |
| 1 | Red flags: requires NDA before basic scope info; requires extensive unpaid spec work; abusive IP terms |

---

## Block F — Timing & Urgency (5%)

| Score | Criteria |
|-------|----------|
| 5 | Reasonable timeline with buffer; async-friendly |
| 4 | Tight but achievable timeline |
| 3 | Timeline vague ("as soon as possible") |
| 2 | Unrealistic timeline for described scope |
| 1 | "Need by tomorrow" / weekend emergency / implies 24/7 availability |

---

## Scoring thresholds

| Score | Decision |
|-------|----------|
| ≥ 4.0 | **GO** — pursue, generate proposal |
| 3.0 – 3.9 | **NEGOTIATE** — pursue only with specific conditions met |
| < 3.0 | **DECLINE** — not worth pursuing |

A score of **1 on Block B** is always a hard DECLINE regardless of other scores.

---

## Report format

Reports are written to `reports/{num}-{slug}-{date}.md`.
Number is reserved via `node reserve-report-num.mjs`.

```
# [{num}] {Gig Title} — {Poster} ({source}) [{date}]

**Score: {score}/5 | {GO / NEGOTIATE / DECLINE}**

## Block Scores
| Block | Score | Notes |
|-------|-------|-------|
| A — Fit | X.X | ... |
| B — Budget | X.X | ... |
| C — Scope | X.X | ... |
| D — Legitimacy | X.X | ... |
| E — Channel | X.X | ... |
| F — Timing | X.X | ... |
| **Total** | **X.X** | |

## Summary
[2–4 sentences: what the gig is, who it's for, why the score]

## Red Flags
[Bullet list of any hard-stop items or yellow flags — omit section if none]

## GO / NEGOTIATE / DECLINE Rationale
[One paragraph on the decision. If NEGOTIATE: what specific conditions would flip it to GO.]

## Suggested Rate
[Your estimated rate for this gig based on scope + rate card]

## Proposal Angle
[One sentence: what proof point or differentiator to lead with in /proposal]
```

---

## Tools available during evaluation

- `node tracker.mjs status` — show current leads count and pipeline state
- `node reserve-report-num.mjs` — get next report number (call before writing)
- `config/profile.yml` — your identity, services, rate card
- `data/pipeline.md` — the URL inbox

---

## Global rules

1. **Never evaluate a gig without reading `config/profile.yml` first.** The entire scoring system is relative to your profile.
2. **Block B score of 1 = hard DECLINE.** Write the report, explain why, do not generate a proposal.
3. **Be specific in red flags.** Not "seems suspicious" — quote the exact phrase that triggered the flag.
4. **Suggested rate must be a number.** Not "negotiable" — pick a number and justify it.
5. **Do not skip blocks.** A missing block is an incomplete evaluation.
6. **One report per gig.** If already evaluated (check `data/scan-history.tsv`), note the duplicate and link to the original.
