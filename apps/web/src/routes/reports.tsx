import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Markdown } from '../components/Markdown';

function Reports() {
  const [list, setList] = useState<any[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [md, setMd] = useState('');

  useEffect(() => {
    api.reports().then((r) => {
      setList(r.reports);
      if (r.reports[0]) setSel(r.reports[0].file);
    });
  }, []);

  useEffect(() => {
    if (sel) api.report(sel).then((r) => setMd(r.markdown));
  }, [sel]);

  return (
    <div className="split">
      <div className="split-list">
        {list.map((r) => (
          <button
            key={r.file}
            className={`list-item ${sel === r.file ? 'active' : ''}`}
            onClick={() => setSel(r.file)}
          >
            <span className="mono">{r.num}</span> {r.slug}
            <div className="list-sub">{r.date}</div>
          </button>
        ))}
        {!list.length && <div className="empty">No reports yet.</div>}
      </div>
      <div className="split-body card">
        <Markdown text={md} />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/reports')({
  component: () => (
    <div>
      <h1 className="page-title">Reports</h1>
      <Reports />
    </div>
  ),
});
