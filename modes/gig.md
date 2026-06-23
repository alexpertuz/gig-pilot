# Mode: /gig — Evaluate a Gig Posting

Evaluate a gig posting and produce a scored report.

**Always start by reading `config/profile.yml`** to load the rate card and archetypes.
**Then read `modes/_shared.md`** to load the scoring rubric.

---

## Input

The user provides one of:
- A URL (Reddit post, RemoteOK listing, gig board link, etc.)
- Raw post text pasted directly
- A mix of both

---

## Step 1 — Liveness gate (URL input only)

Before evaluating, verify the URL is live:

1. Fetch the URL. If it returns 404/410/gone: report "Gig expired — URL returned {status}. No evaluation." Log to `data/scan-history.tsv` as `expired`. Stop.
2. If uncertain (timeout, redirect, partial load): note "Liveness inconclusive — evaluating from cached/pasted content if available."
3. If live: proceed.

**Never use Playwright for this.** A simple fetch is sufficient and faster.

---

## Step 2 — Extract gig content

Read the full post text. Extract:
- **Title** — what the poster is looking for
- **Poster** — username or handle
- **Source** — where it came from (subreddit, board name, etc.)
- **Budget/rate** — any compensation signal (exact quote preferred)
- **Scope** — what needs to be built/delivered
- **Timeline** — any deadline or duration mentioned
- **Contact method** — how to respond (DM, email, form, etc.)
- **Poster signals** — account age, karma, post history (for Reddit sources)

If any field is absent from the post, note it as "not specified" — do not invent it.

---

## Step 3 — Score (6 blocks, A–F)

Apply the scoring rubric from `modes/_shared.md` to each block.

For each block write:
- The numeric score (X.X)
- A 1–2 sentence explanation citing specific text from the post

Calculate the weighted total:
- A (25%) + B (25%) + C (20%) + D (15%) + E (10%) + F (5%)

---

## Step 4 — Identify red flags

Scan the post text for:

**Automatic hard-decline phrases:**
- "unpaid", "for your portfolio", "equity only", "revenue share as payment"
- "for exposure", "for your testimonial", "no budget but great opportunity"
- "I can't pay but…"

**Scope creep phrases (flag but don't auto-decline):**
- "simple", "quick", "just", "MVP", "ASAP", "urgent"
- "and also…", "while you're at it…"
- "we can figure out the rest later"

**Legitimacy red flags:**
- New account (< 30 days) posting a hiring request
- No post history or all posts are hiring requests
- Copy-paste template language
- "test task before we discuss payment"

List every flag found with the exact quote from the post.

---

## Step 5 — Write the report

Reserve a report number: `node reserve-report-num.mjs`

Write `reports/{num}-{slug}-{date}.md` following the report format in `modes/_shared.md`.

The **slug** is a 3–5 word kebab-case summary of the gig (e.g. `react-dashboard-saas-startup`).

After writing the report, output a summary to the user:

```
✅ Report saved: reports/{num}-{slug}-{date}.md

Score: {X.X}/5 — {GO / NEGOTIATE / DECLINE}
Budget: {budget or "not specified"}
Suggested rate: {your estimate}
Red flags: {count} ({brief list if any})

Next: run /proposal to draft outreach, or /pipeline to continue the inbox.
```

---

## Step 6 — Tracker update (optional, ask user)

Ask: "Add this to leads tracker? (y/n)"

If yes:
```bash
node tracker.mjs add --gig "{title}" --poster "{poster}" --source "{source}" --score {score} --status new --report {num}
```

---

## Examples of correct scoring

**Example: unpaid collab post (your screenshot case)**
> "Busco Ux/Ul para colaborar en un proyecto personal, MVP al 100%... La lógica y el código ya están, pero necesito darle amor al diseño..."
> No mention of compensation.

- Block B: 1 (hard stop — zero compensation signal, post implies unpaid collaboration for portfolio)
- Decision: **DECLINE**
- Red flag: "colaborar en un proyecto personal" + no rate/budget mentioned anywhere

**Example: well-scoped paid gig**
> "[Hiring] React developer for SaaS dashboard — $80/hr, ~20 hours, design in Figma, kickoff next Monday"

- Block A: 5 (exact stack match)
- Block B: 5 (at target rate, hourly model)
- Block C: 5 (scope clear, design ready, timeline set)
- Block D: 4 (check account but post is detailed)
- Block E: 4 (DM only but fine for Reddit)
- Block F: 5 (concrete timeline)
- Decision: **GO**
