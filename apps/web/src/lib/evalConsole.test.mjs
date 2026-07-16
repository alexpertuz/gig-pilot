import test from 'node:test';
import assert from 'node:assert/strict';

import { EVAL_PHASES, nextPhaseIndex, resolveReportFile } from './evalConsole.mjs';

test('EVAL_PHASES is a non-empty ordered list ending with the report phrase', () => {
  assert.ok(EVAL_PHASES.length >= 5);
  assert.equal(EVAL_PHASES[0], 'Reading the posting…');
  assert.equal(EVAL_PHASES[EVAL_PHASES.length - 1], 'Writing your report…');
});

test('nextPhaseIndex advances by one', () => {
  assert.equal(nextPhaseIndex(0, EVAL_PHASES.length), 1);
  assert.equal(nextPhaseIndex(2, EVAL_PHASES.length), 3);
});

test('nextPhaseIndex caps at the last index and does not wrap', () => {
  const last = EVAL_PHASES.length - 1;
  assert.equal(nextPhaseIndex(last - 1, EVAL_PHASES.length), last);
  assert.equal(nextPhaseIndex(last, EVAL_PHASES.length), last);
});

test('resolveReportFile returns the stripped path for a matching url', () => {
  const items = [{ url: 'https://x/1', report: 'reports/007-foo-2026-07-16.md' }];
  assert.equal(resolveReportFile(items, 'https://x/1'), '007-foo-2026-07-16.md');
});

test('resolveReportFile keeps an already-stripped path unchanged', () => {
  const items = [{ url: 'https://x/1', report: '007-foo.md' }];
  assert.equal(resolveReportFile(items, 'https://x/1'), '007-foo.md');
});

test('resolveReportFile returns null when the url is absent', () => {
  const items = [{ url: 'https://x/1', report: 'reports/007-foo.md' }];
  assert.equal(resolveReportFile(items, 'https://x/2'), null);
});

test('resolveReportFile returns null when the item has no report', () => {
  const items = [{ url: 'https://x/1', report: null }];
  assert.equal(resolveReportFile(items, 'https://x/1'), null);
});

test('resolveReportFile tolerates empty or invalid inputs', () => {
  assert.equal(resolveReportFile(null, 'https://x/1'), null);
  assert.equal(resolveReportFile([], null), null);
  assert.equal(resolveReportFile([null, undefined], 'https://x/1'), null);
});
