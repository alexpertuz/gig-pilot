const MAX_LOG_LINES = 500;
const EVENT_PREFIX = '::gig-ops-scan::';

function emptyState() {
  return {
    status: 'idle',
    phase: 'idle',
    startedAt: null,
    finishedAt: null,
    scope: { companies: 0, jobBoards: 0, localParsers: 0, skipped: 0 },
    progress: { completed: 0, total: 0, currentSource: null, jobsInspected: 0 },
    summary: {
      totalJobsFound: 0,
      filtered: 0,
      duplicates: 0,
      newOffersAdded: 0,
      ruleRejected: 0,
      modelEvaluated: 0,
      cached: 0,
      accepted: 0,
      quarantined: 0,
      bySource: {},
    },
    issues: [],
    newItems: [],
    log: [],
  };
}

function numberFrom(line, pattern) {
  const match = line.match(pattern);
  return match ? Number(match[1]) : null;
}

function addIssue(state, issue) {
  const clean = String(issue || '').trim().replace(/^✗\s*/, '');
  if (clean && !state.issues.includes(clean)) state.issues.push(clean);
}

export function parseScanLine(state, line) {
  const text = String(line || '').trimEnd();

  if (text.startsWith(EVENT_PREFIX)) {
    try {
      const event = JSON.parse(text.slice(EVENT_PREFIX.length));
      if (event.type === 'source') {
        state.phase = 'scanning';
        state.progress.completed = Number(event.completed) || 0;
        state.progress.total = Number(event.total) || state.progress.total;
        state.progress.currentSource = event.name || null;
        state.progress.jobsInspected = Number(event.jobsInspected ?? event.jobs) || 0;
      }
      if (event.type === 'triage') {
        state.phase = 'triaging';
        for (const key of ['ruleRejected', 'modelEvaluated', 'cached', 'accepted', 'quarantined']) {
          state.summary[key] = Number(event[key]) || 0;
        }
        state.summary.bySource = event.bySource && typeof event.bySource === 'object' && !Array.isArray(event.bySource)
          ? event.bySource
          : {};
      }
      return { machineEvent: true };
    } catch {
      return { machineEvent: false };
    }
  }

  const scope = text.match(/Scanning\s+(\d+)\s+compan(?:y|ies);\s*(\d+)\s+job boards?;\s*(\d+)\s+local parser;\s*(\d+)\s+skipped/i);
  if (scope) {
    state.phase = 'scanning';
    state.scope = {
      companies: Number(scope[1]),
      jobBoards: Number(scope[2]),
      localParsers: Number(scope[3]),
      skipped: Number(scope[4]),
    };
    state.progress.total = Number(scope[1]) + Number(scope[2]);
  }

  if (/Verifying liveness/i.test(text)) state.phase = 'verifying';
  if (/Portal Scan\s+—/i.test(text)) state.phase = 'summarizing';
  if (/^Scored\s+\d+\s+gigs/i.test(text)) state.phase = 'scoring';

  const summaryFields = [
    ['totalJobsFound', /^Total jobs found:\s+(\d+)/i],
    ['duplicates', /^Duplicates:\s+(\d+)/i],
    ['newOffersAdded', /^New offers added:\s+(\d+)/i],
  ];
  for (const [key, pattern] of summaryFields) {
    const value = numberFrom(text, pattern);
    if (value !== null) state.summary[key] = value;
  }

  if (/^(Rejected|Filtered by)/i.test(text)) {
    const value = numberFrom(text, /:\s+(\d+)/);
    if (value !== null) state.summary.filtered += value;
  }

  if (/^\s*✗\s*/.test(text)) addIssue(state, text);
  return { machineEvent: false };
}

export function createScanSession({ execute, readPipeline, now = () => new Date().toISOString() }) {
  let state = emptyState();
  let activePromise = null;
  const listeners = new Set();

  const snapshot = () => structuredClone(state);
  const publish = () => {
    const current = snapshot();
    for (const listener of listeners) listener(current);
  };

  const appendLine = (kind, value) => {
    const line = String(value || '').trimEnd();
    if (!line) return;
    const parsed = parseScanLine(state, line);
    if (kind === 'stderr') addIssue(state, line);
    if (!parsed.machineEvent) {
      state.log.push({ kind, text: line });
      if (state.log.length > MAX_LOG_LINES) state.log.splice(0, state.log.length - MAX_LOG_LINES);
    }
    publish();
  };

  return {
    getState: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    async start(args = []) {
      if (activePromise) {
        return { started: false, reason: 'already_running', state: snapshot() };
      }

      state = emptyState();
      state.status = 'running';
      state.phase = 'preparing';
      state.startedAt = now();
      publish();

      activePromise = (async () => {
        const before = await readPipeline();
        const beforeUrls = new Set(before.map((item) => item.url));
        let result;
        try {
          result = await execute(args, {
            onLine: (line) => appendLine('stdout', line),
            onErr: (line) => appendLine('stderr', line),
          });
        } catch (error) {
          result = { code: 1 };
          appendLine('stderr', error instanceof Error ? error.message : String(error));
        }

        const after = await readPipeline();
        state.newItems = after.filter((item) => !beforeUrls.has(item.url));
        if (!Number.isFinite(state.summary.newOffersAdded) || state.summary.newOffersAdded === 0) {
          state.summary.newOffersAdded = state.newItems.length;
        }
        state.finishedAt = now();
        state.phase = 'finished';
        if (result.code !== 0) state.status = 'failed';
        else if (state.issues.length > 0) state.status = 'completed_with_issues';
        else state.status = 'completed';
        publish();
        return { started: true, state: snapshot() };
      })();

      try {
        return await activePromise;
      } finally {
        activePromise = null;
      }
    },
  };
}
