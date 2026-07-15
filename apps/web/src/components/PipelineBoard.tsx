import { useEffect, useMemo, useState } from 'react';
import { api, type PipelineItem } from '../lib/api';
import { openMode } from '../lib/aiConsole';
import { formatPostedAt, sourceIdentity, type SourceFamily } from './pipelineMeta.mjs';
import { partitionPipelineItems } from './pipelineBuckets.mjs';
import { ReportDrawer } from './ReportPanel';

const PASS_STATUSES = new Set(['dropped', 'passed', 'declined']);

function cleanTitle(t: string | null, url: string): string {
  if (!t) return url;
  return t
    .replace(/\\([[\]])/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function budgetLabel(it: PipelineItem): string {
  const b = it.budget;
  if (!b) return '';
  if (b.raw) return b.raw;
  const unit = b.unit === 'hourly' ? '/hr' : '';
  if (b.min && b.max && b.min !== b.max) return `$${b.min}-${b.max}${unit}`;
  if (b.max) return `$${b.max}${unit}`;
  return '';
}

function isStale(iso: string | null): boolean {
  if (!iso) return false;
  return (Date.now() - Date.parse(iso)) / 86400000 > 45;
}

function isPassedOn(it: PipelineItem): boolean {
  return it.eligibility === 'rejected'
    || it.jobSeeker
    || it.verdict === 'DECLINE'
    || PASS_STATUSES.has((it.status || '').toLowerCase());
}

export function reportFile(it: PipelineItem): string | null {
  if (!it.report) return null;
  return it.report.replace(/^reports\//, '');
}

type Tier = 'go' | 'review' | 'low' | 'unscored';

function tierOf(it: PipelineItem): Tier {
  if (it.score === null) return 'unscored';
  if (!it.blocks || it.blocks.A < 3 || it.blocks.B <= 1 || it.verdict === 'DECLINE') return 'low';
  if (it.score >= 4) return 'go';
  if (it.score >= 3) return 'review';
  return 'low';
}

const ACTIVE_TIERS: { key: Tier; name: string; className: string; note: string }[] = [
  { key: 'go', name: 'Worth applying', className: 'go', note: '4+ with fit and budget gates cleared' },
  { key: 'review', name: 'Review', className: 'warn', note: '3–3.9 with fit and budget gates cleared' },
];

function reasonLabel(code: string): string {
  const labels: Record<string, string> = {
    legacy_unclassified: 'Needs classification by the selected model',
    model_unavailable: 'The selected model was unavailable during triage',
    model_invalid: 'The model response could not be verified',
    model_capacity: 'Deferred because this scan reached its model limit',
    low_confidence: 'The model was not confident enough to admit this gig',
    worker_supply: 'Worker seeking work, not a client hiring',
    job_seeker: 'Worker seeking work, not a client hiring',
    discussion: 'Discussion or advice post, not a gig',
    source_policy: 'Does not satisfy this source’s gig-posting rules',
    full_time: 'Salaried or full-time employment, not independent project work',
    unpaid: 'Unpaid or non-cash compensation',
    below_rate_floor: 'Budget is below the configured walk-away rate',
    contingent_compensation: 'Commission, revenue share, or success-only compensation',
    scam: 'High-confidence scam pattern',
  };
  return labels[code] || code.replaceAll('_', ' ');
}

function SourceMark({ family, initial }: { family: SourceFamily; initial: string }) {
  if (family === 'reddit') {
    return (
      <span className="source-mark" aria-hidden="true">
        <svg viewBox="0 0 20 20" focusable="false">
          <path d="M13.2 4.9 14.1 2l2.5.6" />
          <circle cx="17" cy="3" r="1.2" />
          <path d="M4.4 8.6a7.8 7.8 0 0 1 11.2 0M4.2 8.1a2 2 0 1 0 .4 3.8c.8 2.4 2.9 3.8 5.4 3.8s4.6-1.4 5.4-3.8a2 2 0 1 0 .4-3.8" />
          <circle cx="7.2" cy="10.8" r=".8" className="source-mark-fill" />
          <circle cx="12.8" cy="10.8" r=".8" className="source-mark-fill" />
          <path d="M7.4 13.2c1.5 1 3.7 1 5.2 0" />
        </svg>
      </span>
    );
  }

  return (
    <span className={`source-mark source-mark-${family}`} aria-hidden="true">
      {family === 'hacker-news' ? 'Y' : family === 'remote-ok' ? 'OK' : initial}
    </span>
  );
}

function SourcePill({ source }: { source: string | null }) {
  const identity = sourceIdentity(source);
  return (
    <span className={`source-pill source-pill-${identity.family}`}>
      <SourceMark family={identity.family} initial={identity.initial} />
      <span className="source-label">{identity.label}</span>
      {identity.detail && <span className="source-detail">{identity.detail}</span>}
    </span>
  );
}

function Row({
  it,
  onEvaluated,
  onViewReport,
}: {
  it: PipelineItem;
  onEvaluated: () => void;
  onViewReport: (file: string) => void;
}) {
  const postedAt = formatPostedAt(it.firstSeen);
  const budget = budgetLabel(it);
  const tier = tierOf(it);
  const report = reportFile(it);
  const flags = it.redFlags?.length ?? 0;
  const triageReason = it.triageReasons?.[0];
  const reason = it.reasons?.[0] || (triageReason ? reasonLabel(triageReason) : '');
  const evidence = it.triageEvidence?.[0];

  const pass = async () => {
    await api.patchItem(it.url, { status: 'dropped', checked: true });
    onEvaluated();
  };

  return (
    <div className={`triage-row ${isStale(it.firstSeen) ? 'stale' : ''}`}>
      <div
        className={`op-score triage-score score-${tier}`}
        aria-label={
          it.score === null
            ? 'Not scored'
            : `Score ${it.score}, ${it.state === 'evaluated' ? 'scored' : 'estimated'}`
        }
      >
        {it.score ?? '·'}
        {it.score !== null && <small>{it.state === 'evaluated' ? 'scored' : 'est.'}</small>}
      </div>
      <div className="triage-main">
        <a href={it.url} target="_blank" rel="noreferrer" className="triage-title">
          {cleanTitle(it.title, it.url)}
        </a>
        <div className="triage-meta">
          <SourcePill source={it.source} />
          {postedAt && (
            <>
              <span className={`age-badge age-${postedAt.freshness}`}>{postedAt.relative}</span>
              <time
                className="posted-at"
                dateTime={it.firstSeen || undefined}
                title={`Posted ${postedAt.date} at ${postedAt.time}`}
              >
                <span>{postedAt.date}</span>
                <span className="meta-separator" aria-hidden="true">
                  ·
                </span>
                <span className="posted-time">{postedAt.time}</span>
              </time>
            </>
          )}
          {budget && (
            <span className="budget-meta">
              <span className="budget-mark" aria-hidden="true">$</span>
              {budget}
            </span>
          )}
        </div>
        {reason && <div className="triage-reason">{reason}</div>}
        {evidence && it.eligibility !== 'eligible' && (
          <div className="triage-evidence" title={evidence.meaning}>Evidence: “{evidence.quote}”</div>
        )}
        {flags > 0 && (
          <div className="flag-note" title={it.redFlags.join('\n')}>
            {flags} red {flags === 1 ? 'flag' : 'flags'}: {it.redFlags.join(', ')}
          </div>
        )}
      </div>
      <div className="triage-actions">
        {report ? (
          <button className="btn btn-sm" onClick={() => onViewReport(report)}>
            Report
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => openMode('gig', { url: it.url }, { onDone: onEvaluated })}
          >
            Evaluate
          </button>
        )}
        {it.inPipeline && !isPassedOn(it) && (
          <button className="btn btn-ghost btn-sm" onClick={pass}>
            Pass
          </button>
        )}
      </div>
    </div>
  );
}

export function PipelineBoard() {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedBuckets, setExpandedBuckets] = useState<Record<string, boolean>>({});
  const [openReport, setOpenReport] = useState<string | null>(null);

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
    if (!url.trim()) return;
    setError(null);
    setNotice(null);
    setAdding(true);
    try {
      await api.addUrl(url.trim());
      setUrl('');
      setNotice('Added to the pipeline. Use Evaluate to generate the full gig review.');
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const { tiers, lowFit, quarantine, rejected } = useMemo(() => {
    const buckets = partitionPipelineItems(items);
    const tiers = new Map<Tier, PipelineItem[]>();
    for (const it of buckets.active) {
      const t = tierOf(it);
      if (!tiers.has(t)) tiers.set(t, []);
      tiers.get(t)!.push(it);
    }
    return { tiers, ...buckets };
  }, [items]);

  const secondaryBuckets = [
    {
      key: 'lowFit',
      label: 'Low fit',
      note: 'confirmed gigs below active fit, budget, or score gates',
      items: lowFit,
    },
    {
      key: 'quarantine',
      label: 'Needs classification',
      note: 'legacy, ambiguous, deferred, or model-unavailable items',
      items: quarantine,
    },
    {
      key: 'rejected',
      label: 'Filtered by quality gate',
      note: 'not verified paid, client-side independent work',
      items: rejected,
    },
  ];

  return (
    <div>
      <div className="triage-toolbar">
        <input
          className="input"
          placeholder="Paste a gig URL to add it to the inbox…"
          aria-label="Add a gig URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn btn-primary" onClick={add} disabled={adding || !url.trim()}>
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>
      <p className="form-help">Adding only stores the URL — nothing is sent to the poster.</p>
      {notice && <p className="notice notice-ok">{notice}</p>}
      {error && <p className="notice notice-error">{error}</p>}

      {loading ? (
        <div style={{ display: 'grid', gap: 10, marginTop: 20 }} aria-label="Loading pipeline">
          <div className="skeleton" style={{ height: 56 }} />
          <div className="skeleton" style={{ height: 56 }} />
          <div className="skeleton" style={{ height: 56 }} />
        </div>
      ) : items.length === 0 ? (
        <div className="empty" style={{ marginTop: 20 }}>
          <strong>No gigs yet.</strong>
          <span> Run a scan or paste a URL above to start triage.</span>
        </div>
      ) : (
        <>
          {ACTIVE_TIERS.map(({ key, name, className, note }) => {
            const list = tiers.get(key);
            if (!list?.length) return null;
            return (
              <section key={key}>
                <div className="tier-head">
                  <span className={`tier-name ${className}`}>{name}</span>
                  <span className="tier-note">{note}</span>
                  <span className="tier-count">{list.length}</span>
                </div>
                <div className="triage-list">
                  {list.map((it) => (
                    <Row key={it.url} it={it} onEvaluated={reload} onViewReport={setOpenReport} />
                  ))}
                </div>
              </section>
            );
          })}
          {tiers.size === 0 && (
            <div className="empty pipeline-confirmed-empty" style={{ marginTop: 20 }}>
              <strong>No model-confirmed gigs are ready yet.</strong>
              <span> Run a scan to classify new candidates; uncertain items stay safely outside the active list.</span>
            </div>
          )}
          {secondaryBuckets.map((bucket) => {
            if (bucket.items.length === 0) return null;
            const expanded = Boolean(expandedBuckets[bucket.key]);
            return (
              <div className={`passed-section pipeline-bucket pipeline-bucket-${bucket.key}`} key={bucket.key}>
                <button
                  className="passed-toggle"
                  onClick={() => setExpandedBuckets((current) => ({ ...current, [bucket.key]: !expanded }))}
                  aria-expanded={expanded}
                >
                  <span>{expanded ? 'Hide' : 'Show'} {bucket.label.toLowerCase()}</span>
                  <span className="bucket-note">{bucket.note}</span>
                  <span className="passed-count">{bucket.items.length}</span>
                </button>
                {expanded && (
                  <div className="triage-list" style={{ marginTop: 10 }}>
                    {bucket.items.map((it) => (
                      <Row key={it.url} it={it} onEvaluated={reload} onViewReport={setOpenReport} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      <ReportDrawer file={openReport} onClose={() => setOpenReport(null)} />
    </div>
  );
}
