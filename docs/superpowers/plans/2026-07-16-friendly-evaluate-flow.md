# Friendly Gig-Evaluation Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the global `AIConsole` sidepane so a `/gig` evaluation reads like the scan flow — friendly loading with contextual phrases, then a completion state that shows the score and the report inline — instead of a raw JSON-stream dump.

**Architecture:** Extract the non-React logic (phrase advancement, report-path resolution) into a pure `.mjs` module with `.d.mts` types, following the existing `pipelineBuckets.mjs` pattern, and unit-test it with `node --test`. Then rewrite `aiConsole.tsx`: extend its store with phase/report/error state and a client-side phrase timer, and render three states (running / complete / error) reusing the scan page's visual vocabulary, with the raw stream tucked under a collapsible "Technical details". Add supporting `ai-*` CSS. No server changes.

**Tech Stack:** React 19 + TanStack Router, plain ESM `.mjs` helpers, `node --test` for unit tests, Vite/`tsc` for build+typecheck.

## Global Constraints

- Default output language is **English**; all user-facing copy in English.
- Pure logic lives in `.mjs` with a colocated `.d.mts` type declaration and a `.test.mjs` run via `node --test` (existing pattern: `apps/web/src/components/pipelineBuckets.*`).
- Reuse existing components/classes rather than duplicating: `ReportView` (`apps/web/src/components/ReportPanel.tsx`), and scan CSS tokens `scan-spinner` / `scan-progress` / `scan-progress.indeterminate` / `scan-eyebrow` (`apps/web/src/components/ui.css`).
- The done event's ok status is the string `'done'` (server sets `status = code === 0 ? 'done' : 'error'` in `apps/server/lib/claude.mjs`).
- Report resolution only applies to `mode === 'gig'`; proposal/patterns modes get the generic loading + a simple "Done" completion.
- Respect the existing `prefers-reduced-motion` block already in `ui.css` (no new always-on animations that ignore it).

---

### Task 1: Pure helpers — phrase advancement and report resolution

**Files:**
- Create: `apps/web/src/lib/evalConsole.mjs`
- Create: `apps/web/src/lib/evalConsole.d.mts`
- Test: `apps/web/src/lib/evalConsole.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `EVAL_PHASES: string[]` — 7 curated gig-evaluation phrases, in order.
  - `nextPhaseIndex(current: number, total: number): number` — returns `min(current + 1, total - 1)`; never wraps.
  - `resolveReportFile(items: Array<{ url: string; report?: string | null } | null | undefined>, url: string | null): string | null` — finds the item whose `url` matches, returns its `report` with a leading `reports/` stripped, or `null`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/evalConsole.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { EVAL_PHASES, nextPhaseIndex, resolveReportFile } from './evalConsole.mjs';

test('EVAL_PHASES is a non-empty ordered list ending with the report phrase', () => {
  assert.ok(EVAL_PHASES.length >= 5);
  assert.equal(EVAL_PHASES[0], 'Reading the posting…');
  assert.equal(EVAL_PHASES[EVAL_PHASES.length - 1], 'Writing your report…');
});

test('nextPhaseIndex advances by one', () => {
  assert.equal(nextPhaseIndex(0, EVAL_PHASES.length), 1);
  assert.equal(nextPhaseIndex(2, EVAL_PHASES.length), 3);
});

test('nextPhaseIndex caps at the last index and does not wrap', () => {
  const last = EVAL_PHASES.length - 1;
  assert.equal(nextPhaseIndex(last - 1, EVAL_PHASES.length), last);
  assert.equal(nextPhaseIndex(last, EVAL_PHASES.length), last);
});

test('resolveReportFile returns the stripped path for a matching url', () => {
  const items = [{ url: 'https://x/1', report: 'reports/007-foo-2026-07-16.md' }];
  assert.equal(resolveReportFile(items, 'https://x/1'), '007-foo-2026-07-16.md');
});

test('resolveReportFile keeps an already-stripped path unchanged', () => {
  const items = [{ url: 'https://x/1', report: '007-foo.md' }];
  assert.equal(resolveReportFile(items, 'https://x/1'), '007-foo.md');
});

test('resolveReportFile returns null when the url is absent', () => {
  const items = [{ url: 'https://x/1', report: 'reports/007-foo.md' }];
  assert.equal(resolveReportFile(items, 'https://x/2'), null);
});

test('resolveReportFile returns null when the item has no report', () => {
  const items = [{ url: 'https://x/1', report: null }];
  assert.equal(resolveReportFile(items, 'https://x/1'), null);
});

test('resolveReportFile tolerates empty or invalid inputs', () => {
  assert.equal(resolveReportFile(null, 'https://x/1'), null);
  assert.equal(resolveReportFile([], null), null);
  assert.equal(resolveReportFile([null, undefined], 'https://x/1'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test apps/web/src/lib/evalConsole.test.mjs`
