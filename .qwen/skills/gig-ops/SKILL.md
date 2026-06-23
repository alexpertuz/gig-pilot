---
name: gig-ops
description: AI job search command center -- evaluate offers, generate CVs, scan portals, track applications
arguments: mode
user_invocable: true
user-invocable: true
argument-hint: "[scan | deep | pdf | latex | cover | gig | gigs | apply | batch | tracker | pipeline | contacto | training | project | interview-prep | interview | patterns | followup | update]"
license: MIT
---

# gig-ops -- Router

## Mode Routing

Determine the mode from `$mode`:

| Input | Mode |
|-------|------|
| (empty / no args) | `discovery` -- Show command menu |
| JD text or URL (no sub-command) | **`auto-pipeline`** |
| `gig` | `gig` |
| `gigs` | `gigs` |
| `contacto` | `contacto` |
| `deep` | `deep` |
| `interview-prep` | `interview-prep` |
| `interview` | `interview` |
| `pdf` | `pdf` |
| `latex` | `latex` |
| `training` | `training` |
| `project` | `project` |
| `tracker` | `tracker` |
| `pipeline` | `pipeline` |
| `apply` | `apply` |
| `scan` | `scan` |
| `batch` | `batch` |
| `patterns` | `patterns` |
| `followup` | `followup` |
| `update` | `update` |
| `cover` | `cover` |

**Auto-pipeline detection:** If `$mode` is not a known sub-command AND contains JD text (keywords: "responsibilities", "requirements", "qualifications", "about the role", "we're looking for", company name + role) or a URL to a JD, execute `auto-pipeline`.

If `$mode` is not a sub-command AND doesn't look like a JD, show discovery.

---

## Discovery Mode (no arguments)

Show this menu:

```
gig-ops -- Command Center

Available commands:
  /gig-ops {JD}      → AUTO-PIPELINE: evaluate + report + PDF + tracker (paste text or URL)
  /gig-ops pipeline  → Process pending URLs from inbox (data/pipeline.md)
  /gig-ops gig    → Evaluation only A-F (no auto PDF)
  /gig-ops gigs   → Compare and rank multiple offers
  /gig-ops contacto  → LinkedIn power move: find contacts + draft message
  /gig-ops deep      → Deep research prompt about company
  /gig-ops interview-prep → Generate company-specific interview prep doc
  /gig-ops interview    → Interactive profile/CV onboarding interview
  /gig-ops pdf       → PDF only, ATS-optimized CV
  /gig-ops latex     → Export CV as LaTeX/Overleaf .tex
  /gig-ops cover     → Cover letter: standalone JD paste or /gig-ops cover {slug}
  /gig-ops training  → Evaluate course/cert against North Star
  /gig-ops project   → Evaluate portfolio project idea
  /gig-ops tracker   → Application status overview
  /gig-ops apply     → Live application assistant (reads form + generates answers)
  /gig-ops scan      → Scan portals and discover new offers
  /gig-ops batch     → Batch processing with parallel workers
  /gig-ops patterns  → Analyze rejection patterns and improve targeting
  /gig-ops followup  → Follow-up cadence tracker: flag overdue, generate drafts
  /gig-ops update    → Update gig-ops system files with diff preview + compat check

Inbox: add URLs to data/pipeline.md → /gig-ops pipeline
Or paste a JD directly to run the full pipeline.
```

---

## Context Loading by Mode

After determining the mode, load the necessary files before executing:

### Modes that require `_shared.md` + their mode file:
Read `modes/_shared.md` + `modes/{mode}.md`

Applies to: `auto-pipeline`, `gig`, `gigs`, `pdf`, `contacto`, `apply`, `pipeline`, `scan`, `batch`

### Standalone modes (only their mode file):
Read `modes/{mode}.md`

Applies to: `tracker`, `deep`, `interview-prep`, `interview`, `latex`, `training`, `project`, `patterns`, `followup`, `cover`

### Modes delegated to subagent:
For `scan`, `apply` (with Playwright), and `pipeline` (3+ URLs): launch as Agent with the content of `_shared.md` + `modes/{mode}.md` injected into the subagent prompt.

```
Agent(
  subagent_type="general-purpose",
  prompt="[content of modes/_shared.md]\n\n[content of modes/{mode}.md]\n\n[invocation-specific data]",
  description="gig-ops {mode}"
)
```

Execute the instructions from the loaded mode file.
