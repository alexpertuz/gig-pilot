import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { api, getAgentProvider, type ScanState } from '../lib/api';
import { streamPost } from '../lib/useSSE';

const phaseCopy: Record<ScanState['phase'], string> = {
  idle: 'Ready to scan',
  preparing: 'Preparing your source list',
  scanning: 'Checking configured sources',
  verifying: 'Verifying that new gigs are still active',
  triaging: 'Validating candidates with your selected model',
  summarizing: 'Organizing the scan results',
  scoring: 'Evaluating fit for confirmed opportunities',
  finished: 'Scan finished',
};

function formatElapsed(startedAt: string | null, finishedAt: string | null, now: number) {
  if (!startedAt) return '0:00';
  const end = finishedAt ? new Date(finishedAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

function ScanIcon({ status }: { status: ScanState['status'] }) {
  if (status === 'running') return <span className="scan-spinner" aria-hidden="true" />;
  if (status === 'failed') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3.5v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 12.5 3.2 3.2L17.5 8.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>;
}

function Scan() {
  const [scan, setScan] = useState<ScanState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const refresh = () => api.scanState()
    .then(({ scan: next }) => {
      setScan(next);
      setConnectionError(null);
    })
    .catch((error) => setConnectionError(error instanceof Error ? error.message : String(error)));

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (scan?.status !== 'running') return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [scan?.status]);

  const run = () => {
    setConnectionError(null);
    streamPost('/api/scan', { args: [], provider: getAgentProvider() }, (event) => {
      if (event.type === 'state' || event.type === 'done' || event.type === 'already_running') {
        setScan(event.data as ScanState);
        setNow(Date.now());
      }
    }, (error) => {
      setConnectionError(error.message);
      void refresh();
    });
  };

  const elapsed = useMemo(
    () => formatElapsed(scan?.startedAt || null, scan?.finishedAt || null, now),
    [scan?.startedAt, scan?.finishedAt, now],
  );

  const isRunning = scan?.status === 'running';
  const hasRun = Boolean(scan?.startedAt);
  const progress = scan?.progress.total
    ? Math.min(100, Math.round((scan.progress.completed / scan.progress.total) * 100))
    : 0;
  const sourceQuality = Object.entries(scan?.summary.bySource || {})
    .sort(([left], [right]) => left.localeCompare(right));

  return (
    <div className="scan-page">
      <header className="scan-page-head">
        <div>
          <h1 className="page-title">Scan sources</h1>
          <p className="page-subtitle">
            Find new gigs across your configured sources and send the best candidates into your review queue.
          </p>
        </div>
        <div className="scan-head-actions">
          {hasRun && <span className="scan-last-run">Last scan {formatDate(scan?.finishedAt || scan?.startedAt || null)}</span>}
          <button className="btn btn-primary" onClick={run} disabled={!scan || isRunning}>
            {isRunning ? 'Scan in progress' : hasRun ? 'Run another scan' : 'Start scan'}
          </button>
        </div>
      </header>

      {connectionError && <div className="notice notice-error" role="alert">{connectionError}</div>}

      {!scan ? (
        <div className="scan-loading" aria-label="Loading scan status">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : !hasRun ? (
        <section className="scan-ready">
          <div className="scan-ready-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M5 19V9m7 10V5m7 14v-7M3 19h18" /></svg>
          </div>
          <div>
            <h2>Your next opportunities start here</h2>
            <p>We’ll check every enabled source, remove duplicates, apply your filters, and add new matches to Pipeline.</p>
            <div className="scan-ready-links">
              <button className="btn btn-primary" onClick={run}>Start scan</button>
              <Link className="btn" to="/sources">Review sources</Link>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className={`scan-status scan-status-${scan.status}`} aria-live="polite">
            <div className="scan-status-main">
              <div className="scan-status-icon"><ScanIcon status={scan.status} /></div>
              <div className="scan-status-copy">
                <span className="scan-eyebrow">
                  {isRunning ? 'Scan in progress' : scan.status === 'failed' ? 'Scan failed' : scan.status === 'completed_with_issues' ? 'Completed with issues' : 'Scan complete'}
                </span>
                <h2>
                  {isRunning
                    ? (scan.phase === 'scanning' && scan.progress.currentSource ? `Checking ${scan.progress.currentSource}` : phaseCopy[scan.phase])
                    : scan.status === 'failed'
                      ? 'The scan could not finish'
                      : scan.summary.newOffersAdded > 0
                        ? `${scan.summary.newOffersAdded} new ${scan.summary.newOffersAdded === 1 ? 'gig is' : 'gigs are'} ready to review`
                        : 'No new gigs this time'}
                </h2>
                <p>
                  {isRunning
                    ? 'You can leave this page. The scan will continue, and this view will be here when you return.'
                    : scan.status === 'failed'
                      ? 'Your existing pipeline was left intact. Check the issue below, then try again.'
                      : scan.status === 'completed_with_issues' && scan.summary.newOffersAdded === 0
                        ? 'No uncertain candidate was admitted. Review the issue below, then retry when the selected model is available.'
                      : scan.summary.newOffersAdded > 0
                        ? 'Only model-confirmed, paid independent gigs were added to Pipeline.'
                        : 'The scan finished successfully. Previously seen and filtered gigs were not added again.'}
                </p>
              </div>
            </div>

            {isRunning && (
              <div className="scan-progress-wrap">
                <div className="scan-progress-meta">
                  <span>{phaseCopy[scan.phase]}</span>
                  <span>{scan.progress.total ? `${scan.progress.completed} of ${scan.progress.total} sources` : 'Connecting…'}</span>
                </div>
                <div className={`scan-progress ${scan.progress.total ? '' : 'indeterminate'}`}>
                  <span style={scan.progress.total ? { width: `${progress}%` } : undefined} />
                </div>
              </div>
            )}

            <div className="scan-metrics">
              <div><strong>{scan.progress.total ? `${scan.progress.completed}/${scan.progress.total}` : '—'}</strong><span>Sources checked</span></div>
              <div><strong>{scan.progress.jobsInspected || scan.summary.totalJobsFound || '—'}</strong><span>Listings inspected</span></div>
              <div><strong>{elapsed}</strong><span>Elapsed time</span></div>
              {!isRunning && <div><strong>{scan.summary.newOffersAdded}</strong><span>Added to Pipeline</span></div>}
            </div>
          </section>

          {!isRunning && (
            <>
              <section className="scan-summary" aria-label="Scan summary">
                <div><strong>{scan.summary.ruleRejected}</strong><span>Rule rejected</span></div>
                <div><strong>{scan.summary.modelEvaluated}</strong><span>Model evaluated</span></div>
                <div><strong>{scan.summary.cached}</strong><span>Cached decisions</span></div>
                <div><strong>{scan.summary.quarantined}</strong><span>Needs classification</span></div>
                <div className="scan-summary-added"><strong>{scan.summary.accepted}</strong><span>Accepted gigs</span></div>
              </section>

              {sourceQuality.length > 0 && (
                <details className="scan-source-quality">
                  <summary>
                    <span>Source quality</span>
                    <span>{sourceQuality.length} {sourceQuality.length === 1 ? 'source' : 'sources'}</span>
                  </summary>
                  <div className="scan-source-grid">
                    <div className="scan-source-row scan-source-head">
                      <span>Source</span><span>Fetched</span><span>Accepted</span><span>Rejected</span><span>Uncertain</span>
                    </div>
                    {sourceQuality.map(([source, metrics]) => (
                      <div className="scan-source-row" key={source}>
                        <strong>{source}</strong>
                        <span>{metrics.fetched}</span>
                        <span className="scan-source-accepted">{metrics.accepted}</span>
                        <span>{metrics.rejected}</span>
                        <span>{metrics.quarantined}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {scan.issues.length > 0 && (
                <section className="scan-issues">
                  <div>
                    <h3>{scan.status === 'failed' ? 'What stopped the scan' : 'Some sources need attention'}</h3>
                    <p>{scan.status === 'failed' ? 'Resolve the issue and run the scan again.' : 'Other sources completed normally and their results were saved.'}</p>
                  </div>
                  <ul>{scan.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                </section>
              )}

              {scan.newItems.length > 0 && (
                <section className="scan-results">
                  <div className="scan-section-head">
                    <div>
                      <h2>New in this scan</h2>
                      <p>Previewing {Math.min(scan.newItems.length, 8)} of {scan.newItems.length} newly added gigs.</p>
                    </div>
                    <Link className="btn btn-primary" to="/pipeline">Review {scan.newItems.length} in Pipeline</Link>
                  </div>
                  <div className="scan-result-list">
                    {scan.newItems.slice(0, 8).map((item) => (
                      <a className="scan-result-row" href={item.url} target="_blank" rel="noreferrer" key={item.url}>
                        <div className="scan-result-score">
                          {item.score != null ? item.score.toFixed(1) : '—'}
                          <span>{item.verdict || 'New'}</span>
                        </div>
                        <div className="scan-result-main">
                          <strong>{item.title || item.url}</strong>
                          <span>{[item.source, item.location].filter(Boolean).join(' · ') || new URL(item.url).hostname}</span>
                        </div>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7m-8 0h8v8" /></svg>
                      </a>
                    ))}
                  </div>
                </section>
              )}

              {scan.status !== 'failed' && scan.newItems.length === 0 && (
                <section className="scan-zero">
                  <div>
                    <h2>Your pipeline is up to date</h2>
                    <p>No new gigs passed every quality check. Uncertain candidates remain outside the active Pipeline.</p>
                  </div>
                  <Link className="btn" to="/sources">Review sources</Link>
                </section>
              )}
            </>
          )}

          <details className="scan-details">
            <summary>
              <span>Technical details</span>
              <span>{scan.log.length} {scan.log.length === 1 ? 'line' : 'lines'}</span>
            </summary>
            <div className="scan-log mono" role="log">
              {scan.log.length > 0
                ? scan.log.map((entry, index) => <div className={entry.kind === 'stderr' ? 'scan-log-error' : ''} key={`${index}-${entry.text}`}>{entry.text}</div>)
                : <span className="scan-log-empty">No technical output yet.</span>}
            </div>
          </details>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/scan')({ component: Scan });
