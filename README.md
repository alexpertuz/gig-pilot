# gig-ops

[English](README.md) | [Español](README.es.md)

**AI-powered freelance pipeline.** Aggregates on-demand and collaboration postings, evaluates them for fit and legitimacy, generates tailored proposals, and tracks your outreach — all from your terminal.

No database. No server. No subscription. Git is the sync layer.

---

## What it does

1. **Scans** Reddit (`r/forhire`, `r/jobbit`, etc.), RemoteOK, WorkingNomads, and other sources for freelance postings
2. **Evaluates** each gig across 6 scoring blocks: Fit, Budget Realism, Scope Clarity, Poster Legitimacy, Channel, and Timing
3. **Flags** unpaid collab traps, equity-only offers, scope creep, and low-legitimacy accounts automatically
4. **Generates** short, channel-aware proposals/DMs — not generic cover letters
5. **Tracks** your outreach in `data/leads.md` with status, rate, and follow-up dates
6. **Follows up** on cadence (DMs go cold fast — 3-day default vs. the 7-day email cadence)

---

## Quickstart

```bash
# 1. Install as a Claude Code plugin
# In Claude Code: /plugins install (or add this directory as a local plugin)

# 2. Copy config files
cp config/profile.example.yml config/profile.yml
cp templates/sources.example.yml sources.yml

# 3. Edit your profile (services, rate card, archetypes)
# editor config/profile.yml

# 4. Run the doctor
node doctor.mjs

# 5. Scan for gigs
node scan.mjs

# 6. Evaluate a gig
# In Claude Code: /gig https://reddit.com/r/forhire/comments/...
```

---

## Modes (slash-commands)

| Command | What it does |
|---------|-------------|
| `/gig <url>` | Evaluate a gig posting — scores fit, budget, scope, legitimacy |
| `/proposal` | Generate a tailored DM or email proposal |
| `/pipeline` | Work through the pipeline inbox |
| `/scan` | Trigger a source scan |
| `/tracker` | View and manage your leads tracker |
| `/followup` | Check follow-up cadence, generate follow-up drafts |
| `/patterns` | Analyze your win/loss patterns over time |
| `/deep <url>` | Deep-dive research on a poster or company |

---

## The scoring system

Every gig gets scored 1–5 across 6 blocks. `≥ 4.0` = GO. `3.0–3.9` = NEGOTIATE. `< 3.0` = DECLINE.

**Block B (Budget Realism) = 1 is always a hard DECLINE** — no proposal generated.

Common hard-decline triggers:
- "unpaid" / "for your portfolio" / "for exposure"
- "equity only" or "revenue share as payment"
- Budget below your walk-away rate

See `modes/_shared.md` for the full rubric.

---

## File structure

```
config/
  profile.yml         ← your identity, services, rate card (User Layer)
  profile.example.yml ← template
sources.yml           ← your gig sources config (User Layer)
data/
  leads.md            ← your outreach tracker (User Layer)
  pipeline.md         ← URL inbox
  scan-history.tsv    ← dedup history
reports/              ← your gig evaluation reports (User Layer)
providers/            ← gig source plugins (System Layer)
modes/                ← AI prompt modes (System Layer)
```

User Layer files are **never auto-updated**. See `DATA_CONTRACT.md`.

---

## Sources

| Provider | Source | Auth |
|----------|--------|------|
| `reddit` | Reddit subreddits via RSS feed | None |
| `remoteok` | RemoteOK.com API | None |
| `workingnomads` | WorkingNomads.com API | None |

More providers can be added in `providers/*.mjs` — see `providers/_types.js` for the contract.

For higher Reddit volume, set `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` in `.env` (script app from reddit.com/prefs/apps).

---

## Language / Locale

Default is **English**. Set `locale: es` in `config/profile.yml` to enable Spanish modes (`modes/es/`).

---

## Fork origin

gig-ops is a focused fork of [career-ops](https://github.com/santifer/career-ops) v1.12.0, repurposed from job search to freelance sourcing. The provider plugin system, scanning architecture, dedup engine, and pipeline loop are inherited from that project.
