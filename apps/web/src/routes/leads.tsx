import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { openMode } from '../lib/aiConsole';
import { StatusChip } from '../components/StatusChip';

function Leads() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .leads()
      .then((r) => setRows(r.leads))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="skeleton" style={{ height: 200 }} />;
  if (!rows.length)
    return <div className="empty">No leads yet. Evaluate gigs from the Pipeline to create leads.</div>;

  const cols = Object.keys(rows[0]).filter((k) => k.toLowerCase() !== 'notes');
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tbl">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>
                  {/status/i.test(c) ? <StatusChip status={row[c]} /> : String(row[c] ?? '')}
                </td>
              ))}
              <td>
                <button
                  className="btn"
                  onClick={() =>
                    openMode('proposal', { report: row.report || row.Report || row.num || row['#'] })
                  }
                >
                  Proposal
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Route = createFileRoute('/leads')({
  component: () => (
    <div>
      <h1 className="page-title">Leads</h1>
      <Leads />
    </div>
  ),
});
