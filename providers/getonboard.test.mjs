import assert from 'node:assert/strict';
import test from 'node:test';

import provider, { normalizeJob } from './getonboard.mjs';

test('normalizes a public category job with budget and description', () => {
  const gig = normalizeJob({
    attributes: {
      title: 'Contract React developer',
      url: 'https://www.getonbrd.com/jobs/react',
      company: 'Acme',
      remote: true,
      salary: '$60/hr',
      description: '<p>Build a <strong>dashboard</strong></p>',
    },
  });

  assert.deepEqual(gig, {
    title: 'Contract React developer',
    url: 'https://www.getonbrd.com/jobs/react',
    company: 'Acme',
    poster: 'Acme',
    location: 'remote',
    description: 'Build a dashboard',
    budget: '$60/hr',
  });
});

test('normalizes JSON:API data wrappers and rejects non-HTTP job URLs', () => {
  const wrapped = normalizeJob({
    data: {
      attributes: {
        title: 'API contractor',
        url: 'https://www.getonbrd.com/jobs/api-contractor',
        company: { name: 'Northstar' },
        location: 'Bogotá',
        rate: 'COP 120000/hr',
        description: 'Maintain an API',
      },
    },
  });
  const invalidUrl = normalizeJob({ attributes: { title: 'Bad job', url: 'javascript:alert(1)' } });

  assert.equal(wrapped.poster, 'Northstar');
  assert.equal(wrapped.location, 'Bogotá');
  assert.equal(wrapped.budget, 'COP 120000/hr');
  assert.equal(invalidUrl, null);
});

test('normalizes the live JSON:API links.public_url shape', () => {
  const gig = normalizeJob({
    id: 'react-contract',
    type: 'job',
    links: { public_url: 'https://www.getonbrd.com/jobs/react-contract' },
    attributes: {
      title: 'React contractor',
      description: '<p>Independent project contract</p>',
      remote: true,
      min_salary: 2700,
      max_salary: 2900,
    },
  });

  assert.equal(gig.url, 'https://www.getonbrd.com/jobs/react-contract');
  assert.equal(gig.description, 'Independent project contract');
  assert.equal(gig.budget, '2700 - 2900');
});

test('fetches every configured category and rejects malformed category payloads descriptively', async () => {
  const urls = [];
  const ctx = {
    async fetchJson(url) {
      urls.push(url);
      return { data: [{ attributes: {
        title: 'Freelance platform work',
        url: `https://www.getonbrd.com/jobs/${urls.length}`,
        company_name: 'Platform Co',
      } }] };
    },
  };

  const gigs = await provider.fetch({ categories: ['programming', 'design'] }, ctx);
  assert.deepEqual(urls, [
    'https://www.getonbrd.com/api/v0/categories/programming/jobs',
    'https://www.getonbrd.com/api/v0/categories/design/jobs',
  ]);
  assert.equal(gigs.length, 2);

  await assert.rejects(
    provider.fetch({ categories: ['programming'] }, { async fetchJson() { return { data: {} }; } }),
    /getonboard: unexpected API response.*data array/i,
  );
});
