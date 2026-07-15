import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCandidate } from './contracts.mjs';
import { triageCandidates } from './engine.mjs';

const PROFILE = {
  services: { primary: ['Frontend development'] },
  archetypes: [{ name: 'Frontend', stack: ['React'] }],
  rate_card: { hourly: { target: 75, walk_away: 40 }, project: { min: 500 } },
  ideal_gig: { green_flags: ['clear scope'] },
};

function goodCandidate(index = 1) {
  return normalizeCandidate({
    url: `https://example.test/gig-${index}`,
    title: `[Hiring] React contractor ${index} — $90/hr`,
    description: `We need a paid independent contractor to build and deliver React dashboard ${index}.`,
    source: 'r/forhire',
    budget: '$90/hr',
  }, { provider: 'reddit', firstSeen: '2026-07-11' });
}

function validDecision(item, overrides = {}) {
  return {
    url: item.url,
    eligibility: 'eligible', confidence: 0.96, intent: 'client_hiring', engagement: 'contract',
    relationship: 'independent', paid: true,
    evidence: [{ quote: 'paid independent contractor', meaning: 'explicit paid contract' }],
    reasonCodes: [],
    fit: {
      score: 4.2,
      blocks: { A: 5, B: 5, C: 4, D: 3, E: 3, F: 4 },
      reasons: ['Strong profile fit'], redFlags: [], verdict: 'GO',
    },
    ...overrides,
  };
}

function options(overrides = {}) {
  return {
    profile: PROFILE,
    provider: 'codex',
    runtimeFingerprint: 'codex:test',
    now: () => '2026-07-11T12:00:00.000Z',
    ...overrides,
  };
}

test('unchanged valid decisions are cache hits and make zero additional model calls', async () => {
  const item = goodCandidate();
  let calls = 0;
  const first = await triageCandidates([item], options({
    runModel: async (batch) => {
      calls += 1;
      return batch.map(validDecision);
    },
  }));
  const second = await triageCandidates([item], options({
    cache: first.decisions,
    runModel: async () => {
      calls += 1;
      throw new Error('cache miss');
    },
  }));

  assert.equal(calls, 1);
  assert.equal(second.metrics.cached, 1);
  assert.equal(second.accepted.length, 1);
  assert.equal(first.scores[item.url].fitFingerprint, first.decisions[item.url].fitFingerprint);
});

test('deterministic rejects never invoke the model', async () => {
  const bad = normalizeCandidate({
    url: 'https://example.test/rent', title: '27-F need $1000 for rent!',
    description: 'I am looking for help paying rent.', source: 'r/jobbit',
  }, { provider: 'reddit', firstSeen: '2026-07-11' });
  let calls = 0;

  const result = await triageCandidates([bad], options({ runModel: async () => { calls += 1; return []; } }));

  assert.equal(calls, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.decisions[bad.url].reasonCodes[0], 'source_policy');
  assert.deepEqual(result.metrics.bySource['r/jobbit'], {
    fetched: 1, accepted: 0, rejected: 1, quarantined: 0,
  });
});

test('model failure quarantines every survivor and creates no scores', async () => {
  const items = [goodCandidate(1), goodCandidate(2)];
  const result = await triageCandidates(items, options({
    runModel: async () => { throw new Error('runtime offline'); },
  }));

  assert.equal(result.accepted.length, 0);
  assert.equal(result.uncertain.length, 2);
  assert.deepEqual(result.scores, {});
  assert.ok(result.issues.some((issue) => /runtime offline/i.test(issue)));
  assert.ok(result.uncertain.every((item) => result.decisions[item.url].reasonCodes.includes('model_unavailable')));
});

test('usage-limit failures stop immediately and quarantine without a repair retry', async () => {
  const item = goodCandidate();
  let calls = 0;
  const result = await triageCandidates([item], options({
    runModel: async () => {
      calls += 1;
      throw new Error('usage limit reached; purchase more credits or try again later');
    },
  }));

  assert.equal(calls, 1);
  assert.equal(result.accepted.length, 0);
  assert.ok(result.decisions[item.url].reasonCodes.includes('model_unavailable'));
});

test('capacity bounds model work and quarantines overflow', async () => {
  const items = Array.from({ length: 35 }, (_, index) => goodCandidate(index + 1));
  let calls = 0;
  const result = await triageCandidates(items, options({
    maxModelCandidates: 30,
    batchSize: 10,
    runModel: async (batch) => {
      calls += 1;
      return batch.map(validDecision);
    },
  }));

  assert.equal(calls, 3);
  assert.equal(result.accepted.length, 30);
  assert.equal(result.uncertain.length, 5);
  assert.equal(result.metrics.capacityDeferred, 5);
  assert.ok(result.uncertain.every((item) => result.decisions[item.url].reasonCodes.includes('model_capacity')));
});

test('invalid model batch is retried once before succeeding', async () => {
  const item = goodCandidate();
  let calls = 0;
  const result = await triageCandidates([item], options({
    runModel: async (batch) => {
      calls += 1;
      return calls === 1 ? [] : batch.map(validDecision);
    },
  }));

  assert.equal(calls, 2);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.issues.length, 0);
});

test('fabricated evidence is treated as repairable model output, not runtime unavailability', async () => {
  const item = goodCandidate();
  let calls = 0;
  const result = await triageCandidates([item], options({
    runModel: async (batch) => {
      calls += 1;
      if (calls === 1) {
        return batch.map((candidate) => validDecision(candidate, {
          evidence: [{ quote: 'invented budget evidence', meaning: 'not in source' }],
        }));
      }
      return batch.map(validDecision);
    },
  }));

  assert.equal(calls, 2);
  assert.equal(result.accepted.length, 1);
});

test('default model timeout accommodates real ten-candidate Codex batches', async () => {
  const item = goodCandidate();
  let observedTimeout = null;
  const result = await triageCandidates([item], options({
    timeoutMs: undefined,
    runModel: async (batch, context) => {
      observedTimeout = context.timeoutMs;
      return batch.map(validDecision);
    },
  }));

  assert.equal(observedTimeout, 300_000);
  assert.equal(result.accepted.length, 1);
});

test('low-confidence eligible output is normalized to uncertain without a score', async () => {
  const item = goodCandidate();
  const result = await triageCandidates([item], options({
    runModel: async (batch) => batch.map((candidate) => validDecision(candidate, { confidence: 0.7 })),
  }));

  assert.equal(result.accepted.length, 0);
  assert.equal(result.uncertain.length, 1);
  assert.equal(result.decisions[item.url].eligibility, 'uncertain');
  assert.ok(result.decisions[item.url].reasonCodes.includes('low_confidence'));
  assert.deepEqual(result.scores, {});
});
