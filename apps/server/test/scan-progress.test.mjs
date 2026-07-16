import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatScanProgressEvent } from '../../../scan.mjs';

test('formatScanProgressEvent emits a machine-readable source progress line', () => {
  const line = formatScanProgressEvent({
    name: 'RemoteOK',
    completed: 3,
    total: 9,
    jobsInspected: 42,
  });

  assert.match(line, /^::gig-pilot-scan::/);
  assert.deepEqual(JSON.parse(line.replace(/^::gig-pilot-scan::/, '')), {
    type: 'source',
    name: 'RemoteOK',
    completed: 3,
    total: 9,
    jobsInspected: 42,
  });
});
