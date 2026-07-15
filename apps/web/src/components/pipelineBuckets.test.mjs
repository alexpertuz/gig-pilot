import test from 'node:test';
import assert from 'node:assert/strict';

import { partitionPipelineItems } from './pipelineBuckets.mjs';

function item(url, overrides = {}) {
  return {
    url,
    status: null,
    score: null,
    state: null,
    eligibility: 'uncertain',
    jobSeeker: false,
    ...overrides,
  };
}

const strongBlocks = { A: 5, B: 5, C: 4, D: 3, E: 3, F: 4 };

test('partitionPipelineItems keeps only confirmed score-three-plus gigs active', () => {
  const result = partitionPipelineItems([
    item('go', { eligibility: 'eligible', state: 'evaluated', score: 4.4, verdict: 'GO', blocks: strongBlocks }),
    item('review', { eligibility: 'eligible', state: 'evaluated', score: 3.2, verdict: 'NEGOTIATE', blocks: strongBlocks }),
    item('low', { eligibility: 'eligible', state: 'evaluated', score: 2.8, verdict: 'DECLINE', blocks: strongBlocks }),
    item('off-profile', { eligibility: 'eligible', state: 'evaluated', score: 4.7, verdict: 'GO', blocks: { ...strongBlocks, A: 1 } }),
    item('budget-blocked', { eligibility: 'eligible', state: 'evaluated', score: 3.4, verdict: 'DECLINE', blocks: { ...strongBlocks, B: 1 } }),
    item('legacy', { score: 4.8, state: 'estimated' }),
    item('offline', { eligibility: 'uncertain', triageReasons: ['model_unavailable'] }),
    item('discussion', { eligibility: 'rejected', triageReasons: ['discussion'] }),
    item('manual-pass', { eligibility: 'eligible', state: 'evaluated', score: 4.9, verdict: 'GO', blocks: strongBlocks, status: 'dropped' }),
  ]);

  assert.deepEqual(result.active.map((entry) => entry.url), ['go', 'review']);
  assert.deepEqual(result.lowFit.map((entry) => entry.url), ['off-profile', 'budget-blocked', 'low']);
  assert.deepEqual(result.quarantine.map((entry) => entry.url), ['legacy', 'offline']);
  assert.deepEqual(result.rejected.map((entry) => entry.url), ['manual-pass', 'discussion']);
});

test('partitionPipelineItems excludes worker-seeking records even if legacy fields look strong', () => {
  const result = partitionPipelineItems([
    item('seeker', { jobSeeker: true, score: 5, state: 'evaluated', eligibility: 'eligible' }),
  ]);

  assert.equal(result.active.length, 0);
  assert.equal(result.lowFit.length, 0);
  assert.equal(result.quarantine.length, 0);
  assert.deepEqual(result.rejected.map((entry) => entry.url), ['seeker']);
});
