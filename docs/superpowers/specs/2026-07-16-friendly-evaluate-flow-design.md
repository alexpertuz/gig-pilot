# Friendly gig-evaluation flow (redesign the AI Console sidepane)

**Date:** 2026-07-16
**Status:** Approved, ready for implementation planning

## Problem

Clicking **Evaluate** on a Pipeline row calls `openMode('gig', { url })`, which opens
the global `AIConsole` sidepane (`apps/web/src/lib/aiConsole.tsx`). Today the pane dumps
the raw agent JSON-stream text into a monospace `.ai-body` and shows a tiny footer
(`running… (status)`). When the run finishes the pane just sits there holding the raw
dump; the user has to notice that the row's button flipped to "Report" and click that.

This is unfriendly and unlike the polished **scan** experience the app already has
(`apps/web/src/routes/scan.tsx`): eyebrow + contextual heading, animated icon, progress,
plain-language copy, a results CTA, and raw output tucked under a collapsible
"Technical details".

## Goal

Make a `/gig` evaluation in the sidepane feel like the scan flow: a friendly loading
state with contextual phrases, then a completion state that surfaces the score/verdict
and the report itself, with the raw stream still available on demand.

## Scope

- **In scope:** the global `AIConsole` sidepane and its store in `aiConsole.tsx`, plus
  supporting styles in `apps/web/src/components/ui.css`.
- Proposal and patterns modes route through the same pane and keep working; they get the
  generic loading + simple "Done" completion (no report step).
- **Out of scope:** server changes. The gig stream stays unstructured; there are no
  server-emitted phases. No changes to `apps/server`.

## Non-goals

- No literal per-phase progress from the agent. Contextual phrases are client-side and
  decorative; copy must never assert a false state.
- No redesign of the Pipeline row, ReportDrawer, or Reports page beyond reusing their
  components.

## Design

### Store (`aiConsole.tsx`)

Extend `State` with the fields the friendly view needs:

- `mode: string | null` — existing
- `url: string | null` — the evaluated gig URL (from `openMode` args), used for report lookup
- `args: any` — retained so the error state can offer Retry with the same input
- `running: boolean`, `status: string | null` — existing
- `phaseIndex: number` — index into the curated phrase list
- `text: string` — raw stream (unchanged; now hidden behind Technical details)
- `reportFile: string | null` — resolved on done for gig mode
- `error: string | null` — friendly error string

Behavior:

- `openMode('gig', { url })` sets `url`/`args`, resets `phaseIndex` to 0, clears
  `reportFile`/`error`, and starts a `setInterval` (~2800ms) that advances `phaseIndex`,
  **capped at the last phrase** ("Writing your report…") which holds until `done`.
- The interval is cleared on the `done` event, on stream error, and on `closeConsole`.
- On `done` with an ok status **and** `mode === 'gig'`: call `api.pipeline()`, find the
  item whose `url` matches, read its `report`, strip the leading `reports/`, and set
  `reportFile`. If no match/report is found, leave `reportFile` null (completion still
  renders; the "Open full report" link points at `/reports`).
- On stream error / non-zero exit: set `error` to a friendly string and stop the timer.

### Pure, testable helpers

Extract logic that does not need React so it can be unit-tested directly:

- `EVAL_PHASES: string[]` — the curated phrase list.
- `nextPhaseIndex(current: number, total: number): number` — increments but caps at
  `total - 1` (never wraps).
- `resolveReportFile(items, url): string | null` — finds the pipeline item for `url` and
  returns its report path with the `reports/` prefix stripped, or null.

### The three pane states

Reuse the scan visual vocabulary (classes/tokens already in `ui.css`: `scan-spinner`,
`scan-eyebrow`, `scan-progress`/`.indeterminate`, metric/summary patterns) adapted under
`ai-*` classes so the sidepane keeps its own width/placement.

1. **Running**
   - Animated icon (`scan-spinner`), eyebrow "Evaluating gig".
   - Current curated phrase as an `<h2>` with `aria-live="polite"`.
   - Indeterminate progress bar.
   - Subtext: "This usually takes a moment — you can keep working."
   - Curated phrases (in order): Reading the posting → Sizing up the budget →
     Checking scope & deliverables → Vetting the poster → Scanning for red flags →
     Scoring fit across the board → Writing your report.

2. **Complete**
   - Gig mode: check icon + "Evaluation complete"; a score/verdict pill parsed from the
     report markdown via the existing `scoreOf` helper (reused/exported from
     `ReportPanel`); the report rendered inline with the existing `ReportView`
     component; actions **Open full report** (`Link` to `/reports?file=<reportFile>`)
     and **Close**. If `reportFile` is null, show the completion copy without the inline
     report and link to `/reports`.
   - Non-gig modes: a simple "Done" completion (no report, no pill).

3. **Error**
   - Friendly message: "The evaluation couldn't finish."
   - **Retry** button re-invokes `openMode(mode, args)` with the same input.
   - Technical details expanded by default in this state.

Every state keeps a collapsible **Technical details** `<details>` containing the raw
mono stream (`s.text`), mirroring scan's log section. Auto-scroll of the raw body is
preserved.

### Styling

Add `ai-*` rules in `apps/web/src/components/ui.css` next to the existing `.ai-console`
block, reusing scan's design tokens and patterns. The pane remains a right-side
sidepane; only its contents change.

## Testing

- **Unit** (Vitest, colocated `.test` file next to the helpers):
  - `nextPhaseIndex` increments and caps at the last index; does not wrap.
  - `resolveReportFile` returns the stripped path for a matching url, null when the url
    is absent or the item has no report.
- **Manual:** run the web app, evaluate a real gig, and confirm the flow:
  running (phrases cycle, hold on the last) → complete (pill + inline report + working
  link) → and the error/Retry path (e.g. by simulating a failed stream).

## Trade-offs

- Timed phrases are decorative, not literal progress. Accepted because the gig stream has
  no phases; copy is written so it never claims a specific completed step.
- Report resolution depends on the agent having written the report file before `done`.
  This is the same signal the Pipeline row already uses to flip to "Report", so the two
  stay consistent; the null-fallback covers the race where it isn't ready yet.
