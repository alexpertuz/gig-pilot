#!/usr/bin/env node
// Test detect-reposts against a fixture scan-history.tsv via
// GIG_PILOT_SCAN_HISTORY. Verifies (a) a Reddit gig reposted under two
// permalinks in the same subreddit is detected despite an empty company
// column, and (b) an unrelated title in the same subreddit is NOT merged.
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { posterFromUrl, redditBucketFromUrl } from './detect-reposts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, 'detect-reposts.mjs');

let passed = 0, failed = 0;
const pass = (m) => { console.log(`  ✅ ${m}`); passed++; };
const fail = (m) => { console.log(`  ❌ ${m}`); failed++; };

// unit: URL helpers
if (redditBucketFromUrl('https://www.reddit.com/r/forhire/comments/a/x/') === 'r/forhire')
  pass('redditBucketFromUrl extracts subreddit'); else fail('redditBucketFromUrl');
if (posterFromUrl('https://www.reddit.com/r/forhire/comments/a/x/') === '')
  pass('posterFromUrl is empty for post permalinks'); else fail('posterFromUrl permalink');
if (posterFromUrl('https://www.reddit.com/u/janedev') === 'u/janedev')
  pass('posterFromUrl extracts /u/ author'); else fail('posterFromUrl user');

// integration: fixture history. status MUST be 'added' — scan.mjs's history
// vocabulary and the detector's filter both key on it.
const dir = mkdtempSync(join(tmpdir(), 'gigpilot-reposts-'));
const hist = join(dir, 'scan-history.tsv');
const H = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n';
const rows = [
  // same gig, two permalinks, same subreddit, empty company -> should group
  ['https://www.reddit.com/r/forhire/comments/a1/x/', '2026-06-01', 'reddit-api', '[Hiring] React developer for dashboard', '', 'added', 'remote'],
  ['https://www.reddit.com/r/forhire/comments/b2/x/', '2026-06-08', 'reddit-api', '[Hiring] React developer for dashboard', '', 'added', 'remote'],
  // unrelated gig, same subreddit -> should NOT merge with the above
  ['https://www.reddit.com/r/forhire/comments/c3/x/', '2026-06-09', 'reddit-api', '[Hiring] Rust systems audit', '', 'added', 'remote'],
].map(r => r.join('\t')).join('\n') + '\n';
writeFileSync(hist, H + rows);

try {
  const out = execFileSync('node', [SCRIPT], {
    env: { ...process.env, GIG_PILOT_SCAN_HISTORY: hist },
    encoding: 'utf-8',
  });
  if (/React developer/i.test(out)) pass('detects the reposted React gig');
  else fail('did not detect the reposted React gig');
  // the report renders the subreddit bucket for empty-company Reddit rows
  if (/r\/forhire/i.test(out)) pass('report shows the subreddit as poster/source');
  else fail('report did not show the subreddit bucket');
  // the unrelated Rust gig has only one sighting -> must not be flagged as a repost
  if (!/Rust systems audit/i.test(out)) pass('does not flag the unrelated Rust gig');
  else fail('incorrectly flagged the unrelated Rust gig');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
