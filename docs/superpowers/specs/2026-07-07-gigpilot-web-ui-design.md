# GigPilot Web UI — Design Spec

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan
**Stack:** React + Vite + TanStack Router (web) · Express (Node ESM, server)

## Goal

Give gig-ops a premium web UI so everything currently done from the terminal (scan, evaluate,
propose, track, edit config) can be done through a browser — lowering the technical barrier —
**without changing the underlying infrastructure**: the flat markdown/YAML files stay the source
of truth, the existing `.mjs` scripts stay the workhorses, and AI modes still run through Claude
Code (never the Claude API).

## Non-goals (v1)

Cut from v1 and tracked in the project memory `gig-ops-webui-deferred`:

- Intent-file job queue (v1 uses headless `claude -p` + SSE instead)
- Multi-user / auth (local single-user only)
- CV / LaTeX / PDF generation subsystem
- `/deep` web-search mode as a full flow (action stub only)
- The existing Go TUI (`dashboard/`) is left untouched — this is a parallel front-end

## Cardinal Rule (inherited from AGENTS.md / DATA_CONTRACT.md)

**Never auto-mutate User Layer files.** User Layer = `config/profile.yml`, `sources.yml`,
`data/leads.md`, `data/pipeline.md`, `reports/*`. The server writes these **only** in response to
an explicit user action in the UI, and always via atomic write (temp file + rename) so the files
stay human-editable and diff-friendly. System Layer files (`modes/*`, `providers/*`, `*.mjs`) are
never written by the UI.

## Architecture

```
apps/
  server/                Express (Node ESM) — the ONLY layer that touches flat files + CLI
    index.mjs            app bootstrap, static-serve built web in prod
    routes/
      pipeline.mjs       GET/POST/PATCH pipeline inbox
      leads.mjs          GET leads (via tracker.mjs query --json)
      reports.mjs        GET list + GET one rendered report
      profile.mjs        GET/PUT profile.yml
      sources.mjs        GET/PUT sources.yml
      scan.mjs           POST run scan (streamed)
      modes.mjs          POST run a mode, GET SSE stream
      stats.mjs          GET funnel/dashboard aggregates
    lib/
      files.mjs          parse/serialize pipeline.md, profile.yml, sources.yml; atomic writes
      cli.mjs            spawn scan.mjs / tracker.mjs / analyze-patterns.mjs; parse output
      claude.mjs         the bridge: spawn `claude -p`, stream stdout as SSE; single-job queue
      paths.mjs          resolve repo-root paths (REPO_ROOT), claude binary path from settings
  web/                   React + Vite + TanStack Router
    src/
      routes/            file-based routes (dashboard, pipeline, leads, reports, scan, sources, profile, settings)
      components/        PipelineBoard, LeadsTable, ReportView, AIConsole (drawer), Sidebar, StatCard, ...
      lib/api.ts         typed fetch client
      lib/useSSE.ts      SSE hook for streaming mode output
      lib/theme.css      centralized design tokens (dark command-center)
```

The server is a **thin adapter, never a second source of truth**. Every read parses the same flat
files the CLI reads; every mutating write goes to those same files; every AI action shells out to
the same modes. No database (the existing `data/leads.db` SQLite index remains a derived artifact
owned by `tracker.mjs`, not by the UI).

Local-only, single-user, no auth. Server binds to `127.0.0.1`.

## The Claude bridge (`lib/claude.mjs`)

This is the heart of "keep the connection with Claude Code, no API."

- `POST /api/modes/run` with `{ mode: "gig"|"proposal"|"patterns"|..., args: {...} }`
  → constructs a slash-command prompt (e.g. `/gig <url>`) and spawns
  `claude -p "<prompt>" --output-format stream-json --verbose` with `cwd = REPO_ROOT`.
  Returns `{ jobId }`.
- `GET /api/modes/stream/:jobId` (SSE) streams parsed stdout events to the browser; the AI console
  drawer renders assistant text live with a streaming cursor.
- Modes write their own artifacts (reports to `reports/`, tracker rows via `tracker.mjs`) exactly
  as they do from the terminal. **We reimplement zero mode logic** — Claude Code does the thinking.
- On job completion the server emits a `done` event with `{ status, changedResources: [...] }`; the
  UI refetches the affected resource (e.g. reports list, a lead row) so the result appears.
- **Concurrency:** one mode job runs at a time; further requests queue (FIFO) to avoid two Claude
  runs clobbering the same files. Job state kept in-memory: `Map<jobId, {proc, status, buffer, mode}>`.
