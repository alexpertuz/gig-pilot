import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNode } from '../lib/cli.mjs';

test('runNode captures stdout and streams lines', async () => {
  const seen = [];
  const res = await runNode('-e', ["console.log('hello'); console.log('world')"], {
    onLine: (l) => seen.push(l),
  });
  assert.equal(res.code, 0);
  assert.deepEqual(seen, ['hello', 'world']);
});
