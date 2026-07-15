import assert from 'node:assert/strict';
import test from 'node:test';

const meta = await import('./pipelineMeta.mjs').catch(() => ({}));

test('identifies subreddit sources as Reddit while retaining the subreddit', () => {
  assert.equal(typeof meta.sourceIdentity, 'function');
  assert.deepEqual(meta.sourceIdentity('r/forhire'), {
    family: 'reddit',
    label: 'Reddit',
    detail: 'r/forhire',
    initial: 'R',
  });
});

test('creates a deterministic fallback for a user-defined source', () => {
  assert.equal(typeof meta.sourceIdentity, 'function');
  assert.deepEqual(meta.sourceIdentity('  Indie Gigs  '), {
    family: 'generic',
    label: 'Indie Gigs',
    detail: '',
    initial: 'I',
  });
});

test('uses a generic source fallback when the source is missing', () => {
  assert.equal(typeof meta.sourceIdentity, 'function');
  assert.deepEqual(meta.sourceIdentity(null), {
    family: 'generic',
    label: 'Source',
    detail: '',
    initial: '↗',
  });
});

test('formats relative age, local date, and 24-hour time', () => {
  assert.equal(typeof meta.formatPostedAt, 'function');
  assert.deepEqual(meta.formatPostedAt('2026-06-24T14:35:00.000Z', Date.parse('2026-07-10T12:00:00.000Z')), {
    relative: '16 days ago',
    date: 'Jun 24, 2026',
    time: '14:35',
    freshness: 'aged',
  });
});

test('omits all posting-time metadata for invalid timestamps', () => {
  assert.equal(typeof meta.formatPostedAt, 'function');
  assert.equal(meta.formatPostedAt('not-a-date'), null);
  assert.equal(meta.formatPostedAt(null), null);
});
