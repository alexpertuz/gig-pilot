import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCandidate } from './contracts.mjs';
import { isAcceptedDecision, validateDecision, validateDecisionList } from './decision.mjs';

function candidate(description = 'We need a paid independent contractor to build and deliver a React dashboard for $90/hr.') {
  return normalizeCandidate({
    url: 'https://example.test/gig',
    title: '[Hiring] React dashboard contractor — $90/hr',
    description,
    source: 'r/forhire',
    budget: '$90/hr',
  }, { provider: 'reddit', firstSeen: '2026-07-11' });
}

function validFit(overrides = {}) {
  return {
    score: 4.2,
    blocks: { A: 5, B: 5, C: 4, D: 3, E: 3, F: 4 },
    reasons: ['Strong React fit', 'Rate is above target'],
    redFlags: [],
    verdict: 'GO',
    ...overrides,
  };
}

function validDecision(url, overrides = {}) {
  return {
    url,
    eligibility: 'eligible',
    confidence: 0.96,
    intent: 'client_hiring',
    engagement: 'contract',
    relationship: 'independent',
    paid: true,
    evidence: [{ quote: 'paid independent contractor', meaning: 'explicit paid client-side engagement' }],
    reasonCodes: [],
    fit: validFit(),
    ...overrides,
  };
}

test('acceptance requires an eligible, confident, paid independent decision with verified evidence', () => {
  const item = candidate();
  const decision = validateDecision(validDecision(item.url), item);

  assert.equal(isAcceptedDecision(decision), true);
  assert.equal(decision.fit.score, 4.2);
});

test('fabricated evidence fails local validation', () => {
  const item = candidate('We need a contractor to build a dashboard.');

  assert.throws(
    () => validateDecision(validDecision(item.url, {
      evidence: [{ quote: 'budget is definitely $90/hr', meaning: 'invented budget' }],
    }), item),
    /evidence/i,
  );
});

test('eligible decisions require a complete A-F fit score', () => {
  const item = candidate();

  assert.throws(
    () => validateDecision(validDecision(item.url, {
      fit: { score: 4, blocks: { A: 5 }, reasons: [], redFlags: [], verdict: 'GO' },
    }), item),
    /blocks/i,
  );
});

test('score, block, confidence, and verdict bounds are enforced', () => {
  const item = candidate();
  assert.throws(() => validateDecision(validDecision(item.url, { confidence: 1.2 }), item), /confidence/i);
  assert.throws(() => validateDecision(validDecision(item.url, {
    fit: validFit({ blocks: { A: 6, B: 5, C: 4, D: 3, E: 3, F: 4 } }),
  }), item), /block A/i);
  assert.throws(() => validateDecision(validDecision(item.url, {
    fit: validFit({ score: 3.2, verdict: 'GO' }),
  }), item), /verdict/i);
});

test('part-time alone and low-confidence decisions never satisfy acceptance', () => {
  const item = candidate();
  const partTime = validateDecision(validDecision(item.url, { engagement: 'part_time' }), item);
  const uncertain = validateDecision({
    ...validDecision(item.url),
    eligibility: 'uncertain', confidence: 0.7, intent: 'unknown', engagement: 'unknown',
    relationship: 'unknown', paid: null, fit: null, reasonCodes: ['low_confidence'],
  }, item);

  assert.equal(isAcceptedDecision(partTime), false);
  assert.equal(isAcceptedDecision(uncertain), false);
});

test('rejected decisions must not include a fit score', () => {
  const item = candidate();
  assert.throws(() => validateDecision({
    ...validDecision(item.url), eligibility: 'rejected', intent: 'discussion', fit: validFit(),
  }, item), /rejected.*fit|fit.*rejected/i);
});

test('uncertain decisions must not carry an advisory fit score', () => {
  const item = candidate();
  assert.throws(() => validateDecision({
    ...validDecision(item.url), eligibility: 'uncertain', confidence: 0.7,
    intent: 'unknown', engagement: 'unknown', relationship: 'unknown', paid: null,
    fit: validFit(), reasonCodes: ['low_confidence'],
  }, item), /uncertain.*fit|fit.*uncertain/i);
});

test('decision list requires exactly one known unique URL per candidate', () => {
  const first = candidate();
  const second = normalizeCandidate({
    url: 'https://example.test/second', title: '[Hiring] API contractor',
    description: 'We need a paid independent contractor to build and deliver an API.', source: 'r/forhire',
  }, { provider: 'reddit', firstSeen: '2026-07-11' });
  const firstDecision = validDecision(first.url);
  const secondDecision = validDecision(second.url, {
    evidence: [{ quote: 'paid independent contractor', meaning: 'paid client request' }],
  });

  assert.equal(validateDecisionList([firstDecision, secondDecision], [first, second]).length, 2);
  assert.throws(() => validateDecisionList([firstDecision, firstDecision], [first, second]), /duplicate|missing/i);
  assert.throws(() => validateDecisionList([{ ...firstDecision, url: 'https://evil.test/' }, secondDecision], [first, second]), /unknown URL/i);
});
