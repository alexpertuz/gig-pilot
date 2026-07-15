import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScanArgs } from '../routes/scan.mjs';

test('buildScanArgs propagates the selected provider without duplicating flags', () => {
  assert.deepEqual(buildScanArgs([], 'codex'), ['--agent-provider=codex']);
  assert.deepEqual(
    buildScanArgs(['--dry-run', '--agent-provider=claude'], 'codex'),
    ['--dry-run', '--agent-provider=codex'],
  );
  assert.throws(() => buildScanArgs([], 'unknown'), /unknown agent provider/i);
});
