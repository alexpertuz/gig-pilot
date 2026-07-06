# Gig-Ops Freelance Pipeline

**gig-ops** is a local, AI-powered freelance pipeline. It aggregates on-demand and collaboration postings, evaluates them for fit and legitimacy, generates tailored proposals, and tracks your outreach. No database. No server. Git is the sync layer.

It is designed to be driven from the terminal as a Claude Code (or compatible) plugin.

## What this repo is

It is a **config-driven, flat-file pipeline**. You configure your profile and sources, then run commands.

**It is NOT a web app.**

## Architecture

There are two layers of files in this repo. Never confuse them.

**User Layer** — your personal data (never auto-updated):
- `config/profile.yml` — your identity, services, rate card, ideal-gig profile
- `sources.yml` — your customized list of gig sources
- `data/leads.md` — your outreach tracker (source of truth)
- `data/pipeline.md` — your incoming URL inbox
- `reports/*` — your gig evaluation reports

**System Layer** — logic and scripts (safe to update):
- `modes/*.md` — AI prompt modes (gig evaluation, proposals, pipeline, tracker…)
- `providers/*.mjs` — gig source plugins
- `scan.mjs` and other `*.mjs` utilities

**THE CARDINAL RULE: never auto-update User Layer files. Never. Not even to "fix" them.**

The full contract is in `DATA_CONTRACT.md`.

## Onboarding a new user

On first run, call `node tracker.mjs onboarding-status` (or check if `config/profile.yml` exists and contains `name:`).

If not configured, do a structured onboarding:

```
What services do you offer? (e.g. "Full-stack development, React, Node.js")
What's your target hourly rate? Walk-away rate?
What kinds of gigs excite you? What's your ideal scope?
```

Then copy `config/profile.example.yml` → `config/profile.yml` and fill in the answers.

## Modes (slash-commands)

| Mode | File | What it does |
|------|------|-------------|
| `/gig` | `modes/gig.md` | Evaluate a gig posting for fit, budget, scope, legitimacy |
| `/proposal` | `modes/proposal.md` | Generate a tailored proposal or DM |
| `/pipeline` | `modes/pipeline.md` | Work through the pipeline inbox |
| `/auto-pipeline` | `modes/auto-pipeline.md` | Automated inbox processing |
| `/batch` | `modes/batch.md` | Batch evaluate multiple gigs |
| `/scan` | `modes/scan.md` | Scan sources for new gigs |
| `/tracker` | `modes/tracker.md` | Manage the leads tracker |
| `/followup` | `modes/followup.md` | Follow-up cadence |
| `/patterns` | `modes/patterns.md` | Analyze your win/loss patterns |
| `/deep` | `modes/deep.md` | Deep-dive research on a poster or company |
| `/agent-inbox` | `modes/agent-inbox.md` | Work a triage queue of gigs pending a decision |

## The pipeline flow

```
node scan.mjs            → adds new gig URLs to data/pipeline.md
/pipeline or /gig <url>  → evaluates each gig, writes report to reports/
/proposal                → generates a draft proposal for a go-rated gig
/tracker                 → logs the lead to data/leads.md
/followup                → schedules follow-up actions
```

## Scoring quick reference (Block letters)

A = Archetype Fit | B = Budget Realism | C = Scope Clarity | D = Poster Legitimacy | E = Channel | F = Timing | G = Red Flags

**Red flags** that should auto-trigger "decline or counter":
- "unpaid collab", "for portfolio", "equity only", "revenue share as payment"
- MVP already done, "just need X" (hidden scope creep)
- Account < 30 days old, zero post history, vague contact method
- Requesting spec work or "test task" before any agreement

Overall score is 1–5 across blocks. A `< 3.0/5` is a hard decline. `3.0–3.9` is negotiate-only. `≥ 4.0` is go.

## Leads tracker (`data/leads.md`)

Tab-separated table managed by `tracker.mjs`.

```
{num}	{date}	{source}	{poster}	{gig}	{channel}	{status}	{score}/5	{rate}	{next_followup}	[{num}](reports/{num}-{slug}-{date}.md)
```

**Columns:**
1. `num` — sequential lead number (zero-padded 3 digits)
2. `date` — ISO date first seen
3. `source` — where it came from (e.g. `r/forhire`, `remoteok`)
4. `poster` — Reddit username or poster handle
5. `gig` — title / brief description
6. `channel` — `dm`, `email`, `comment`, `apply`
7. `status` — `new` | `contacted` | `replied` | `negotiating` | `won` | `lost` | `dropped`
8. `score` — evaluation score (e.g. `4.2/5`)
9. `rate` — agreed or proposed rate
10. `next_followup` — ISO date for next follow-up
11. `report` — link to the evaluation report

**Status rules:**
- Move to `contacted` only after a real message is sent.
- `won` = contract signed or work started.
- `lost` = poster went silent after 2+ follow-ups, or explicitly declined.
- `dropped` = you declined (low score, red flags, etc.).

## sources.yml structure

```yaml
title_filter:
  - "looking for"
  - "need a developer"
  - "need a designer"
  - "need a"

content_filter:
  - "budget"
  - "paid"
  - "rate"

location_filter:
  - "remote"
  - ""

budget_filter:
  min_hourly: 20
  min_project: 200

subreddits:
  - name: forhire
    search_queries:
      - "[Hiring]"
      - "looking for a developer"
  - name: jobbit
    search_queries:
      - "[Hiring]"
  - name: hiring
    search_queries:
      - "freelance"
      - "contract"

gig_boards:
  - provider: remoteok
    tags:
      - dev
      - frontend
      - backend
  - provider: workingnomads
    categories:
      - programming
```

## Updating gig-ops

```bash
node update-system.mjs
```

Output: `{ "status": "up-to-date" }` or `{ "status": "update-available", "local": "0.1.0", "remote": "0.2.0" }`.

Only System Layer files are updated. Your `config/profile.yml`, `sources.yml`, `data/leads.md`, and `reports/` are never touched.

## Error handling

**Common failure modes:**

- `sources.yml` not found → run onboarding, copy from `templates/sources.example.yml`
- `config/profile.yml` not found → run onboarding
- Reddit 429 rate limit → wait 60s, `scan.mjs` backs off automatically
- Gig URL 404 → mark `dropped` in tracker, run `node scan.mjs --rediscover-404` to prune inbox

---

## Technical notes

- All scripts are plain ESM JavaScript (`*.mjs`). No build step.
- 4 runtime deps: `playwright`, `js-yaml`, `dotenv`, `@google/generative-ai` (optional, for Gemini eval).
- `data/leads.db` is a derived SQLite index. Safe to delete — rebuilt by `node tracker.mjs sync`.
- Providers only fetch and normalize. All filtering is in `scan.mjs`.
- `providers/_types.js` is documentation-only JSDoc. Plain ESM imports don't evaluate it.

## Language / Locale

Default language is **English**. An optional Spanish locale pack (`modes/es/`) can be enabled by setting `locale: es` in `config/profile.yml`. Other locales can be added as `modes/{lang}/` directories following the same structure.

---

@CLAUDE.md is generated from this file. When editing agent instructions, edit `AGENTS.md` (the source of truth), then the CLI-specific wrappers (`CLAUDE.md`, `OPENCODE.md`) will be updated automatically.
