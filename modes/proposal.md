# Mode: /proposal — Generate a Proposal or DM

Generate a tailored, short outreach message for a gig that scored GO or NEGOTIATE.

**Always read `config/profile.yml`** before generating — it provides services, proof points, voice, and rate card.

---

## Input

The user provides one of:
- A report number: `/proposal 007` — loads `reports/007-*.md`
- A URL or raw gig text (evaluate inline if no report exists yet)
- Just `/proposal` — uses the most recent GO/NEGOTIATE report

---

## Channel detection

Read the gig post to determine the channel:

| Channel | Signal | Format |
|---------|--------|--------|
| `dm` | Reddit post, no email mentioned | Short DM (3–5 sentences) |
| `email` | Email address in post | Short email (3–4 short paragraphs) |
| `comment` | Post asks to reply in comments | Very short comment (2–3 sentences) |
| `apply` | Link to external form | Tailored cover paragraph (1–2 paragraphs) |

Default to `dm` if unclear.

Override with: `/proposal --channel email`

---

## DM format (default)

Target: **3–5 sentences**. No headers. No bullet lists. Conversational.

Structure:
1. **Hook** — one sentence that proves you read the post (reference the specific problem or stack)
2. **Proof** — one proof point from `profile.yml → narrative.proof_points` that maps to this gig
3. **Proposal** — your specific take on how you'd approach it (1 sentence)
4. **Rate + CTA** — your rate and a single low-friction next step

Do NOT include:
- "I hope this message finds you well"
- "I am very interested in this opportunity"
- Generic skills lists
- Your full bio
- Anything that sounds like a cover letter

**Voice rules** (from `config/profile.yml → narrative`):
- Confident, not desperate
- Specific, not generic
- Short sentences
- First person, active voice

---

## Email format

Target: **3–4 short paragraphs**. Subject line required.

Subject line formula: `[gig title] — [your name]` or `Re: [post title]`

Structure:
1. **Para 1 (2–3 sentences):** What you do + why you're a fit for this specific gig
2. **Para 2 (2–3 sentences):** Most relevant proof point with metric
3. **Para 3 (1–2 sentences):** Proposed approach or question that shows thinking
4. **Para 4 (1 sentence):** Rate + CTA

---

## Comment format

Target: **2–3 sentences max**.

Structure:
1. Relevant proof or differentiator (1 sentence)
2. Rate or availability signal (1 sentence)
3. CTA (1 sentence)

---

## Rate inclusion

Always include your rate unless:
- The gig explicitly says "include your rate in the proposal" (then always include)
- The gig is on a platform where rates are set via the platform (then omit)

Pull rate from the report's "Suggested Rate" field if available, else from `profile.yml → rate_card`.

---

## Output

Print the proposal directly in chat. Do NOT write to a file automatically.

After printing:
```
Channel: {channel}
Length: {word count} words
Rate included: {yes/no}

Save as draft? (y/n) — saves to output/proposals/{num}-{slug}-draft.md
```

---

## Examples

**DM for a React dashboard gig ($80/hr):**

> Saw your post about the SaaS dashboard rebuild — I've done this exact scope twice, most recently cutting a client's load time 60% and bumping trial-to-paid 18%.
>
> My approach: audit the current component tree first (usually finds 80% of the gains), then ship in 2-week chunks so you have something shippable after week 1.
>
> Happy to jump on a 15-min call to scope it out. My rate is $80/hr. When works for you?

---

**DM for an unpaid/equity gig (after a NEGOTIATE score with conditions):**

> Saw your expense-splitting app post. The problem is real and the core logic sounds solid.
>
> I work paid engagements only, but I can do a fixed-price design pass at $X — you get a Figma file you own, no strings. If the project takes off and you want ongoing work, we can talk then.
>
> Interested?

---

## What NOT to write

Never write proposals for DECLINE-scored gigs without explicitly confirming with the user first.

If asked to write a proposal for a gig with Block B = 1 (hard stop):
> "This gig scored DECLINE due to [reason]. Writing a proposal for an unpaid/equity-only gig isn't recommended. Want me to draft a counter-proposal that reframes it as a paid engagement instead?"
