import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const isScalar = (v: unknown) => v === null || v === undefined || typeof v !== 'object';

const isLeafArray = (v: unknown): v is unknown[] => Array.isArray(v) && v.every(isScalar);

const humanize = (key: string) =>
  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function setAtPath(obj: any, path: string[], value: unknown): any {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const base = Array.isArray(obj) ? [...obj] : { ...(obj ?? {}) };
  base[head] = setAtPath(obj ? obj[head] : undefined, rest, value);
  return base;
}

type OnChange = (path: string[], value: unknown) => void;

function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const commit = (text: string) => {
    const trimmed = text.trim();
    setDraft('');
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
  };

  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      remove(value.length - 1);
    }
  };

  return (
    <div className="tag-input">
      {value.map((tag, i) => (
        <span className="tag-chip" key={`${tag}-${i}`}>
          {tag}
          <button type="button" className="tag-chip-remove" onClick={() => remove(i)} aria-label={`Remove ${tag}`}>
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-input-field"
        value={draft}
        placeholder={value.length === 0 ? 'Type and press Enter…' : ''}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}

function Field({ label, value, path, onChange }: { label: string; value: unknown; path: string[]; onChange: OnChange }) {
  if (isLeafArray(value)) {
    return (
      <label className="field field-wide">
        <span>{label}</span>
        <TagInput
          value={(value as unknown[]).map((v) => String(v ?? '')).filter((v) => v.trim() !== '')}
          onChange={(next) => onChange(path, next)}
        />
      </label>
    );
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        value={String(value ?? '')}
        onChange={(e) => onChange(path, e.target.value)}
      />
    </label>
  );
}

function ComplexNote({ label, count }: { label: string; count: number }) {
  return (
    <div className="field field-wide">
      <span>{label}</span>
      <p className="hint">
        {count} item{count === 1 ? '' : 's'} — edit in the <b>Raw YAML</b> tab.
      </p>
    </div>
  );
}

function GroupBody({ value, path, onChange }: { value: Record<string, unknown>; path: string[]; onChange: OnChange }) {
  return (
    <div className="section-body">
      {Object.entries(value).map(([k, v]) => {
        const childPath = [...path, k];
        if (isPlainObject(v)) {
          return (
            <div key={k} className="subgroup">
              <span className="subgroup-title">{humanize(k)}</span>
              <GroupBody value={v} path={childPath} onChange={onChange} />
            </div>
          );
        }
        if (Array.isArray(v) && !isLeafArray(v)) {
          return <ComplexNote key={k} label={humanize(k)} count={v.length} />;
        }
        return <Field key={k} label={humanize(k)} value={v} path={childPath} onChange={onChange} />;
      })}
    </div>
  );
}

export function ConfigEditor({ name }: { name: string }) {
  const [raw, setRaw] = useState('');
  const [data, setData] = useState<any>({});
  const [tab, setTab] = useState<'form' | 'raw'>('form');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    api.config(name).then((r) => {
      setRaw(r.raw);
      setData(r.data || {});
      setActiveSection(null);
    });
  }, [name]);

  const updateField = (path: string[], value: unknown) => {
    setData((prev: any) => setAtPath(prev, path, value));
  };

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

  const entries = Object.entries(data);
  const plainEntries = entries.filter(([, v]) => isScalar(v) || isLeafArray(v));
  const groupEntries = entries.filter(([, v]) => isPlainObject(v));
  const listEntries = entries.filter(([, v]) => Array.isArray(v) && !isLeafArray(v));

  type SectionDef =
    | { key: string; label: string; count: number; kind: 'general' }
    | { key: string; label: string; count: number; kind: 'group'; value: Record<string, unknown> }
    | { key: string; label: string; count: number; kind: 'list' };

  const sections: SectionDef[] = [];
  if (plainEntries.length > 0) {
    sections.push({ key: '__general', label: 'General', count: plainEntries.length, kind: 'general' });
  }
  for (const [k, v] of groupEntries) {
    sections.push({ key: k, label: humanize(k), count: Object.keys(v as object).length, kind: 'group', value: v as Record<string, unknown> });
  }
  for (const [k, v] of listEntries) {
    sections.push({ key: k, label: humanize(k), count: (v as unknown[]).length, kind: 'list' });
  }

  const current = sections.find((s) => s.key === activeSection) ?? sections[0];

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
        <div className="config-layout">
          <nav className="config-nav">
            {sections.map((s) => (
              <button
                key={s.key}
                className={`config-nav-item ${current?.key === s.key ? 'active' : ''}`}
                onClick={() => setActiveSection(s.key)}
              >
                <span className="section-title-text">{s.label}</span>
                <span className="section-count">{s.count}</span>
              </button>
            ))}
          </nav>
          <div className="config-panel">
            {current && (
              <div className="config-panel-head">
                <span className="section-title-text">{current.label}</span>
                <span className="section-count">{current.count}</span>
              </div>
            )}
            {current?.kind === 'general' && (
              <div className="section-body">
                {plainEntries.map(([k, v]) => (
                  <Field key={k} label={humanize(k)} value={v} path={[k]} onChange={updateField} />
                ))}
              </div>
            )}
            {current?.kind === 'group' && (
              <GroupBody value={current.value} path={[current.key]} onChange={updateField} />
            )}
            {current?.kind === 'list' && (
              <p className="hint list-note">
                List of complex items — edit in the <b>Raw YAML</b> tab.
              </p>
            )}
          </div>
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
