# GigPilot Web UI

A premium web front-end for gig-ops. Everything you can do from the terminal —
scan sources, evaluate gigs, generate proposals, track leads, edit config — is
available in the browser, while the flat files stay the source of truth and AI
modes still run through **Claude Code** (no Claude API).

## Layout

```
apps/
  server/   Express (Node ESM). The ONLY layer that touches flat files + CLI scripts.
  web/      React + Vite + TanStack Router front-end.
```

## Running

From the repo root:

```bash
# Dev: Vite (web) on :5273 proxying /api → Express on :4317, both with reload
npm run ui:dev

# Build the web app for production
npm run ui:build

# Production: single Express process serves the built app + API on :4317
npm run ui

# Server unit tests (file/CLI/claude-bridge adapters)
npm run ui:test
```

Then open http://localhost:5273 (dev) or http://127.0.0.1:4317 (prod).

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `4317` | Express port |
| `GIGOPS_ROOT` | repo root (auto) | Override the gig-ops repo location |
| `GIGOPS_CLAUDE_BIN` | `claude` | Path to the Claude Code CLI |
| `NODE_ENV` | — | Set to `production` to static-serve `apps/web/dist` |

## AI actions require Claude Code

Clicking **Evaluate** (`/gig`), **Generate proposal** (`/proposal`), or **Analyze
patterns** (`/patterns`) spawns `claude -p "<slash-command>"` in the repo and streams
the output to the AI console drawer. This requires the `claude` CLI installed and
logged in. Check **Settings** for a live health indicator. Only one AI job runs at a
time; additional requests queue.

## The Cardinal Rule

The server writes User Layer files (`config/profile.yml`, `sources.yml`,
`data/pipeline.md`, `data/leads.md`, `reports/*`) **only** in response to an explicit
user action (adding a URL, saving config), always via atomic write (temp file +
rename). It never auto-mutates them. The AI modes manage their own artifacts (reports,
tracker rows) exactly as they do from the terminal. The server is a thin adapter, not a
second source of truth.
