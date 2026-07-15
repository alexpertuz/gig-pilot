import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_CONTENT_CHARS,
  candidateText,
  normalizeCandidate,
} from './contracts.mjs';

test('normalizeCandidate preserves the full post body and produces a stable content hash', () => {
  const offer = {
    url: 'https://www.reddit.com/r/forhire/comments/abc/react-checkout/',
    title: '[Hiring] React checkout contractor',
    description: 'We need a contractor to ship Stripe checkout. Budget is $90/hr.',
    source: 'r/forhire',
    budget: '$90/hr',
    paymentModel: 'hourly',
    poster: 'buyer',
  };
  const context = { provider: 'reddit', firstSeen: '2026-07-11' };

  const first = normalizeCandidate(offer, context);
  const second = normalizeCandidate({ ...offer }, context);

  assert.equal(first.description, offer.description);
  assert.equal(first.compensation.max, 90);
  assert.equal(first.compensation.cadence, 'hourly');
  assert.equal(first.contentHash, second.contentHash);
  assert.match(candidateText(first), /Stripe checkout/);
});

test('normalizeCandidate treats an annual salary as annual compensation', () => {
  const candidate = normalizeCandidate({
    url: 'https://jobs.example.test/frontend',
    title: 'Frontend Engineer — $180,000 per year',
    description: 'Full-time employee with benefits.',
  }, { provider: 'board', firstSeen: '2026-07-11' });

  assert.equal(candidate.compensation.max, 180000);
  assert.equal(candidate.compensation.cadence, 'annual');
});

test('normalizeCandidate does not interpret unrelated money as a project budget', () => {
  const candidate = normalizeCandidate({
    url: 'https://www.reddit.com/r/jobbit/comments/rent/',
    title: '27-F — need $1000 for rent!',
    description: 'I am short on rent and looking for help.',
  }, { provider: 'reddit', firstSeen: '2026-07-11' });

  assert.equal(candidate.compensation.cadence, 'unknown');
  assert.equal(candidate.compensation.max, 1000);
});

test('normalizeCandidate caps untrusted content and removes control characters', () => {
  const candidate = normalizeCandidate({
    url: 'https://example.test/large',
    title: 'Large post\u0000',
    description: `prefix\u0007${'a'.repeat(MAX_CONTENT_CHARS + 500)}`,
  }, { provider: 'test', firstSeen: '2026-07-11' });

  assert.ok(candidate.description.length <= MAX_CONTENT_CHARS);
  assert.doesNotMatch(candidate.title, /\u0000/);
  assert.doesNotMatch(candidate.description, /\u0007/);
});

test('normalizeCandidate rejects malformed and non-HTTP URLs', () => {
  assert.throws(
    () => normalizeCandidate({ url: 'javascript:alert(1)', title: 'Bad' }),
    /HTTP URL/i,
  );
  assert.throws(
    () => normalizeCandidate({ url: 'not a url', title: 'Bad' }),
    /HTTP URL/i,
  );
});

test('normalizeCandidate requires a non-empty title', () => {
  assert.throws(
    () => normalizeCandidate({ url: 'https://example.test/empty', title: '   ' }),
    /title/i,
  );
});
