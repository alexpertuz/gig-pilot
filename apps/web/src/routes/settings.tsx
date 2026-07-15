import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api, getAgentProvider, Health, setAgentProvider } from '../lib/api';

function Settings() {
  const [h, setH] = useState<Health | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  useEffect(() => {
    api.health().then((health) => {
      setH(health);
      setSelectedProvider(getAgentProvider() || health.activeProvider);
    });
  }, []);

  const selectProvider = (provider: string) => {
    setAgentProvider(provider);
    setSelectedProvider(provider);
  };

  const selected = selectedProvider ? h?.providers[selectedProvider] : null;

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <div className="card" style={{ maxWidth: 560 }}>
        <h3 style={{ marginTop: 0 }}>Agent bridge</h3>
        <p className="hint">
          Status:{' '}
          {h ? (
            selected?.connected ? (
              <span style={{ color: 'var(--go)' }}>
                connected · {selected.version} ({selected.label})
              </span>
            ) : (
              <span style={{ color: 'var(--danger)' }}>
                {selected?.label ?? 'selected provider'} CLI not found on PATH
              </span>
            )
          ) : (
            '…'
          )}
        </p>
        <p className="hint">
          Repo root: <span className="mono">{h?.repoRoot}</span>
        </p>
        {h && (
          <div className="tabs" style={{ marginTop: 18 }}>
            {Object.values(h.providers).map((provider) => (
              <button
                key={provider.id}
                className={`tab ${selectedProvider === provider.id ? 'active' : ''}`}
                onClick={() => selectProvider(provider.id)}
                type="button"
              >
                {provider.label}
              </button>
            ))}
          </div>
        )}
        {h && (
          <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
            {Object.values(h.providers).map((provider) => (
              <p className="hint" key={provider.id} style={{ margin: 0 }}>
                <span className="mono">{provider.id}</span>:{' '}
                {provider.connected ? (
                  <span style={{ color: 'var(--go)' }}>{provider.version}</span>
                ) : (
                  <span style={{ color: 'var(--danger)' }}>not connected</span>
                )}{' '}
                <span className="mono">({provider.bin})</span>
              </p>
            ))}
          </div>
        )}
        <p className="hint">
          Set <span className="mono">GIGOPS_AGENT_PROVIDER</span> to choose the server default,{' '}
          <span className="mono">GIGOPS_CLAUDE_BIN</span> /{' '}
          <span className="mono">GIGOPS_CODEX_BIN</span> to override CLI paths, or{' '}
          <span className="mono">GIGOPS_ROOT</span> / <span className="mono">PORT</span> for the server.
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/settings')({ component: Settings });
