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
