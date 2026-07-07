import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

function Settings() {
  const [h, setH] = useState<{ claude: boolean; version: string | null; repoRoot: string } | null>(
    null,
  );

  useEffect(() => {
    api.health().then(setH);
  }, []);

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <div className="card" style={{ maxWidth: 560 }}>
        <h3 style={{ marginTop: 0 }}>Claude Code bridge</h3>
        <p className="hint">
          Status:{' '}
          {h ? (
            h.claude ? (
              <span style={{ color: 'var(--go)' }}>connected · {h.version}</span>
            ) : (
              <span style={{ color: 'var(--danger)' }}>claude CLI not found on PATH</span>
            )
          ) : (
            '…'
          )}
        </p>
        <p className="hint">
          Repo root: <span className="mono">{h?.repoRoot}</span>
        </p>
        <p className="hint">
          Set <span className="mono">GIGOPS_CLAUDE_BIN</span> to override the claude binary path, or{' '}
          <span className="mono">GIGOPS_ROOT</span> / <span className="mono">PORT</span> for the
          server.
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/settings')({ component: Settings });
