# Data Contract

This document defines which files belong to the **system** (auto-updatable) and which belong to the **user** (never touched by updates).

## User Layer (NEVER auto-updated)

These files contain your personal data, customizations, and work product. Updates will NEVER modify them.

| File | Purpose |
|------|---------|
| `config/profile.yml` | Your identity, services, rate card, ideal-gig profile |
| `modes/_profile.md` | Your service archetypes, narrative, negotiation scripts |
| `voice-dna.md` | Your writing voice guardrail — banned words, anti-AI-slop rules, tone (optional) |
| `article-digest.md` | Your proof points from portfolio |
| `sources.yml` | Your customized gig sources list |
| `data/leads.md` | Your lead outreach tracker (source of truth) |
| `data/leads.db` | Derived query index over `leads.md` (SQLite, rebuilt by `node tracker.mjs sync` — safe to delete) |
| `data/pipeline.md` | Your URL inbox |
| `data/scan-history.tsv` | Your scan history |
| `data/follow-ups.md` | Your follow-up history |
| `writing-samples/*` | Your personal writing samples for style calibration (except `writing-samples/README.md`, which is system-owned) |
| `reports/*` | Your gig evaluation reports |
| `output/*` | Your generated PDFs |
| `gigs/*` | Your saved gig descriptions |

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File | Purpose |
|------|---------|
| `modes/_shared.md` | Scoring system, global rules, tools |
| `modes/gig.md` | Gig evaluation mode instructions |
| `modes/proposal.md` | Proposal/DM generation instructions |
| `modes/pdf.md` | PDF generation instructions |
| `modes/scan.md` | Source scanner instructions |
| `modes/batch.md` | Batch processing instructions |
| `modes/auto-pipeline.md` | Auto-pipeline instructions |
| `modes/deep.md` | Research prompt instructions |
| `modes/pipeline.md` | Pipeline processing instructions |
| `modes/tracker.md` | Tracker instructions |
| `modes/patterns.md` | Pattern analysis instructions |
| `modes/followup.md` | Follow-up cadence instructions |
| `modes/es/*` | Spanish language modes (opt-in locale pack) |
| `CLAUDE.md` | Agent instructions (Claude Code) |
| `OPENCODE.md` | Agent instructions (OpenCode) |
| `GEMINI.md` | Legacy no-op context guard |
| `AGENTS.md` | Canonical agent instructions (imported by CLI-specific wrappers) |
| `*.mjs` | Utility scripts |
| `batch/batch-prompt.md` | Batch worker prompt |
| `batch/batch-runner.sh` | Batch orchestrator |
| `dashboard/*` | Go TUI dashboard |
| `templates/*` | Base templates |
| `.claude/skills/*` | Skill definitions (Claude Code) |
| `.opencode/skills/*` | Skill definitions (OpenCode) |
| `docs/*` | Documentation |
| `VERSION` | Current version number |
| `DATA_CONTRACT.md` | This file |
| `writing-samples/README.md` | System-owned onboarding documentation for the writing-samples directory |

## The Rule

**If a file is in the User Layer, no update process may read, modify, or delete it.**

**If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.**
