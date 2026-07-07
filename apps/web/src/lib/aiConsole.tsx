import { useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from './api';
import { streamGet } from './useSSE';

type State = {
  open: boolean;
  running: boolean;
  mode: string | null;
  text: string;
  status: string | null;
};

let state: State = { open: false, running: false, mode: null, text: '', status: null };
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

export async function openMode(mode: string, args: any, opts?: { onDone?: (s: string) => void }) {
  onDoneCb = opts?.onDone;
  set({ open: true, running: true, mode, text: '', status: 'starting' });
  try {
    const { jobId } = await api.runMode(mode, args);
    streamGet(`/api/modes/stream/${jobId}`, (e) => {
      if (e.type === 'text' || e.type === 'result') set({ text: state.text + e.data });
      else if (e.type === 'status') set({ status: e.data });
      else if (e.type === 'stderr') set({ text: state.text + `\n[stderr] ${e.data}` });
      else if (e.type === 'done') {
        set({ running: false, status: e.data.status });
        onDoneCb?.(e.data.status);
      }
    });
  } catch (err: any) {
    set({ running: false, status: 'error', text: String(err?.message || err) });
  }
}

export function closeConsole() {
  set({ open: false });
}

export function useAIConsole() {
  return useSyncExternalStore(subscribe, () => state);
}

export function AIConsole() {
  const s = useAIConsole();
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight);
  }, [s.text]);
  return (
    <aside className={`ai-console ${s.open ? 'open' : ''}`}>
      <header className="ai-head">
        <span className="mono">AI CONSOLE {s.mode ? `· /${s.mode}` : ''}</span>
        <button className="btn" onClick={closeConsole}>
          ✕
        </button>
      </header>
      <div className="ai-body mono" ref={bodyRef}>
        {s.text}
        {s.running && <span className="cursor">▋</span>}
      </div>
      <footer className="ai-foot">
        {s.running ? `running… (${s.status ?? ''})` : s.status ? `done · ${s.status}` : 'idle'}
      </footer>
    </aside>
  );
}
