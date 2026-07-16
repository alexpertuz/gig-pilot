import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatTriageProgressEvent,
  mergeTriageDerivedState,
  offerToTriageCandidate,
  parseTriageOptions,
  rankTriagedOffers,
  selectOffersForTriageMode,
} from './scan.mjs';

test('parseTriageOptions uses enforced mode and the configured active provider by default', () => {
  assert.deepEqual(parseTriageOptions([], { GIGPILOT_AGENT_PROVIDER: 'codex' }), {
    mode: 'enforced',
    provider: 'codex',
    reclassify: false,
  });
  assert.deepEqual(parseTriageOptions([
    '--triage-mode=shadow', '--agent-provider=claude', '--reclassify',
  ], {}), {
    mode: 'shadow',
    provider: 'claude',
    reclassify: true,
  });
  assert.throws(() => parseTriageOptions(['--triage-mode=unsafe'], {}), /triage mode/i);
});

test('rankTriagedOffers puts validated profile fit ahead of keyword relevance', () => {
  const offers = [
    { url: 'https://x.test/off-profile', relevance: 5, priority: 1, _sourceOrder: 0, _offerOrder: 0 },
    { url: 'https://x.test/software', relevance: 0, priority: 2, _sourceOrder: 1, _offerOrder: 0 },
    { url: 'https://x.test/unscored', relevance: 9, priority: 1, _sourceOrder: 0, _offerOrder: 1 },
  ];
  const scores = {
    'https://x.test/off-profile': { score: 4.7, verdict: 'GO', blocks: { A: 1, B: 5 } },
    'https://x.test/software': { score: 4.4, verdict: 'GO', blocks: { A: 5, B: 5 } },
  };

  assert.deepEqual(rankTriagedOffers(offers, scores).map((offer) => offer.url), [
    'https://x.test/software',
    'https://x.test/off-profile',
    'https://x.test/unscored',
  ]);
});

test('offerToTriageCandidate preserves provider body and channel identity', () => {
  const candidate = offerToTriageCandidate({
    url: 'https://www.reddit.com/r/forhire/comments/abc/gig/',
    title: '[Hiring] React contractor — $90/hr',
    description: 'We need a contractor to build checkout.',
    source: 'reddit-api',
    channelSource: 'r/forhire',
    provider: 'reddit',
    budget: '$90/hr',
  }, '2026-07-11');

  assert.equal(candidate.description, 'We need a contractor to build checkout.');
  assert.equal(candidate.source, 'r/forhire');
  assert.equal(candidate.provider, 'reddit');
});

test('enforced mode selects only model-accepted offer URLs', () => {
  const offers = [
    { url: 'https://x.test/good' },
    { url: 'https://x.test/rejected' },
    { url: 'https://x.test/uncertain' },
  ];
  const triage = { accepted: [{ url: 'https://x.test/good' }] };

  assert.deepEqual(selectOffersForTriageMode(offers, triage, 'enforced'), [offers[0]]);
  assert.deepEqual(selectOffersForTriageMode(offers, triage, 'shadow'), offers);
});

test('formatTriageProgressEvent emits complete machine-readable quality metrics', () => {
  const line = formatTriageProgressEvent({
    fetched: 40,
    ruleRejected: 25,
    modelEvaluated: 10,
    cached: 2,
    accepted: 4,
    quarantined: 11,
    bySource: {
      'r/forhire': { fetched: 20, accepted: 4, rejected: 5, quarantined: 11 },
    },
  });

  assert.match(line, /^::gig-pilot-scan::/);
  assert.deepEqual(JSON.parse(line.replace(/^::gig-pilot-scan::/, '')), {
    type: 'triage', fetched: 40, ruleRejected: 25, modelEvaluated: 10,
    cached: 2, accepted: 4, quarantined: 11,
    bySource: {
      'r/forhire': { fetched: 20, accepted: 4, rejected: 5, quarantined: 11 },
    },
  });
});

test('mergeTriageDerivedState removes stale scores for processed rejects and preserves unrelated cache', () => {
  const merged = mergeTriageDerivedState({
    candidates: { 'https://old.test/': { title: 'Old' } },
    triage: { 'https://old.test/': { eligibility: 'eligible' } },
    scores: {
      'https://old.test/': { score: 4 },
      'https://x.test/rejected': { score: 3.4, state: 'estimated' },
    },
  }, {
    candidates: {
      'https://x.test/rejected': { title: 'Rejected' },
      'https://x.test/accepted': { title: 'Accepted' },
    },
    decisions: {
      'https://x.test/rejected': { eligibility: 'rejected' },
      'https://x.test/accepted': { eligibility: 'eligible' },
    },
    scores: { 'https://x.test/accepted': { score: 4.5, state: 'evaluated' } },
  });

  assert.equal(merged.scores['https://x.test/rejected'], undefined);
  assert.equal(merged.scores['https://x.test/accepted'].score, 4.5);
  assert.equal(merged.scores['https://old.test/'].score, 4);
  assert.equal(merged.triage['https://x.test/rejected'].eligibility, 'rejected');
});