- **Failure modes:** non-zero exit, `claude` not on PATH, timeout → structured error event; UI shows
  a toast and the drawer shows the captured stderr tail.
- The `claude` binary path is configurable in Settings (defaults to `claude` on PATH); verified once
  at server start (`claude --version`) and surfaced in Settings health.

## Data contracts

### pipeline.md
Line format under `## Pending`: `- [ ] {url} | {status?} | {title}`.
`files.mjs` parses to `{ url, status, title, checked }[]` and serializes back, preserving the file
header and any non-pending sections. Add-URL and status-change are the only write paths.

### leads
Read-only from the UI's perspective via `node tracker.mjs query --json [--status --limit ...]`.
Lead rows are created/updated by the modes (through `tracker.mjs`), not by direct UI file writes.
If `data/leads.md` doesn't exist yet, the Leads page shows an empty state (tracker returns a
"no source of truth" error, which the adapter maps to `[]`).

### reports/*.md
`GET /api/reports` lists files (num, slug, date parsed from filename); `GET /api/reports/:file`
returns raw markdown, rendered client-side. Read-only.

### profile.yml / sources.yml
Parsed with `js-yaml` (already a dep). The UI edits a form; on save the server re-serializes and
atomically writes. Round-trip must preserve structure; comments may be lost (documented trade-off) —
so the raw-YAML editor is offered as an escape hatch in each page.

## Pages / navigation

| Page | Backs onto | Primary actions |
|------|-----------|-----------------|
| Dashboard | leads + pipeline + scan-history | funnel stats, recent activity, run-scan CTA, Patterns panel |
| Pipeline | `data/pipeline.md` | kanban of inbox URLs; add URL; **Evaluate** → AI drawer runs `/gig` |
| Leads | `tracker.mjs query --json` | sortable table, status chips, row→report, **Generate proposal** → drawer |
| Reports | `reports/*.md` | list + rendered markdown viewer |
| Scan | `scan.mjs` | choose sources, run scan (streamed), new gigs land in Pipeline |
| Sources | `sources.yml` | form editor for filters/subreddits/boards (+ raw YAML escape hatch) |
| Profile | `config/profile.yml` | form editor for identity/services/rate card/ideal-gig (+ raw YAML) |
| Settings | app-level | locale, repo paths, claude binary path, health checks |

`/followup`, `/patterns`, `/deep`, `/agent-inbox` are **in-page actions**, not nav items:
patterns → Dashboard panel; followups → Leads filter/action; agent-inbox → Pipeline/Leads triage
action; deep → action stub on a lead/report. Keeps the sidebar to the funnel.

Primary layout: **pipeline-first with a slide-out AI console drawer** (right side) that streams
Claude output whenever a mode runs.

## Design language

Dark command-center matching the reference mockup:

- Background `#0F172A`, panels `#1E293B`, borders subtle slate.
- Accent: teal/emerald for active/go states; amber for warnings/red-flags; blue for primary CTA.
- Type: Geist (UI) + Geist Mono (data/commands/scores).
- Dark-only (matches the mock); tokens centralized in `theme.css` so a light theme is possible later.
- Premium micro-interactions (per `emil-design-eng`): drawer spring-slide, streaming-token cursor,
  optimistic status-chip transitions, card hover-lift, skeleton loaders, subtle focus rings.

## Error handling

CLI/adapter errors return structured JSON `{ error: { code, message, hint } }` mirroring the CLI's
own failure modes (Reddit 429 → "wait 60s"; missing `profile.yml`/`sources.yml` → "run onboarding";
gig URL 404 → suggest reconcile). The UI renders these as toasts and inline empty/error states.

## Testing

- **Vitest (server lib):** pipeline.md ↔ object round-trip; sources.yml/profile.yml form↔YAML
  round-trip; `cli.mjs` parses real captured `tracker.mjs`/`scan.mjs` output; `claude.mjs` bridge
  with a mocked spawn (asserts prompt construction, SSE event shape, single-job queue, error path).
- **Frontend:** kept thin; verified by driving the running app (the `verify` skill) rather than
  heavy component tests.

## Build & run

- `apps/web` dev: Vite dev server proxying `/api` → Express.
- Prod: `vite build` → Express static-serves `apps/web/dist` and the API on one port.
- New root scripts: `npm run ui:dev`, `npm run ui:build`, `npm run ui` (serve built).
- Server deps added: `express` (and `cors`/`compression` if needed). Web deps: react, react-dom,
  @tanstack/react-router, vite, and styling utilities. No change to existing runtime deps.
