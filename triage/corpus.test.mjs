import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { normalizeCandidate } from './contracts.mjs';
import { applyRuleGate } from './rules.mjs';

const PROFILE = {
  rate_card: {
    hourly: { target: 75, walk_away: 40 },
    project: { min: 500 },
    declined_models: ['unpaid', 'equity', 'revenue_share'],
  },
};

async function loadCorpus() {
  const url = new URL('./fixtures/relevance-corpus.json', import.meta.url);
  return JSON.parse(await readFile(url, 'utf8'));
}

test('relevance corpus contains at least 200 unique reviewed cases', async () => {
  const corpus = await loadCorpus();
  assert.ok(corpus.length >= 200, `expected at least 200 cases, got ${corpus.length}`);
  assert.equal(new Set(corpus.map((item) => item.id)).size, corpus.length);
  assert.ok(corpus.some((item) => item.language === 'es'));
  assert.ok(corpus.some((item) => item.language === 'en'));
  assert.ok(corpus.some((item) => item.expected === 'survivor'));
  assert.ok(corpus.some((item) => item.expected === 'reject'));
  assert.ok(corpus.some((item) => item.expected === 'quarantine'));
  assert.ok(corpus.some((item) => item.expected === 'survivor' && item.expectedActive === false));
});

test('every reviewed corpus case produces its declared deterministic state', async () => {
  const corpus = await loadCorpus();
  const mismatches = [];
  for (const item of corpus) {
    const candidate = normalizeCandidate({
      url: `https://corpus.example.test/${item.id}`,
      title: item.title,
      description: item.description,
      source: item.source,
      budget: item.budget,
      paymentModel: item.paymentModel,
    }, { provider: item.source.startsWith('r/') ? 'reddit' : 'fixture', firstSeen: '2026-07-11' });
    const actual = applyRuleGate(candidate, PROFILE).state;
    if (actual !== item.expected) mismatches.push(`${item.id}: expected ${item.expected}, received ${actual}`);
  }
  assert.deepEqual(mismatches, []);
});
