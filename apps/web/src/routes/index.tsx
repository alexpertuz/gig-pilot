import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { api, type PipelineItem } from '../lib/api';
import { Stat } from '../components/StatCard';
import { StatusChip } from '../components/StatusChip';
import { ReportDrawer } from '../components/ReportPanel';
import { reportFile } from '../components/PipelineBoard';
import { openMode } from '../lib/aiConsole';

const STEPS = [
  { title: 'Scan sources', desc: 'Pull new gig postings from Reddit and job boards into the pipeline.', to: '/scan' },
  { title: 'Review pipeline', desc: 'Triage incoming URLs and pick which ones are worth evaluating.', to: '/pipeline' },
  { title: 'Evaluate gigs', desc: 'Score fit, budget, and legitimacy for each posting from the Pipeline board.', to: '/pipeline' },
  { title: 'Track leads', desc: 'Log outreach, follow-ups, and outcomes as gigs move toward won.', to: '/leads' },
];

const PASS_STATUSES = new Set(['dropped', 'passed', 'declined']);

function isActive(it: PipelineItem): boolean {
  return it.verdict !== 'DECLINE' && !PASS_STATUSES.has((it.status || '').toLowerCase());
}

function cleanTitle(t: string | null, url: string): string {
  if (!t) return url;
  return t.replace(/\\([[\]])/g, '$1').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function Dashboard() {
  const [s, setS] = useState<any>(null);
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [openReport, setOpenReport] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.stats().then(setS);
    api.pipeline().then((r) => setItems(r.items));
    api.leads().then((r) => setLeads(r.leads.slice(-5).reverse()));
  }, []);

  const active = useMemo(() => items.filter(isActive), [items]);
  const top = useMemo(
    () =>
      active
        .filter((it) => it.score !== null)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 5),
    [active],
  );
  const worthApplying = active.filter((it) => (it.score ?? 0) >= 4).length;
  const unevaluated = s?.pipeline.unevaluated ?? null;

  const isEmpty = s && s.pipeline.total === 0 && s.leads.total === 0;

  return (
    <div>
      <h1 className="page-title">Today</h1>
      <p className="page-subtitle">
        Where your gig hunt stands and what to do next.
      </p>

      <div className="stat-strip">
        <Stat label="worth applying (4+)" value={worthApplying} onClick={() => navigate({ to: '/pipeline' })} />
        <Stat label="waiting for evaluation" value={unevaluated ?? '—'} onClick={() => navigate({ to: '/pipeline' })} />
        <Stat label="leads in play" value={s?.leads.total ?? '—'} onClick={() => navigate({ to: '/leads' })} />
        <Stat label="won" value={s?.leads.byStatus?.won ?? 0} onClick={() => navigate({ to: '/leads' })} />
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" onClick={() => navigate({ to: '/scan' })}>
          Run a scan
        </button>
        <button className="btn" onClick={() => openMode('patterns', {})}>
          Analyze win/loss patterns
        </button>
      </div>

      {isEmpty && (
        <>
          <div className="section-title">How GigPilot works</div>
          <div className="steps">
            {STEPS.map((step, i) => (
              <button key={step.title} className="card step-card" onClick={() => navigate({ to: step.to })}>
                <div className="step-num">{i + 1}</div>
                <div className="step-title">{step.title}</div>
                <div className="step-desc">{step.desc}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {!isEmpty && top.length > 0 && (
        <>
          <div className="section-title">
            <span>
              Best gigs right now <span className="section-note">— highest fit scores still open</span>
            </span>
            <button className="link" onClick={() => navigate({ to: '/pipeline' })}>
              Open pipeline →
            </button>
          </div>
          <div className="op-list">
            {top.map((it) => {
              const report = reportFile(it);
              return (
                <div key={it.url} className="op-row">
                  <div
                    className="op-score"
                    style={{ color: (it.score ?? 0) >= 4 ? 'var(--go)' : (it.score ?? 0) >= 3 ? 'var(--warn)' : 'var(--danger)' }}
                  >
                    {it.score}
                  </div>
                  <div className="op-main">
                    <a className="op-title" href={it.url} target="_blank" rel="noreferrer">
                      {cleanTitle(it.title, it.url)}
                    </a>
                    <div className="op-meta">
                      {[it.source, it.reasons?.[0]].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="op-actions">
                    {report ? (
                      <button className="btn btn-sm" onClick={() => setOpenReport(report)}>
                        Report
                      </button>
                    ) : (
                      <button className="btn btn-sm" onClick={() => openMode('gig', { url: it.url })}>
                        Evaluate
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!isEmpty && leads.length > 0 && (
        <>
          <div className="section-title">
            <span>
              Recent leads <span className="section-note">— latest outreach activity</span>
            </span>
            <button className="link" onClick={() => navigate({ to: '/leads' })}>
              All leads →
            </button>
          </div>
          <div className="op-list">
            {leads.map((l, i) => (
              <div key={i} className="op-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                <div className="op-main">
                  <span className="op-title">{l.gig || l.Gig || l.poster || l.Poster || `Lead ${l.num ?? i}`}</span>
                </div>
                <StatusChip status={l.status || l.Status} />
              </div>
            ))}
          </div>
        </>
      )}
      <ReportDrawer file={openReport} onClose={() => setOpenReport(null)} />
    </div>
  );
}

export const Route = createFileRoute('/')({ component: Dashboard });
