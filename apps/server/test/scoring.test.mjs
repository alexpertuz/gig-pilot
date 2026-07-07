import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePipeline } from '../lib/files.mjs';

test('mergePipeline enriches items and leaves unscored ones with nulls', () => {
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

  const merged = mergePipeline(items, scores, history);
  const a = merged.find((i) => i.url === 'https://x.test/a');
  const b = merged.find((i) => i.url === 'https://x.test/b');

  assert.equal(a.score, 4.3);
  assert.equal(a.verdict, 'GO');
  assert.equal(a.title, 'A real');
  assert.equal(a.firstSeen, '2026-07-06');
  assert.equal(b.score, null);
  assert.equal(b.verdict, null);
  assert.equal(b.title, 'B hist'); // falls back to history title
  assert.equal(b.firstSeen, '2026-05-01');
});
