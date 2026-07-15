import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePipeline } from '../lib/files.mjs';

test('mergePipeline never presents legacy heuristic scores as evaluated gigs', () => {
  const items = [
    { url: 'https://x.test/a', status: null, title: 'A', checked: false },
    { url: 'https://x.test/b', status: null, title: 'B', checked: false },
  ];
  const scores = {
    'https://x.test/a': {
      title: 'A real', source: 'r/forhire', first_seen: '2026-07-06',
      budget: { max: 90, unit: 'hourly' }, score: 4.3, verdict: 'GO',
      blocks: {}, reasons: ['x'], redFlags: [], state: 'estimated', report: null,
    },
  };
  const history = { 'https://x.test/b': { first_seen: '2026-05-01', title: 'B hist', portal: 'reddit-api', location: 'remote' } };

  const merged = mergePipeline(items, scores, history, {});
  const a = merged.find((i) => i.url === 'https://x.test/a');
  const b = merged.find((i) => i.url === 'https://x.test/b');

  assert.equal(a.score, null);
  assert.equal(a.verdict, null);
  assert.equal(a.state, null);
  assert.equal(a.eligibility, 'uncertain');
  assert.deepEqual(a.triageReasons, ['legacy_unclassified']);
  assert.equal(a.title, 'A real');
  assert.equal(a.firstSeen, '2026-07-06');
  assert.equal(b.score, null);
  assert.equal(b.verdict, null);
  assert.equal(b.title, 'B hist'); // falls back to history title
  assert.equal(b.firstSeen, '2026-05-01');
});

test('mergePipeline exposes a score only for model-confirmed eligible work', () => {
  const url = 'https://x.test/confirmed';
  const items = [{ url, status: 'new', title: null, checked: false }];
  const scores = {
    [url]: {
      title: 'Build a React dashboard', source: 'r/forhire', first_seen: '2026-07-11',
      budget: { raw: '$90/hr', max: 90, unit: 'hourly' }, score: 4.2, verdict: 'GO',
      blocks: { A: 5, B: 5, C: 4, D: 3, E: 3, F: 4 },
      reasons: ['Strong fit'], redFlags: [], state: 'evaluated', report: null,
      eligibility: 'eligible', confidence: 0.96,
      fitFingerprint: 'fit-v1',
    },
  };
  const triage = {
    [url]: {
      eligibility: 'eligible', confidence: 0.96, intent: 'client_hiring',
      engagement: 'contract', relationship: 'independent', paid: true,
      origin: 'model', reasonCodes: [],
      evidence: [{ quote: 'paid independent contractor', meaning: 'explicit paid engagement' }],
      fitFingerprint: 'fit-v1',
      fit: {
        score: 4.2, blocks: { A: 5, B: 5, C: 4, D: 3, E: 3, F: 4 },
        reasons: ['Strong fit'], redFlags: [], verdict: 'GO',
      },
    },
  };

  const [item] = mergePipeline(items, scores, {}, triage);

  assert.equal(item.score, 4.2);
  assert.equal(item.verdict, 'GO');
  assert.equal(item.state, 'evaluated');
  assert.equal(item.eligibility, 'eligible');
  assert.equal(item.confidence, 0.96);
  assert.equal(item.intent, 'client_hiring');
  assert.equal(item.engagement, 'contract');
  assert.equal(item.relationship, 'independent');
  assert.equal(item.paid, true);
  assert.deepEqual(item.triageEvidence, triage[url].evidence);
});

test('mergePipeline hides a score whose fingerprint does not match its decision', () => {
  const url = 'https://x.test/partial-commit';
  const items = [{ url, status: 'new', title: 'Partial derived commit', checked: false }];
  const scores = {
    [url]: {
      score: 4.8, verdict: 'GO', blocks: { A: 5, B: 5, C: 5, D: 4, E: 4, F: 4 },
      state: 'evaluated', eligibility: 'eligible', fitFingerprint: 'old-fit',
    },
  };
  const triage = {
    [url]: {
      eligibility: 'eligible', confidence: 0.97, intent: 'client_hiring', engagement: 'project',
      relationship: 'independent', paid: true, origin: 'model', reasonCodes: [],
      evidence: [{ quote: 'project', meaning: 'explicit project' }], fitFingerprint: 'new-fit',
      fit: { score: 4.2 },
    },
  };

  const [item] = mergePipeline(items, scores, {}, triage);

  assert.equal(item.score, null);
  assert.equal(item.state, null);
  assert.equal(item.eligibility, 'eligible');
});

test('mergePipeline suppresses stale scores when the quality gate rejected the item', () => {
  const url = 'https://x.test/rent';
  const items = [{ url, status: null, title: 'Need $1000 for rent', checked: false }];
  const scores = {
    [url]: { score: 3, verdict: 'NEGOTIATE', state: 'evaluated', reasons: ['Old score'], redFlags: [] },
  };
  const triage = {
    [url]: {
      eligibility: 'rejected', confidence: 1, intent: 'worker_seeking', engagement: 'unknown',
      relationship: 'unknown', paid: null, origin: 'rule', reasonCodes: ['worker_supply'],
      evidence: [{ quote: 'need $1000 for rent', meaning: 'worker-seeking post' }],
    },
  };

  const [item] = mergePipeline(items, scores, {}, triage);

  assert.equal(item.score, null);
  assert.equal(item.verdict, null);
  assert.equal(item.state, null);
  assert.equal(item.eligibility, 'rejected');
  assert.deepEqual(item.triageReasons, ['worker_supply']);
});

test('mergePipeline includes derived rejected and uncertain candidates without mutating Pipeline', () => {
  const rejectedUrl = 'https://x.test/discussion';
  const uncertainUrl = 'https://x.test/unclear';
  const eligibleButNotAppendedUrl = 'https://x.test/interrupted-append';
  const candidates = {
    [rejectedUrl]: {
      url: rejectedUrl, title: 'How should I learn React?', source: 'r/programacion',
      firstSeen: '2026-07-11', location: null,
      compensation: { raw: null, min: null, max: null, cadence: 'unknown' },
    },
    [uncertainUrl]: {
      url: uncertainUrl, title: 'Need help with a project', source: 'community',
      firstSeen: '2026-07-11', location: 'Remote',
      compensation: { raw: '$800', min: null, max: 800, cadence: 'project' },
    },
    [eligibleButNotAppendedUrl]: {
      url: eligibleButNotAppendedUrl, title: 'Confirmed but append interrupted', source: 'r/forhire',
      firstSeen: '2026-07-11', compensation: { cadence: 'hourly' },
    },
  };
  const triage = {
    [rejectedUrl]: { eligibility: 'rejected', confidence: 1, origin: 'rule', reasonCodes: ['discussion'] },
    [uncertainUrl]: { eligibility: 'uncertain', confidence: 0, origin: 'system', reasonCodes: ['model_unavailable'] },
    [eligibleButNotAppendedUrl]: { eligibility: 'eligible', confidence: 0.96, origin: 'model', reasonCodes: [] },
  };

  const merged = mergePipeline([], {}, {}, triage, candidates);

  assert.deepEqual(merged.map((item) => item.url), [rejectedUrl, uncertainUrl]);
  assert.ok(merged.every((item) => item.inPipeline === false));
  assert.equal(merged[0].eligibility, 'rejected');
  assert.equal(merged[1].eligibility, 'uncertain');
  assert.equal(merged[1].budget.max, 800);
});
