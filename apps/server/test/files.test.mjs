import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePipeline, serializePipeline } from '../lib/files.mjs';

test('parsePipeline reads url | status | title', () => {
  const text = `# Pipeline\n\n## Pending\n\n- [ ] https://x.com/a | new | A gig\n- [x] https://x.com/b | evaluated | B gig\n`;
  const items = parsePipeline(text);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { url: 'https://x.com/a', status: 'new', title: 'A gig', checked: false });
  assert.equal(items[1].checked, true);
  assert.equal(items[1].status, 'evaluated');
});

test('parsePipeline tolerates bare url lines', () => {
  const items = parsePipeline('## Pending\n\n- [ ] https://x.com/c\n');
  assert.deepEqual(items[0], { url: 'https://x.com/c', status: null, title: null, checked: false });
});

test('serializePipeline round-trips and preserves header', () => {
  const original = `# Pipeline\n\nintro line\n\n## Pending\n\n- [ ] https://x.com/a | new | A gig\n`;
  const items = parsePipeline(original);
  items[0].status = 'evaluated';
  const out = serializePipeline(items, original);
  assert.match(out, /# Pipeline/);
  assert.match(out, /intro line/);
  assert.match(out, /- \[ \] https:\/\/x\.com\/a \| evaluated \| A gig/);
});
