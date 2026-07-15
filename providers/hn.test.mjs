import assert from 'node:assert/strict';
import test from 'node:test';

import provider, {
  normalizeFreelancerComments,
  normalizeWhoIsHiringComments,
  selectMonthlyStory,
  stripHtml,
} from './hn.mjs';

test('strips Hacker News comment HTML into readable text', () => {
  assert.equal(stripHtml('<p>Hello <b>world</b><br>again &amp; more</p>'), 'Hello world\nagain & more');
});

test('leaves numeric HTML entities outside the Unicode range unchanged', () => {
  assert.equal(stripHtml('Bad entity: &#x110000;'), 'Bad entity: &#x110000;');
});

test('normalizes SEEKING FREELANCER comments into demand-side gigs', () => {
  const gigs = normalizeFreelancerComments([
    { objectID: '42', author: 'founder', comment_text: '<p>SEEKING FREELANCER: React work</p>' },
    { objectID: '43', author: 'jobseeker', comment_text: '<p>Available freelancer: React work</p>' },
  ]);

  assert.deepEqual(gigs, [{
    title: 'SEEKING FREELANCER: React work',
    url: 'https://news.ycombinator.com/item?id=42',
    company: 'founder',
    poster: 'founder',
    location: '',
    description: 'SEEKING FREELANCER: React work',
  }]);
});

test('normalizes contract-friendly Who Is Hiring comments but excludes full-time-only posts', () => {
  const gigs = normalizeWhoIsHiringComments([
    { objectID: '10', author: 'agency', comment_text: '<p>We need a <em>part-time</em> contract designer.</p>' },
    { objectID: '11', author: 'corp', comment_text: '<p>Full-time only backend engineer role.</p>' },
    { objectID: '12', author: 'mixed', comment_text: '<p>Full-time team, but open to freelance help.</p>' },
  ]);

  assert.deepEqual(gigs.map(({ url, poster, description }) => ({ url, poster, description })), [
    {
      url: 'https://news.ycombinator.com/item?id=10',
      poster: 'agency',
      description: 'We need a part-time contract designer.',
    },
    {
      url: 'https://news.ycombinator.com/item?id=12',
      poster: 'mixed',
      description: 'Full-time team, but open to freelance help.',
    },
  ]);
});

test('selectMonthlyStory ignores newer fuzzy search hits and chooses the exact monthly thread', () => {
  const story = selectMonthlyStory([
    { objectID: 'wrong', title: 'Show HN: UI for Who is hiring posts' },
    { objectID: 'right', title: 'Ask HN: Who is hiring? (July 2026)' },
  ], 'whoishiring');

  assert.equal(story.objectID, 'right');
  assert.equal(selectMonthlyStory([{ objectID: 'wrong', title: 'Who is hiring developers?' }], 'whoishiring'), null);
});

test('fetches the newest story and only its top-level comments for the requested HN thread', async () => {
  const requests = [];
  const ctx = {
    async fetchJson(url) {
      requests.push(url);
      if (url.includes('search_by_date')) return { hits: [{ objectID: '100', title: 'Ask HN: Freelancer? Seeking freelancer? (July 2026)' }] };
      return { hits: [
        { objectID: '101', parent_id: 100, author: 'founder', comment_text: '<p>SEEKING FREELANCER: Node project</p>' },
        { objectID: '102', parent_id: 101, author: 'reply', comment_text: '<p>SEEKING FREELANCER: ignored reply</p>' },
      ] };
    },
  };

  const gigs = await provider.fetch({ thread: 'freelancer' }, ctx);

  assert.equal(requests.length, 2);
  assert.match(requests[0], /search_by_date/);
  assert.match(requests[1], /story_100/);
  assert.deepEqual(gigs.map(gig => gig.url), ['https://news.ycombinator.com/item?id=101']);
});

test('fetches Who Is Hiring through its story query and keeps eligible top-level contract comments', async () => {
  const requests = [];
  const ctx = {
    async fetchJson(url) {
      requests.push(new URL(url));
      if (url.includes('search_by_date')) return { hits: [
        { objectID: 'wrong', title: 'Show HN: UI for Who is hiring posts' },
        { objectID: '200', title: 'Ask HN: Who is hiring? (July 2026)' },
      ] };
      return { hits: [
        { objectID: '201', parent_id: 200, author: 'contractor', comment_text: '<p>Contract frontend work, 20 hours/week.</p>' },
        { objectID: '202', parent_id: 201, author: 'reply', comment_text: '<p>Freelance reply should be ignored.</p>' },
        { objectID: '203', parent_id: 200, author: 'corp', comment_text: '<p>Full-time only backend role.</p>' },
      ] };
    },
  };

  const gigs = await provider.fetch({ thread: 'whoishiring' }, ctx);

  assert.equal(requests.length, 2);
  assert.equal(requests[0].pathname, '/api/v1/search_by_date');
  assert.equal(requests[0].searchParams.get('query'), 'Ask HN: Who is hiring?');
  assert.equal(requests[0].searchParams.get('tags'), 'story');
  assert.equal(requests[1].pathname, '/api/v1/search');
  assert.equal(requests[1].searchParams.get('tags'), 'comment,story_200');
  assert.deepEqual(gigs.map(gig => gig.url), ['https://news.ycombinator.com/item?id=201']);
});
