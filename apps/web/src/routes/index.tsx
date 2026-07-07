import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { StatCard } from '../components/StatCard';
import { openMode } from '../lib/aiConsole';

function Dashboard() {
  const [s, setS] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.stats().then(setS);
  }, []);

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <div className="grid-4">
        <StatCard label="In pipeline" value={s?.pipeline.total ?? '—'} accent="var(--primary)" />
        <StatCard label="Unevaluated" value={s?.pipeline.unevaluated ?? '—'} accent="var(--warn)" />
        <StatCard label="Total leads" value={s?.leads.total ?? '—'} accent="var(--accent)" />
        <StatCard label="Won" value={s?.leads.byStatus?.won ?? 0} accent="var(--go)" />
      </div>
      <div className="row" style={{ marginTop: 24 }}>
        <button className="btn btn-primary" onClick={() => navigate({ to: '/scan' })}>
          Run a scan
        </button>
        <button className="btn" onClick={() => openMode('patterns', {})}>
          Analyze win/loss patterns
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/')({ component: Dashboard });
