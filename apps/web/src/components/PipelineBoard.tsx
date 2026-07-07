import { useEffect, useState } from 'react';
import { api, type PipelineItem } from '../lib/api';
import { openMode } from '../lib/aiConsole';
import { StatusChip } from './StatusChip';

function cleanTitle(t: string | null, url: string): string {
  if (!t) return url;
  return t.replace(/\\([[\]])/g, '$1').replace(/&amp;/g, '&').trim();
}

function shortPath(url: string): string {
  try {
    return new URL(url).pathname.slice(0, 42);
  } catch {
    return url.slice(0, 42);
  }
}

export function PipelineBoard() {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    api
      .pipeline()
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    reload();
  }, []);

  const add = async () => {
    if (!url) return;
    setError(null);
    try {
      await api.addUrl(url);
      setUrl('');
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const cols: Record<string, PipelineItem[]> = {
    'To evaluate': items.filter((i) => !i.checked),
    Evaluated: items.filter((i) => i.checked && !/go/i.test(i.status || '')),
    Go: items.filter((i) => /go/i.test(i.status || '')),
  };

  return (
    <div>
      <div className="row">
        <input
          className="input"
          placeholder="Paste a gig URL…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn btn-primary" onClick={add}>
          Add
        </button>
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {loading ? (
        <div className="skeleton" style={{ height: 120, marginTop: 16 }} />
      ) : (
        <div className="board">
          {Object.entries(cols).map(([name, list]) => (
            <div key={name} className="board-col">
              <h3 className="col-title">
                {name} <span className="mono">{list.length}</span>
              </h3>
              {list.map((it) => (
                <div key={it.url} className="card gig-card">
                  <div className="gig-title">{cleanTitle(it.title, it.url)}</div>
                  <a className="gig-url mono" href={it.url} target="_blank" rel="noreferrer">
                    {shortPath(it.url)}
                  </a>
                  <div className="gig-foot">
                    <StatusChip status={it.status} />
                    <button className="btn" onClick={() => openMode('gig', { url: it.url }, { onDone: reload })}>
                      Evaluate
                    </button>
                  </div>
                </div>
              ))}
              {!list.length && <div className="hint" style={{ padding: 8 }}>—</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
