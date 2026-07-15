import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBudget } from './score-heuristic.mjs';

test('parseBudget reads an hourly range', () => {
  const b = parseBudget('[Hiring] Graphic Designer contract $25 - $35/hourly');
  assert.equal(b.unit, 'hourly');
  assert.equal(b.min, 25);
  assert.equal(b.max, 35);
});

test('parseBudget reads a single hourly rate', () => {
  const b = parseBudget('data annotation remote $20/hr');
  assert.equal(b.unit, 'hourly');
  assert.equal(b.max, 20);
});

test('parseBudget reads a project amount', () => {
  const b = parseBudget('need a floor plan rendered, budget $100');
  assert.equal(b.unit, 'project');
  assert.equal(b.max, 100);
});

test('parseBudget marks a yearly salary range as annual', () => {
  const b = parseBudget('[HIRING] DevOps Engineer - US [$240,000 - 300,000 / year]');
  assert.equal(b.unit, 'annual');
  assert.equal(b.max, 240000);
});

test('parseBudget marks "per year" as annual', () => {
  const b = parseBudget('Senior engineer, $180,000 per year, full benefits');
  assert.equal(b.unit, 'annual');
});

test('parseBudget keeps hourly when both hourly and annual appear', () => {
  const b = parseBudget('contract $90/hr (roughly $180,000 a year)');
  assert.equal(b.unit, 'hourly');
});

test('parseBudget returns null when no money is present', () => {
  assert.equal(parseBudget('dialogue editor for audio drama, long-term'), null);
});

import { scoreGig } from './score-heuristic.mjs';

const PROFILE = {
  services: { primary: ['Full-stack development'] },
  archetypes: [
    { name: 'Frontend', stack: ['React.js', 'Next.js', 'Node.js'] },
    { name: 'Backend', stack: ['Node.js', 'FastAPI', 'Python', 'PostgreSQL'] },
  ],
  rate_card: {
    hourly: { target: 75, walk_away: 40 },
    project: { min: 500 },
    declined_models: ['unpaid', 'equity', 'revenue_share'],
  },
  ideal_gig: {
    green_flags: ['clear scope', 'ongoing'],
    yellow_flags: ['quick', 'just need', 'simple'],
    avoid_scope: ['unpaid test task'],
  },
};

test('scoreGig hard-declines an unpaid gig regardless of fit', () => {
  const r = scoreGig(
    { title: 'React dev needed for equity only, no budget', body: '', source: 'r/forhire', firstSeen: '2026-07-06' },
    PROFILE,
  );
  assert.equal(r.verdict, 'DECLINE');
  assert.ok(r.redFlags.length >= 1);
});

test('scoreGig flags a job-seeker post as decline', () => {
  const r = scoreGig(
    { title: '21M looking for work, any job', body: '', source: 'r/jobbit', firstSeen: '2026-07-01' },
    PROFILE,
  );
  assert.equal(r.verdict, 'DECLINE');
  assert.equal(r.jobSeeker, true);
  assert.ok(r.redFlags.some((f) => /job-seeker/i.test(f)));
});

test('scoreGig does not mark a hiring post as a job-seeker', () => {
  const r = scoreGig(
    { title: '[Hiring] React + Node dashboard, ongoing, $90/hr', body: 'clear scope', source: 'r/forhire', firstSeen: '2026-07-06' },
    PROFILE,
  );
  assert.equal(r.jobSeeker, false);
});

test('scoreGig rewards a well-paid on-archetype gig', () => {
  const r = scoreGig(
    { title: '[Hiring] React + Node dashboard, ongoing, $90/hr', body: 'clear scope', source: 'r/forhire', firstSeen: '2026-07-06' },
    PROFILE,
  );
  assert.ok(r.score >= 4.0, `expected GO-range score, got ${r.score}`);
  assert.equal(r.verdict, 'GO');
  assert.ok(r.reasons.some((x) => /archetype|React|Node/i.test(x)));
});

test('scoreGig scores a salaried full-time posting as decline, not a big project', () => {
  const r = scoreGig(
    { title: '[HIRING] Frontend React/Web3 Engineer [$180,000 - 240,000 / year]', body: '', source: 'r/jobbit', firstSeen: '2026-07-06' },
    PROFILE,
  );
  assert.ok(r.blocks.B <= 2, `budget block should be low for a salary, got ${r.blocks.B}`);
  assert.ok(r.redFlags.some((f) => /salar|full-time|employment/i.test(f)), `expected employment red flag, got ${JSON.stringify(r.redFlags)}`);
  assert.equal(r.verdict, 'DECLINE');
});

