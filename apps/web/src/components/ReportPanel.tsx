import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Markdown } from './Markdown';

const VERDICT_COLOR: Record<string, string> = {
  GO: 'var(--go)',
  NEGOTIATE: 'var(--warn)',
  DECLINE: 'var(--danger)',
};

function scoreOf(md: string): { score: string; verdict: string } | null {
  const m = md.match(/Score:\s*([\d.]+)\s*\/\s*5\s*(?:\|\s*(\w+))?/i);
  if (!m) return null;
  return { score: m[1], verdict: (m[2] || '').toUpperCase() };
}

export function ReportView({ file }: { file: string }) {
  const [md, setMd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMd(null);
    setError(null);
    api
      .report(file)
      .then((r) => setMd(r.markdown))
      .catch((e) => setError(e.message));
  }, [file]);

  if (error) return <p className="notice notice-error">{error}</p>;
  if (md === null)
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="skeleton" style={{ width: '60%' }} />
        <div className="skeleton" />
        <div className="skeleton" style={{ height: 120 }} />
      </div>
    );

  const meta = scoreOf(md);
  const color = meta?.verdict ? VERDICT_COLOR[meta.verdict] : 'var(--muted)';

  return (
    <div>
      {meta && (
        <div className="report-head">
          <span
            className="report-score"
            style={{ color, background: `color-mix(in srgb, ${color} 9%, transparent)` }}
          >
            {meta.score}/5{meta.verdict ? ` · ${meta.verdict}` : ''}
          </span>
        </div>
      )}
      <Markdown text={md} />
    </div>
  );
}

export function ReportDrawer({ file, onClose }: { file: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, onClose]);

  return (
    <>
      {file && <div className="drawer-scrim" onClick={onClose} />}
      <aside className={`report-drawer ${file ? 'open' : ''}`} aria-hidden={!file}>
        <div className="report-drawer-head">
          <span className="mono">{file}</span>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="report-drawer-body">{file && <ReportView file={file} />}</div>
      </aside>
    </>
  );
}
