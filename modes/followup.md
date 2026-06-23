# Mode: /followup — Follow-up Cadence

Track follow-up cadence for active leads. Flag overdue follow-ups and generate tailored follow-up DMs/emails.

> **Read `voice-dna.md` if present.** Apply it to every generated draft — conversational, no filler phrases.

## Inputs

- `data/leads.md` — leads tracker
- `data/follow-ups.md` — follow-up history (created on first use)
- `reports/` — evaluation reports (for context in drafts)
- `config/profile.yml` — your identity and services

## Step 1 — Run cadence script

```bash
node followup-cadence.mjs
```

Parse the JSON output (per-lead: status, days since contacted, follow-up count, urgency, next follow-up date).

If no actionable leads: "No active leads to follow up on. Evaluate some gigs with `/gig` and contact them first."

## Step 2 — Display dashboard

Show leads sorted by urgency (urgent > overdue > waiting > cold):

```
Follow-up Dashboard — {date}
{N} leads tracked, {N} actionable

| # | Gig | Poster | Status | Days | Follow-ups | Next | Urgency |
```

Visual indicators:
- **URGENT** — poster replied, respond within 24 hours
- **OVERDUE** — follow-up date has passed
- **waiting (X days)** — on track
- **COLD** — 2+ follow-ups sent with no reply, suggest closing

## Step 3 — Generate drafts

For each **overdue** or **urgent** lead:

1. Read linked report for gig context
2. Read `config/profile.yml` for your services and proof points

### DM follow-up (first follow-up, count == 0)

2–3 sentences. Casual tone — this is Reddit DM.

Structure:
1. Reference the specific gig (not "I sent a message before")
2. New angle or short value-add (proof point, question about scope)
3. Soft CTA

**NEVER use:**
- "just checking in"
- "just following up"
- "touching base"
- "circling back"

**Example:**
> Hey — sent you a DM about the React dashboard gig last week. Wanted to add: I've got a Figma-to-React workflow that cuts implementation time in half if you already have designs. Still interested?

### Email follow-up

3–4 sentences. Include subject line.

### Second follow-up (count == 1)

Shorter. New angle — don't repeat the first message.

### Third+ follow-up (count >= 2)

Do NOT generate another follow-up. Instead:
> "This lead has had {N} follow-ups with no response. Consider marking it `lost` or trying a different contact method."

## Cadence rules

| Status | First follow-up | Subsequent | Max |
|--------|----------------|------------|-----|
| contacted | 3 days | Every 3 days | 2 total |
| replied | Same day (respond ASAP) | Every 2 days | no limit |
| negotiating | Same day | Every 1–2 days | no limit |

DMs go cold faster than email — 3 days is the right window, not 7.

## Step 4 — Record sent follow-ups

After the user confirms they sent a message, append to `data/follow-ups.md`:

```markdown
| # | Lead# | Date | Gig | Poster | Channel | Notes |
|---|-------|------|-----|--------|---------|-------|
```

Only record follow-ups the user confirms were actually sent.

Update `data/leads.md` → `next_followup` column to the next scheduled date.

## Step 5 — Summary

```
Follow-up Dashboard ({date})
- {N} leads tracked
- {N} overdue — drafts above
- {N} urgent — respond today
- {N} waiting
- {N} cold — consider closing

Review the drafts and confirm which ones you've sent.
```
