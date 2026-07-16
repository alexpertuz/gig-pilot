---
name: gig-pilot
description: AI freelance pipeline — evaluate gigs, draft proposals, scan sources, and track outreach
arguments: mode
user_invocable: true
user-invocable: true
argument-hint: "[gig | proposal | pipeline | auto-pipeline | batch | scan | tracker | followup | patterns | deep | agent-inbox | pdf | update]"
license: MIT
---

# gig-pilot — Router

Determine the requested mode from `$mode`. If the input is a gig URL or pasted
brief without a subcommand, use `auto-pipeline`. Otherwise, show the discovery
menu when no known mode is requested.

| Input | Mode |
|---|---|
| JD text or URL (no sub-command) | `auto-pipeline` |
| `gig` | `gig` |
| `proposal` | `proposal` |
| `pipeline` | `pipeline` |
| `batch` | `batch` |
| `scan` | `scan` |
| `tracker` | `tracker` |
| `followup` | `followup` |
| `patterns` | `patterns` |
| `deep` | `deep` |
| `agent-inbox` | `agent-inbox` |
| `pdf` | `pdf` |
| `update` | `update` |

## Discovery mode

```
gig-pilot — Freelance Pipeline

  /gig-pilot {brief or URL} → evaluate, report, and track a gig
  /gig-pilot gig            → evaluation only
  /gig-pilot proposal       → draft a tailored proposal for a go-rated gig
  /gig-pilot pipeline       → process URLs in data/pipeline.md
  /gig-pilot batch          → evaluate multiple gigs
  /gig-pilot scan           → discover gigs from configured sources
  /gig-pilot tracker        → manage outreach in data/leads.md
  /gig-pilot followup       → schedule or draft follow-ups
  /gig-pilot patterns       → analyze outcomes
  /gig-pilot deep           → research a poster or company
  /gig-pilot agent-inbox    → triage gigs pending a decision
  /gig-pilot pdf            → generate a CV PDF
  /gig-pilot update         → check for system updates
```

## Context loading

Read `modes/_shared.md` together with `modes/gig.md`,
`modes/auto-pipeline.md`, or `modes/batch.md` before running an evaluation.
For all other commands, read the corresponding `modes/{mode}.md`. Read
`config/profile.yml` only as required by the selected mode; never modify user
layer files automatically.
