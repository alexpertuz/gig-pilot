@AGENTS.md
<!--
CLAUDE.md — Claude Code specific overrides and context.
The canonical instructions live in AGENTS.md (imported above).
Only add Claude Code-specific notes here.
-->

## Claude Code specifics

- Modes are invoked as `/gig`, `/proposal`, `/pipeline`, etc. via the Claude Code plugin skill mechanism.
- Use `Bash(node:*)` for all utility scripts.
- Never use Playwright for Reddit sourcing — the Reddit JSON API is sufficient and free.
- When evaluating a gig, always read `config/profile.yml` and `modes/_shared.md` first for the scoring rules.
- When a scan finds new gigs, report the count and add them to `data/pipeline.md` without evaluating automatically unless `/auto-pipeline` is running.
- Default output language: **English**. Only switch to Spanish if `locale: es` is set in `config/profile.yml`.

## Permissions

Declared in `.claude-plugin/plugin.json`. The plugin pre-approves:
- `Bash(node:*)` — all Node.js scripts
- `WebFetch(domain:www.reddit.com)` — Reddit public JSON API
- `WebFetch(domain:remoteok.com)` — RemoteOK API
- `WebFetch(domain:workingnomads.com)` — WorkingNomads API
- `WebSearch` — for deep-dive research mode
