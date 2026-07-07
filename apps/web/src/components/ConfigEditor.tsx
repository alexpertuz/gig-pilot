import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function ConfigEditor({ name }: { name: string }) {
  const [raw, setRaw] = useState('');
  const [data, setData] = useState<any>({});
  const [tab, setTab] = useState<'form' | 'raw'>('form');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.config(name).then((r) => {
      setRaw(r.raw);
      setData(r.data || {});
    });
  }, [name]);

  const scalars = Object.entries(data).filter(([, v]) => typeof v !== 'object' || v === null);

  const save = async () => {
    setError(null);
    try {
      if (tab === 'raw') await api.saveConfig(name, { raw });
      else await api.saveConfig(name, { data });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      const r = await api.config(name);
      setRaw(r.raw);
      setData(r.data || {});
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div>
      <div className="tabs">
        <button className={`tab ${tab === 'form' ? 'active' : ''}`} onClick={() => setTab('form')}>
          Form
        </button>
        <button className={`tab ${tab === 'raw' ? 'active' : ''}`} onClick={() => setTab('raw')}>
          Raw YAML
        </button>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={save}>
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {tab === 'form' ? (
        <div className="form">
          {scalars.map(([k, v]) => (
            <label key={k} className="field">
              <span>{k}</span>
              <input
                className="input"
                value={String(v ?? '')}
                onChange={(e) => setData({ ...data, [k]: e.target.value })}
              />
            </label>
          ))}
          <p className="hint">
            Nested fields (lists, objects) are edited in the <b>Raw YAML</b> tab.
          </p>
        </div>
      ) : (
        <textarea
          className="yaml"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  );
}
