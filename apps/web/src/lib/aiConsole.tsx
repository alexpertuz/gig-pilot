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
