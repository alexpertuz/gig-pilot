# Mode: /tracker — Leads Tracker

Read, display, and manage `data/leads.md`.

## Tracker format

`data/leads.md` is a tab-separated table with these columns:

```
num  date        source      poster        gig                    channel  status       score   rate    next_followup  report
001  2026-06-23  r/forhire   u/some_user   React dashboard SaaS   dm       contacted    4.2/5   $80/hr  2026-06-26     [001](reports/001-react-dashboard-2026-06-23.md)
```

**Columns:**
1. `num` — zero-padded 3-digit lead number
2. `date` — ISO date first seen / evaluated
3. `source` — where it came from (`r/forhire`, `remoteok`, etc.)
4. `poster` — Reddit handle or poster name
5. `gig` — short title (max 40 chars)
6. `channel` — `dm` | `email` | `comment` | `apply`
7. `status` — `new` | `contacted` | `replied` | `negotiating` | `won` | `lost` | `dropped`
8. `score` — evaluation score (e.g. `4.2/5`)
9. `rate` — agreed or proposed rate (e.g. `$80/hr`, `$500 fixed`, or `-`)
10. `next_followup` — ISO date for next follow-up (or `-`)
11. `report` — markdown link to the evaluation report

## Commands

`/tracker` — show the full tracker table grouped by status

`/tracker stats` — show counts by status + win rate

`/tracker {status}` — filter by status (e.g. `/tracker contacted`)

`/tracker update {num} {status}` — update a lead's status

`/tracker rate {num} {rate}` — record a rate (e.g. `/tracker rate 001 $80/hr`)

`/tracker followup {num} {date}` — set next follow-up date

## Display format

Group by status in this order: `negotiating` → `replied` → `contacted` → `new` → `won` → `lost` → `dropped`

Show counts per group. Highlight leads where `next_followup` is today or overdue.

## Status rules

- Move to `contacted` only after a real message is sent (not just drafted)
- `won` = contract signed or first invoice sent
- `lost` = no reply after 2+ follow-ups spaced 3+ days apart, or explicit decline
- `dropped` = you declined (low score, red flags, changed mind)

## Sync to SQLite

After any update, run: `node tracker.mjs sync`

This rebuilds `data/leads.db` from `data/leads.md` — safe to run anytime.
