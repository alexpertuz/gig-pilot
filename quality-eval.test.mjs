import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateQuality } from './quality-eval.mjs';

function corpusFixture() {
  return [
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `good-${index + 1}`,
      expected: 'survivor',
      title: `Paid project ${index + 1}`,
      description: 'Client needs an independent contractor to deliver a paid project.',
      source: 'r/forhire',
    })),
    {
      id: 'discussion', expected: 'reject', source: 'r/programacion',
      title: 'Why does React navigation keep crashing?', description: 'Can someone explain this error?',
    },
    {
      id: 'ambiguous', expected: 'quarantine', source: 'community',
      title: 'Maybe looking for help', description: 'Details later.',
    },
  ];
}

function accepted(score = 4.2) {
  return {
    eligibility: 'eligible', confidence: 0.96, intent: 'client_hiring', engagement: 'project',
    relationship: 'independent', paid: true,
    evidence: [{ quote: 'paid project', meaning: 'explicit engagement' }], reasonCodes: [],
    fit: { score, blocks: { A: 5, B: 5, C: 4, D: 3, E: 3, F: 4 }, reasons: [], redFlags: [], verdict: 'GO' },
  };
}

function rejected(reason = 'not_a_gig') {
  return {
    eligibility: 'rejected', confidence: 0.98, intent: 'discussion', engagement: 'unknown',
    relationship: 'unknown', paid: null, evidence: [], reasonCodes: [reason], fit: null,
  };
}

function offProfileAcceptedAboveThree() {
  return {
    ...accepted(),
    fit: {
      score: 3.2,
      blocks: { A: 1, B: 5, C: 4, D: 3, E: 3, F: 4 },
      reasons: ['Outside the configured services'], redFlags: [], verdict: 'NEGOTIATE',
    },
  };
}

function passingDecisions(corpus) {
  return Object.fromEntries(corpus.map((entry, index) => [
    entry.id,
    entry.expected === 'survivor' && index < 14 ? accepted() : rejected(),
  ]));
}

test('quality gates reject a discussion leaked into active results', () => {
  const corpus = corpusFixture();
  const decisions = passingDecisions(corpus);
  decisions.discussion = accepted(5);

  const result = evaluateQuality(corpus, decisions);

  assert.equal(result.passed, false);
  assert.equal(result.hardNegativeLeakage, 1);
  assert.equal(result.top20Leakage, 1);
  assert.ok(result.failures.some((failure) => /hard-negative/i.test(failure)));
  assert.ok(result.failures.some((failure) => /top 20/i.test(failure)));
});

test('quality gates pass at 95% precision, 70% recall, and zero negative leakage', () => {
  const corpus = corpusFixture();
  const result = evaluateQuality(corpus, passingDecisions(corpus));

  assert.equal(result.precision, 1);
  assert.equal(result.recall, 0.7);
  assert.equal(result.hardNegativeLeakage, 0);
  assert.equal(result.top20Leakage, 0);
  assert.equal(result.schemaValidity, 1);
  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
});

test('quality gates fail closed on missing or malformed decisions', () => {
  const corpus = corpusFixture();
  const decisions = passingDecisions(corpus);
  delete decisions['good-20'];
  decisions['good-19'] = { eligibility: 'eligible', confidence: 'high' };

  const result = evaluateQuality(corpus, decisions);

  assert.equal(result.passed, false);
  assert.ok(result.schemaValidity < 1);
  assert.ok(result.failures.some((failure) => /schema/i.test(failure)));
});

test('quality gates keep genuine but off-profile gigs out of active results', () => {
  const corpus = [
    {
      id: 'software', expected: 'survivor', expectedActive: true, source: 'r/forhire',
      title: '[Hiring] React project', description: 'Client needs an independent contractor for a paid project.',
    },
    {
      id: 'voice', expected: 'survivor', expectedActive: false, source: 'r/forhire',
      title: '[Hiring] Voice actor', description: 'Client needs an independent voice actor for a paid project.',
    },
  ];
  const promoted = evaluateQuality(corpus, { software: accepted(), voice: accepted() });
  const correctlyLow = evaluateQuality(corpus, { software: accepted(), voice: offProfileAcceptedAboveThree() });

  assert.equal(promoted.passed, false);
  assert.equal(promoted.activePrecision, 0.5);
  assert.equal(promoted.top20Leakage, 1);
  assert.ok(promoted.failures.some((failure) => /active precision/i.test(failure)));
  assert.equal(correctlyLow.activePrecision, 1);
  assert.equal(correctlyLow.fitRecall, 1);
  assert.equal(correctlyLow.passed, true);
});
