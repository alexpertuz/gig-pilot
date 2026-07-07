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
  assert.ok(r.redFlags.some((f) => /job-seeker/i.test(f)));
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

test('scoreGig marks below-walk-away rate as negotiate-or-lower', () => {
  const r = scoreGig(
    { title: '[Hiring] React work $20/hr', body: '', source: 'r/forhire', firstSeen: '2026-07-06' },
    PROFILE,
  );
  assert.ok(r.blocks.B <= 2, `budget block should be low, got ${r.blocks.B}`);
  assert.ok(r.reasons.some((x) => /walk-away|below/i.test(x)));
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
