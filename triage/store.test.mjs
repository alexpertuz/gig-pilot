import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readDerivedState, writeDerivedStateAtomic } from './store.mjs';

async function fixturePaths() {
  const dir = await mkdtemp(path.join(tmpdir(), 'gig-triage-store-'));
  return {
    candidates: path.join(dir, 'candidates.json'),
    triage: path.join(dir, 'triage.json'),
    scores: path.join(dir, 'scores.json'),
  };
}

test('readDerivedState treats absent files as empty derived state', async () => {
  const state = await readDerivedState(await fixturePaths());
  assert.deepEqual(state.candidates, {});
  assert.deepEqual(state.triage, {});
  assert.deepEqual(state.scores, {});
  assert.deepEqual(state.issues, []);
});

test('writeDerivedStateAtomic round-trips complete JSON documents', async () => {
  const paths = await fixturePaths();
  const expected = {
    candidates: { 'https://x.test/': { title: 'X' } },
    triage: { 'https://x.test/': { eligibility: 'eligible' } },
    scores: { 'https://x.test/': { score: 4.2 } },
  };

  await writeDerivedStateAtomic(paths, expected);
  const actual = await readDerivedState(paths);

  assert.deepEqual(actual, { ...expected, issues: [] });
  assert.equal(JSON.parse(await readFile(paths.triage, 'utf8'))['https://x.test/'].eligibility, 'eligible');
});

test('readDerivedState isolates corrupt files and reports precise issues', async () => {
  const paths = await fixturePaths();
  await writeFile(paths.candidates, '{broken', 'utf8');
  await writeFile(paths.triage, '{}', 'utf8');
  await writeFile(paths.scores, '{}', 'utf8');

  const state = await readDerivedState(paths);

  assert.deepEqual(state.candidates, {});
  assert.equal(state.issues.length, 1);
  assert.match(state.issues[0], /candidates\.json.*invalid JSON/i);
});
