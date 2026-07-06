#!/usr/bin/env node
// Standalone test for agent-inbox.mjs: add → list → resolve round-trip
// against a throwaway inbox file (GIG_OPS_INBOX override), so it never
// touches the real data/agent-inbox.md.
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, 'agent-inbox.mjs');

let passed = 0, failed = 0;
const pass = (m) => { console.log(`  ✅ ${m}`); passed++; };
const fail = (m) => { console.log(`  ❌ ${m}`); failed++; };

const dir = mkdtempSync(join(tmpdir(), 'gigops-inbox-'));
const inbox = join(dir, 'agent-inbox.md');
const run = (args) =>
  execFileSync('node', [SCRIPT, ...args], {
    env: { ...process.env, GIG_OPS_INBOX: inbox },
    encoding: 'utf-8',
  });

try {
  // add
  run(['add', 'https://www.reddit.com/r/forhire/comments/abc/def/', 'react gig']);
  if (existsSync(inbox)) pass('add creates the inbox file');
  else fail('add did not create the inbox file');

  const afterAdd = readFileSync(inbox, 'utf-8');
  if (afterAdd.includes('react gig') && afterAdd.includes('r/forhire'))
    pass('added item is persisted with note + url');
  else fail('added item missing from inbox file');

  // list shows the item as pending
  const listed = run(['list']);
  if (listed.includes('react gig')) pass('list shows the pending item');
  else fail('list did not show the item');

  // resolve marks it done (checkbox flips to [x])
  run(['resolve', '1']);
  const afterResolve = readFileSync(inbox, 'utf-8');
  if (/\[x\]/i.test(afterResolve)) pass('resolve marks the item done');
  else fail('resolve did not mark the item done');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
