import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { streamPost } from '../lib/useSSE';
import { api } from '../lib/api';

function Scan() {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  const run = () => {
    setLog([]);
    setRunning(true);
    setCount(null);
    streamPost('/api/scan', { args: [] }, (e) => {
      if (e.type === 'line' || e.type === 'stderr') setLog((l) => [...l, String(e.data)]);
      if (e.type === 'done') {
        setRunning(false);
        api.pipeline().then((r) => setCount(r.items.length));
      }
    });
  };

  return (
    <div>
      <h1 className="page-title">Scan sources</h1>
      <div className="row">
        <button className="btn btn-primary" onClick={run} disabled={running}>
          {running ? 'Scanning…' : 'Run scan'}
        </button>
        {count !== null && (
          <span style={{ color: 'var(--accent)' }}>Pipeline now has {count} gigs.</span>
        )}
      </div>
      <pre className="scan-log mono">{log.join('\n')}</pre>
    </div>
  );
}

export const Route = createFileRoute('/scan')({ component: Scan });
