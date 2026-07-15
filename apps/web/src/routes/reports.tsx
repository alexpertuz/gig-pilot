import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ReportView } from '../components/ReportPanel';

type ReportMeta = { file: string; num: string | null; slug: string | null; date: string | null };

function niceSlug(slug: string | null, file: string): string {
  const s = slug || file.replace(/\.md$/, '');
  return s.replace(/-/g, ' ');
}

function Reports() {
  const navigate = useNavigate();
  const { file: selected } = Route.useSearch();
  const [list, setList] = useState<ReportMeta[]>([]);

  useEffect(() => {
    api.reports().then((r) => {
      setList(r.reports);
      if (!selected && r.reports[0]) {
        navigate({ to: '/reports', search: { file: r.reports[0].file }, replace: true });
      }
    });
  }, []);

  if (!list.length)
    return (
      <div className="empty">
        No reports yet. Evaluate a gig from the <strong>Pipeline</strong> to generate your first report.
      </div>
    );

  return (
    <div className="split">
      <div className="split-list">
        {list.map((r) => (
          <button
            key={r.file}
            className={`list-item ${selected === r.file ? 'active' : ''}`}
            onClick={() => navigate({ to: '/reports', search: { file: r.file } })}
          >
            <span className="mono">{r.num}</span> {niceSlug(r.slug, r.file)}
            <div className="list-sub">{r.date}</div>
          </button>
        ))}
      </div>
      <div className="split-body card">{selected && <ReportView file={selected} />}</div>
    </div>
  );
}

export const Route = createFileRoute('/reports')({
  validateSearch: (search: Record<string, unknown>): { file?: string } =>
    typeof search.file === 'string' ? { file: search.file } : {},
  component: () => (
    <div>
      <h1 className="page-title">Reports</h1>
      <p className="page-subtitle">
        Every gig evaluation you've run, in one archive. Reports also open inline from the Pipeline and Today views.
      </p>
      <Reports />
    </div>
  ),
});