test('scoreGig marks below-walk-away rate as negotiate-or-lower', () => {
  const r = scoreGig(
    { title: '[Hiring] React work $20/hr', body: '', source: 'r/forhire', firstSeen: '2026-07-06' },
    PROFILE,
  );
  assert.ok(r.blocks.B <= 2, `budget block should be low, got ${r.blocks.B}`);
  assert.ok(r.reasons.some((x) => /walk-away|below/i.test(x)));
});

test('scoreGig raises Block E by 0.75 for tier 1 after channel scoring', () => {
  const neutral = scoreGig(
    { title: '[Hiring] React dashboard $90/hr', body: 'email hello@example.test', firstSeen: '2026-07-06' },
    PROFILE,
  );
  const priorityOne = scoreGig(
    { title: '[Hiring] React dashboard $90/hr', body: 'email hello@example.test', firstSeen: '2026-07-06' },
    PROFILE,
    1,
  );
  assert.equal(neutral.blocks.E, 4);
  assert.equal(priorityOne.blocks.E, 4.75);
});

test('scoreGig lowers Block E by 0.75 for tier 3 within the 1–5 clamp', () => {
  const priorityThree = scoreGig(
    { title: '[Hiring] React dashboard $90/hr', body: '', firstSeen: '2026-07-06' },
    PROFILE,
    3,
  );
  assert.equal(priorityThree.blocks.E, 2.25);
  assert.ok(priorityThree.blocks.E >= 1 && priorityThree.blocks.E <= 5);
});

import { scoreAll } from './score-heuristic.mjs';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('scoreAll writes one scored entry per pipeline url', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gigscore-'));
  const pipeline = join(dir, 'pipeline.md');
  const history = join(dir, 'scan-history.tsv');
  const profile = join(dir, 'profile.yml');
  const scores = join(dir, 'scores.json');

  await writeFile(
    pipeline,
    '# Pipeline\n## Pending\n- [ ] https://x.test/a |  | [Hiring] React + Node dev $90/hr\n- [ ] https://x.test/b |  | 21M looking for work\n',
  );
  await writeFile(
    history,
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n' +
      'https://x.test/a\t2026-07-06\treddit-api\t[Hiring] React + Node dev $90/hr\t\tadded\tremote\n',
  );
  await writeFile(
    profile,
    'archetypes:\n  - name: FE\n    stack: ["React.js", "Node.js"]\nrate_card:\n  hourly:\n    target: 75\n    walk_away: 40\n',
  );

  const out = await scoreAll({ pipelinePath: pipeline, scanHistoryPath: history, profilePath: profile, scoresPath: scores });
  assert.equal(Object.keys(out).length, 2);
  assert.equal(out['https://x.test/a'].verdict, 'GO');
  assert.equal(out['https://x.test/b'].verdict, 'DECLINE');
  assert.equal(out['https://x.test/a'].state, 'estimated');

  const onDisk = JSON.parse(await readFile(scores, 'utf8'));
  assert.equal(onDisk['https://x.test/a'].score, out['https://x.test/a'].score);
});

test('scoreAll reads pipeline tiers and scan-history priority into derived scores', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gigscore-priority-'));
  const pipeline = join(dir, 'pipeline.md');
  const history = join(dir, 'scan-history.tsv');
  const profile = join(dir, 'profile.yml');
  const scores = join(dir, 'scores.json');

  await writeFile(
    pipeline,
    '# Pipeline\n## Pending\n- [ ] https://x.test/tier-one |  | [Hiring] React $90/hr | relevance:1 tier:1\n- [ ] https://x.test/history-tier-three |  | [Hiring] React $90/hr | relevance:1 tier:1\n',
  );
  await writeFile(
    history,
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tpriority\n' +
      'https://x.test/history-tier-three\t2026-07-06\treddit-api\t[Hiring] React $90/hr\t\tadded\tremote\t3\n',
  );
  await writeFile(profile, 'archetypes:\n  - stack: ["React.js"]\n');

  const out = await scoreAll({ pipelinePath: pipeline, scanHistoryPath: history, profilePath: profile, scoresPath: scores });
  assert.equal(out['https://x.test/tier-one'].priority, 1);
  assert.equal(out['https://x.test/tier-one'].blocks.E, 3.75);
  assert.equal(out['https://x.test/history-tier-three'].priority, 3);
  assert.equal(out['https://x.test/history-tier-three'].blocks.E, 2.25);
});
