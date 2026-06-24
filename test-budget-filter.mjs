#!/usr/bin/env node
// @ts-check
/**
 * Test suite for the freelance budget filter.
 * Run: node test-budget-filter.mjs
 *
 * Tests cover:
 *   - parseBudget: hourly vs fixed detection, ranges, junk input
 *   - buildBudgetFilter: hourly/project floors, exclude_unpaid, conservative pass-through
 */

import { parseBudget, buildBudgetFilter } from './scan.mjs';

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

// ── parseBudget ──────────────────────────────────────────────────────
section('parseBudget');

assert(parseBudget('$50/hr').hourly === 50, '$50/hr → hourly 50');
assert(parseBudget('$50/hr').fixed === null, '$50/hr → fixed null');
assert(parseBudget('$120 / hour').hourly === 120, '$120 / hour → hourly 120');
assert(parseBudget('80 USD hourly').hourly === 80, '80 USD hourly → hourly 80');
assert(parseBudget('$500').fixed === 500, '$500 → fixed 500');
assert(parseBudget('$500').hourly === null, '$500 → hourly null');
assert(parseBudget('$2,500 fixed').fixed === 2500, '$2,500 fixed → fixed 2500 (comma stripped)');
assert(parseBudget('$40-60/hr').hourly === 40, '$40-60/hr → hourly 40 (lower bound)');
assert(parseBudget('negotiable').hourly === null && parseBudget('negotiable').fixed === null, 'negotiable → no numbers');
assert(parseBudget('').hourly === null, 'empty string → null');
assert(parseBudget(undefined).hourly === null, 'undefined → null');

// ── buildBudgetFilter: hourly floor ──────────────────────────────────
section('buildBudgetFilter — hourly floor');

const hourlyFilter = buildBudgetFilter({ min_hourly: 30, min_project: 0, exclude_unpaid: false });
assert(hourlyFilter({ budget: '$50/hr', paymentModel: 'hourly' }) === true, '$50/hr passes min_hourly 30');
assert(hourlyFilter({ budget: '$20/hr', paymentModel: 'hourly' }) === false, '$20/hr fails min_hourly 30');
assert(hourlyFilter({ budget: '$30/hr', paymentModel: 'hourly' }) === true, '$30/hr meets min_hourly 30 (inclusive)');
assert(hourlyFilter({ budget: '$200 fixed', paymentModel: 'fixed' }) === true, 'fixed budget ignored by hourly-only floor');
assert(hourlyFilter({ budget: undefined, paymentModel: 'unknown' }) === true, 'no budget signal passes conservatively');

// ── buildBudgetFilter: project floor ─────────────────────────────────
section('buildBudgetFilter — project floor');

const projectFilter = buildBudgetFilter({ min_hourly: 0, min_project: 200, exclude_unpaid: false });
assert(projectFilter({ budget: '$500', paymentModel: 'fixed' }) === true, '$500 passes min_project 200');
assert(projectFilter({ budget: '$100', paymentModel: 'fixed' }) === false, '$100 fails min_project 200');
assert(projectFilter({ budget: '$50/hr', paymentModel: 'hourly' }) === true, 'hourly budget ignored by project-only floor');

// ── buildBudgetFilter: exclude_unpaid ────────────────────────────────
section('buildBudgetFilter — exclude_unpaid');

const unpaidFilter = buildBudgetFilter({ min_hourly: 0, min_project: 0, exclude_unpaid: true });
assert(unpaidFilter({ paymentModel: 'unpaid' }) === false, 'unpaid gig dropped');
assert(unpaidFilter({ paymentModel: 'equity' }) === false, 'equity-only gig dropped');
assert(unpaidFilter({ paymentModel: 'hourly', budget: '$50/hr' }) === true, 'paid gig kept');
assert(unpaidFilter({ paymentModel: 'unknown' }) === true, 'unknown payment model kept');

// exclude_unpaid defaults to true when omitted
const defaultFilter = buildBudgetFilter({ min_hourly: 10 });
assert(defaultFilter({ paymentModel: 'unpaid' }) === false, 'exclude_unpaid defaults to true');

// ── buildBudgetFilter: no-op config ──────────────────────────────────
section('buildBudgetFilter — no-op');

const noop = buildBudgetFilter({ min_hourly: 0, min_project: 0, exclude_unpaid: false });
assert(noop({ paymentModel: 'unpaid' }) === true, 'fully disabled filter passes everything');
assert(buildBudgetFilter(undefined)({ paymentModel: 'unpaid' }) === false, 'undefined config still excludes unpaid (default)');

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
