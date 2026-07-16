import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScanSession, parseScanLine } from '../lib/scan-session.mjs';

test('parseScanLine turns scanner output into structured scope, progress, and summary data', () => {
  const state = {
    phase: 'preparing',
    scope: { companies: 0, jobBoards: 0, localParsers: 0, skipped: 0 },
    progress: { completed: 0, total: 0, currentSource: null },
    summary: {},
    issues: [],
  };

  parseScanLine(state, 'Scanning 2 companies; 9 job boards; 1 local parser; 3 skipped — no provider matched via providers');
  parseScanLine(state, '::gig-pilot-scan::{"type":"source","name":"RemoteOK","completed":4,"total":11,"jobs":38}');
  parseScanLine(state, '::gig-pilot-scan::{"type":"triage","fetched":40,"ruleRejected":25,"modelEvaluated":10,"cached":2,"accepted":4,"quarantined":11,"bySource":{"r/forhire":{"fetched":20,"accepted":4,"rejected":5,"quarantined":11}}}');
  parseScanLine(state, 'Total jobs found:      84');
  parseScanLine(state, 'Duplicates:            19 skipped');
  parseScanLine(state, 'New offers added:      7');

  assert.deepEqual(state.scope, { companies: 2, jobBoards: 9, localParsers: 1, skipped: 3 });
  assert.deepEqual(state.progress, { completed: 4, total: 11, currentSource: 'RemoteOK', jobsInspected: 38 });
  assert.equal(state.phase, 'triaging');
  assert.equal(state.summary.totalJobsFound, 84);
  assert.equal(state.summary.duplicates, 19);
  assert.equal(state.summary.newOffersAdded, 7);
  assert.equal(state.summary.ruleRejected, 25);
  assert.equal(state.summary.modelEvaluated, 10);
  assert.equal(state.summary.cached, 2);
  assert.equal(state.summary.accepted, 4);
  assert.equal(state.summary.quarantined, 11);
  assert.deepEqual(state.summary.bySource, {
    'r/forhire': { fetched: 20, accepted: 4, rejected: 5, quarantined: 11 },
  });
});

test('scan session retains the completed result and only includes items added by that run', async () => {
  let items = [{ url: 'https://example.com/existing', title: 'Existing' }];
  const session = createScanSession({
    now: sequenceClock('2026-07-11T14:00:00.000Z', '2026-07-11T14:00:03.000Z'),
    readPipeline: async () => items,
    execute: async (_args, events) => {
      events.onLine('Scanning 0 companies; 1 job boards; 0 local parser; 0 skipped — no provider matched via providers');
      events.onLine('::gig-pilot-scan::{"type":"source","name":"RemoteOK","completed":1,"total":1,"jobs":14}');
      events.onLine('New offers added:      1');
      items = [...items, { url: 'https://remoteok.com/remote-job-1', title: 'Product engineer', source: 'remoteok' }];
      return { code: 0 };
    },
  });

  const result = await session.start([]);
  const restored = session.getState();

  assert.equal(result.started, true);
  assert.equal(restored.status, 'completed');
  assert.equal(restored.startedAt, '2026-07-11T14:00:00.000Z');
  assert.equal(restored.finishedAt, '2026-07-11T14:00:03.000Z');
  assert.deepEqual(restored.newItems.map((item) => item.url), ['https://remoteok.com/remote-job-1']);
  assert.equal(restored.summary.newOffersAdded, 1);
});

test('scan session reports non-fatal source errors as completed with issues', async () => {
  const session = createScanSession({
    readPipeline: async () => [],
    execute: async (_args, events) => {
      events.onLine('Errors (1):');
      events.onLine('  ✗ WorkingNomads: request timed out');
      events.onLine('New offers added:      0');
      return { code: 0 };
    },
  });

  await session.start([]);

  assert.equal(session.getState().status, 'completed_with_issues');
  assert.deepEqual(session.getState().issues, ['WorkingNomads: request timed out']);
});

test('scan session prevents a second scan while one is active', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const session = createScanSession({
    readPipeline: async () => [],
    execute: async () => pending,
  });

  const first = session.start([]);
  const second = await session.start([]);

  assert.equal(second.started, false);
  assert.equal(second.reason, 'already_running');
  finish({ code: 0 });
  await first;
});

function sequenceClock(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