Expected: FAIL — cannot find module `./evalConsole.mjs`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/evalConsole.mjs`:

```js
// Pure, framework-free helpers for the AI Console evaluation flow.
// Kept in .mjs so they are unit-testable with `node --test`, mirroring
// the pattern in apps/web/src/components/pipelineBuckets.mjs.

export const EVAL_PHASES = [
  'Reading the posting…',
  'Sizing up the budget…',
  'Checking scope & deliverables…',
  'Vetting the poster…',
  'Scanning for red flags…',
  'Scoring fit across the board…',
  'Writing your report…',
];

// Advance the phrase index, holding on the last phrase (never wraps).
export function nextPhaseIndex(current, total) {
  return Math.min(current + 1, total - 1);
}

// Find the pipeline item for `url` and return its report path without the
// leading `reports/` prefix, or null when there is no match or no report.
export function resolveReportFile(items, url) {
  if (!Array.isArray(items) || !url) return null;
  const match = items.find((it) => it && it.url === url);
  const report = match && match.report;
  if (!report) return null;
  return String(report).replace(/^reports\//, '');
}
```

Create `apps/web/src/lib/evalConsole.d.mts`:

```ts
export const EVAL_PHASES: string[];
export function nextPhaseIndex(current: number, total: number): number;
export function resolveReportFile(
  items: Array<{ url: string; report?: string | null } | null | undefined> | null | undefined,
  url: string | null,
): string | null;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test apps/web/src/lib/evalConsole.test.mjs`
Expected: PASS — all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/evalConsole.mjs apps/web/src/lib/evalConsole.d.mts apps/web/src/lib/evalConsole.test.mjs
git commit -m "feat(web): pure helpers for the evaluation console flow"
```

---

### Task 2: Rewrite the AI Console sidepane (store + three states + styles)

**Files:**
- Modify: `apps/web/src/lib/aiConsole.tsx` (full rewrite of the store and component)
- Modify: `apps/web/src/components/ui.css:733-740` (replace the old `.ai-head`/`.ai-body`/`.ai-foot`/`.cursor` block with `ai-*` state styles)

**Interfaces:**
- Consumes (from Task 1): `EVAL_PHASES`, `nextPhaseIndex`, `resolveReportFile` from `./evalConsole.mjs`.
- Consumes (existing): `api.runMode`, `api.pipeline` (`./api`); `streamGet` (`./useSSE`); `ReportView` (`../components/ReportPanel`); `Link` (`@tanstack/react-router`).
- Produces (unchanged public API): `openMode(mode: string, args: any, opts?: { onDone?: (s: string) => void }): Promise<void>`, `closeConsole(): void`, `useAIConsole()`, `AIConsole()`. Existing callers in `PipelineBoard.tsx`, `routes/index.tsx`, `routes/leads.tsx` keep working without changes.

- [ ] **Step 1: Rewrite `aiConsole.tsx`**

Replace the entire contents of `apps/web/src/lib/aiConsole.tsx` with:

```tsx
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Link } from '@tanstack/react-router';
import { api } from './api';
import { streamGet } from './useSSE';
import { EVAL_PHASES, nextPhaseIndex, resolveReportFile } from './evalConsole.mjs';
import { ReportView } from '../components/ReportPanel';

type State = {
  open: boolean;
  running: boolean;
  mode: string | null;
  url: string | null;
  args: any;
  text: string;
  status: string | null;
  phaseIndex: number;
  reportFile: string | null;
  error: string | null;
};

let state: State = {
  open: false, running: false, mode: null, url: null, args: null,
  text: '', status: null, phaseIndex: 0, reportFile: null, error: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let onDoneCb: ((s: string) => void) | undefined;
// The agent stream emits complete assistant messages as `text` events and then a
// final `result` event that repeats the last message. Only fall back to `result`
// when nothing streamed, so the final answer isn't shown twice.
let streamedText = false;

let phaseTimer: ReturnType<typeof setInterval> | null = null;
function startPhaseTimer() {
  stopPhaseTimer();
  phaseTimer = setInterval(() => {
    set({ phaseIndex: nextPhaseIndex(state.phaseIndex, EVAL_PHASES.length) });
  }, 2800);
}
function stopPhaseTimer() {
  if (phaseTimer) { clearInterval(phaseTimer); phaseTimer = null; }
}

async function resolveReport(url: string | null) {
  if (!url) return;
  try {
    const { items } = await api.pipeline();
    set({ reportFile: resolveReportFile(items, url) });
  } catch {
    // Leave reportFile null; the "Open full report" link still points at /reports.
  }
}

export async function openMode(mode: string, args: any, opts?: { onDone?: (s: string) => void }) {
  onDoneCb = opts?.onDone;
  streamedText = false;
  set({
    open: true, running: true, mode, url: args?.url ?? null, args,
    text: '', status: 'starting', phaseIndex: 0, reportFile: null, error: null,
  });
  startPhaseTimer();
  try {
    const { jobId } = await api.runMode(mode, args);
    streamGet(
      `/api/modes/stream/${jobId}`,
      (e) => {
        if (e.type === 'text') {
          streamedText = true;
          set({ text: state.text + e.data });
        } else if (e.type === 'result') {
          if (!streamedText) set({ text: state.text + e.data });
        } else if (e.type === 'status') set({ status: e.data });
        else if (e.type === 'stderr') set({ text: state.text + `\n[stderr] ${e.data}` });
        else if (e.type === 'done') {
          stopPhaseTimer();
          const ok = e.data.status === 'done';
          set({ running: false, status: e.data.status, error: ok ? null : "The evaluation couldn't finish." });
          if (ok && mode === 'gig') void resolveReport(args?.url ?? null);
          onDoneCb?.(e.data.status);
        }
      },
      (err) => {
        stopPhaseTimer();
        set({ running: false, status: 'error', error: "The evaluation couldn't finish.", text: state.text + `\n[stream error] ${err.message}` });
      },
    );
  } catch (err: any) {
    stopPhaseTimer();
    set({ running: false, status: 'error', error: "The evaluation couldn't finish.", text: `${String(err?.message || err)}` });
  }
}

export function closeConsole() {
  stopPhaseTimer();
  set({ open: false });
}

export function useAIConsole() {
  return useSyncExternalStore(subscribe, () => state);
}

function modeLabel(mode: string | null): string {
  if (mode === 'gig') return 'Gig evaluation';
  if (mode === 'proposal') return 'Proposal';
  if (mode === 'patterns') return 'Patterns';
  if (mode === 'deep') return 'Deep research';
  return mode ? `/${mode}` : 'AI Console';
}

function runningLabel(mode: string | null, phaseIndex: number): string {
  if (mode === 'gig') return EVAL_PHASES[Math.min(phaseIndex, EVAL_PHASES.length - 1)];
  if (mode === 'proposal') return 'Drafting your proposal…';
  if (mode === 'patterns') return 'Analyzing your win/loss patterns…';
  return 'Working…';
}

function lineCount(text: string): number {
  return text ? text.split('\n').length : 0;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 12.5 3.2 3.2L17.5 8.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8v5m0 3.5v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function RunningState({ label, isGig }: { label: string; isGig: boolean }) {
  return (
    <div className="ai-state ai-running" aria-live="polite">
      <div className="ai-state-icon"><span className="scan-spinner" aria-hidden="true" /></div>
      <h2 className="ai-phase">{label}</h2>
      <p className="ai-sub">{isGig ? 'This usually takes a moment — you can keep working.' : 'Working on it…'}</p>
      <div className="scan-progress indeterminate"><span /></div>
    </div>
  );
}

function CompleteState({ mode, reportFile }: { mode: string | null; reportFile: string | null }) {
  if (mode === 'gig') {
    return (
      <div className="ai-state ai-complete">
        <div className="ai-state-icon ai-ok"><CheckIcon /></div>
        <h2>Evaluation complete</h2>
        <p className="ai-sub">Here's how this gig scored.</p>
        <div className="ai-report">
          {reportFile
            ? <ReportView file={reportFile} />
            : <p className="ai-sub">Your report was saved. Open the Reports archive to read it.</p>}
        </div>
        <div className="ai-actions">
          <Link
            className="btn btn-primary btn-sm"
            to="/reports"
            search={reportFile ? { file: reportFile } : {}}
            onClick={closeConsole}
          >
            Open full report
          </Link>
          <button className="btn btn-sm btn-ghost" onClick={closeConsole}>Close</button>
        </div>
      </div>
    );
  }
  return (
    <div className="ai-state ai-complete">
      <div className="ai-state-icon ai-ok"><CheckIcon /></div>
      <h2>Done</h2>
      <div className="ai-actions"><button className="btn btn-sm" onClick={closeConsole}>Close</button></div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="ai-state ai-error">
      <div className="ai-state-icon ai-bad"><AlertIcon /></div>
      <h2>The evaluation couldn't finish</h2>
      <p className="ai-sub">Nothing was saved. Check the technical details below, then try again.</p>
      <div className="ai-actions">
        <button className="btn btn-primary btn-sm" onClick={onRetry}>Retry</button>
        <button className="btn btn-sm btn-ghost" onClick={closeConsole}>Close</button>
      </div>
    </div>
  );
}

export function AIConsole() {
  const s = useAIConsole();
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [s.text]);

  const lines = lineCount(s.text);

  return (
    <aside className={`ai-console ${s.open ? 'open' : ''}`}>
      <header className="ai-head">
        <span className="scan-eyebrow">{modeLabel(s.mode)}</span>
        <button className="btn btn-sm btn-ghost" onClick={closeConsole} aria-label="Close console">✕</button>
      </header>

      <div className="ai-console-body">
        {s.running ? (
          <RunningState label={runningLabel(s.mode, s.phaseIndex)} isGig={s.mode === 'gig'} />
        ) : s.error ? (
          <ErrorState onRetry={() => s.mode && openMode(s.mode, s.args)} />
        ) : (
          <CompleteState mode={s.mode} reportFile={s.reportFile} />
        )}

        <details className="ai-tech" open={Boolean(s.error)}>
          <summary>
            <span>Technical details</span>
            <span>{lines} {lines === 1 ? 'line' : 'lines'}</span>
          </summary>
          <div className="ai-log mono" ref={logRef} role="log">
            {s.text || 'No output yet.'}
          </div>
        </details>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Replace the old console styles in `ui.css`**

In `apps/web/src/components/ui.css`, replace the block currently at lines 733-740 (the `.ai-head, .ai-foot` rule through the `@keyframes blink` rule) with:

```css
.ai-head {
  padding: 13px 18px; border-bottom: 1px solid var(--border);
  display: flex; justify-content: space-between; align-items: center;
  color: var(--muted); font-size: 12.5px;
}
.ai-console-body { flex: 1; overflow: auto; display: flex; flex-direction: column; }

.ai-state { padding: 30px 26px 22px; text-align: center; }
.ai-state-icon {
  width: 46px; height: 46px; margin: 0 auto 14px;
  display: grid; place-items: center; border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.ai-state-icon svg {
  width: 24px; height: 24px; fill: none; stroke: var(--accent);
  stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
}
.ai-state-icon.ai-ok { background: color-mix(in srgb, var(--go) 12%, transparent); }
.ai-state-icon.ai-ok svg { stroke: var(--go); }
.ai-state-icon.ai-bad { background: color-mix(in srgb, var(--danger) 12%, transparent); }
.ai-state-icon.ai-bad svg { stroke: var(--danger); }

.ai-state h2, .ai-phase { font-size: 16px; margin: 0 0 4px; }
.ai-sub { color: var(--muted); font-size: 13px; margin: 0 0 16px; }
.ai-running .scan-progress { max-width: 220px; margin: 4px auto 0; }

.ai-report {
  text-align: left; margin-top: 6px;
  border-top: 1px solid var(--border); padding-top: 16px;
}
.ai-actions { display: flex; gap: 8px; justify-content: center; margin-top: 18px; }

.ai-tech { margin-top: auto; border-top: 1px solid var(--border); }
.ai-tech > summary {
  padding: 12px 18px; cursor: pointer; list-style: none;
  display: flex; justify-content: space-between; color: var(--muted); font-size: 12px;
}
.ai-tech > summary::-webkit-details-marker { display: none; }
.ai-log {
  padding: 0 18px 18px; white-space: pre-wrap; font-size: 12px; line-height: 1.6;
  color: var(--muted); max-height: 40dvh; overflow: auto;
}
```

- [ ] **Step 3: Typecheck and build the web app**

Run: `npm --prefix apps/web run build`
Expected: PASS — `tsr generate && tsc -b && vite build` completes with no type errors. (`tsc -b` fails the build if `openMode`'s public signature drifted or the `Link` `search` prop is mistyped.)

- [ ] **Step 4: Manually verify the flow**

Start the app (`npm run ui:dev`, or the repo's dev orchestrator) and, in the Pipeline:
1. Click **Evaluate** on an unscored gig. Confirm the pane shows the spinner, an eyebrow "Gig evaluation", a cycling phrase that advances and then holds on "Writing your report…", and an indeterminate progress bar.
2. On finish, confirm the pane switches to "Evaluation complete" with the score/verdict pill and the report rendered inline, plus **Open full report** (navigates to `/reports?file=…`) and **Close**.
3. Expand **Technical details** and confirm the raw stream is present and scrolls.
4. Confirm a non-gig mode (e.g. the **/patterns** button on the Today page) shows the generic running label and a simple "Done" completion with no report.

Use the `verify` skill / `run` skill to drive the app if available.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/aiConsole.tsx apps/web/src/components/ui.css
git commit -m "feat(web): friendly evaluation flow in the AI console sidepane"
```

---

## Self-Review

**Spec coverage:**
- Store fields (`url`, `args`, `phaseIndex`, `reportFile`, `error`) → Task 2, Step 1. ✓
- Timed curated phrases capped at last → Task 1 (`EVAL_PHASES`, `nextPhaseIndex`) + Task 2 timer. ✓
- Report resolution via pipeline lookup, null fallback → Task 1 (`resolveReportFile`) + Task 2 `resolveReport`. ✓
- Three pane states (running / complete-with-inline-report+link / error-with-retry) → Task 2 components. ✓
- Collapsible Technical details with raw stream, expanded on error → Task 2 `.ai-tech`. ✓
- Non-gig modes keep working with generic loading + simple Done → Task 2 `runningLabel` / `CompleteState`. ✓
- Reuse scan vocabulary + `ReportView` → Task 2 imports and CSS. ✓
- Unit tests for the two pure helpers → Task 1. ✓
- No server changes → confirmed; only `apps/web` files touched. ✓

**Deviation from spec (intentional):** the spec mentioned reusing `scoreOf` from `ReportPanel` for a header pill. The cleaner realization embeds `ReportView`, which already renders the `score/verdict` pill (`.report-head`) at the top of the report body — so no `scoreOf` export and no duplicate markdown fetch are needed. The "hero score" still appears directly under "Evaluation complete".

**Placeholder scan:** none — all steps contain complete code/commands.

**Type consistency:** `openMode(mode, args, opts?)` signature preserved for existing callers; `resolveReportFile`/`nextPhaseIndex`/`EVAL_PHASES` names match between Task 1 (`.mjs` + `.d.mts` + tests) and Task 2 consumption.
