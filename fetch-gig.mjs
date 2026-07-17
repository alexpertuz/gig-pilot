#!/usr/bin/env node
// fetch-gig.mjs — fetch a single gig posting for evaluation, using only Node's
// built-in fetch (covered by the pre-approved `Bash(node:*)` permission).
//
// Why this exists: the agent runs headless from the web console, where WebFetch
// and `curl` would trigger interactive permission prompts that can never be
// answered. This script is the sanctioned fetch path.
//
// Reddit note: the `.json` API returns 403 from datacenter IPs, but the public
// Atom feed (`<post-url>.rss`) returns 200 with the full body. That is the same
// approach providers/reddit.mjs uses. No browser or anti-detect tooling needed;
// for higher volume, add a Reddit OAuth script app (see providers/reddit.mjs).
//
// Usage:
//   node fetch-gig.mjs <url>
//
// Output: a normalized text block on stdout, plus a LIVENESS line so the caller
// can apply the Step 1 liveness gate. Exit code is always 0 unless the URL is
// missing — fetch failures are reported in-band, not as a crash.

import { parseAtom } from './providers/reddit.mjs';
import { classifyLiveness } from './liveness-core.mjs';

const THROTTLE_MS = 3000;
const RETRY_BACKOFF_MS = 8000;
const MAX_RETRIES = 2;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRedditPost(url) {
  try {
    const u = new URL(url);
    return /(^|\.)reddit\.com$/.test(u.hostname) && /\/comments\//.test(u.pathname);
  } catch {
    return false;
  }
}

function redditRssUrl(url) {
  const u = new URL(url);
  u.hostname = 'www.reddit.com';
  u.search = '';
  u.hash = '';
  u.pathname = u.pathname.replace(/\/+$/, '') + '/.rss';
  return u.toString();
}

// Fetch with throttle + 429/5xx backoff. Returns { status, text }.
async function fetchWithBackoff(url, headers = {}) {
  let last = { status: 0, text: '' };
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_BACKOFF_MS);
    else await sleep(THROTTLE_MS);
    try {
      const res = await fetch(url, { headers, redirect: 'follow' });
      const text = await res.text();
      last = { status: res.status, text, finalUrl: res.url };
      if (res.status === 429 || res.status >= 500) continue;
      return last;
    } catch (err) {
      last = { status: 0, text: '', error: String(err?.message || err) };
    }
  }
  return last;
}

// parseAtom decodes HTML entities after stripping tags, so encoded markup
// (`&lt;div&gt;`) survives as literal tag text. Strip those here and drop the
// RSS "submitted by … [link] [comments]" footer so the body reads clean.
function cleanBody(content = '') {
  return content
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s*submitted by\s*\/u\/[\w-]+\s*(\[link\])?\s*(\[comments\])?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function printReddit(entry, sourceUrl) {
  const posted = entry.updated || 'not specified';
  console.log(`SOURCE_URL: ${sourceUrl}`);
  console.log(`SOURCE: reddit`);
  console.log(`TITLE: ${entry.title || 'not specified'}`);
  console.log(`POSTER: ${entry.author || 'unknown'}`);
  console.log(`POSTED: ${posted}`);
  console.log('BODY:');
  console.log(cleanBody(entry.content) || '(empty body)');
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('usage: node fetch-gig.mjs <url>');
    process.exit(1);
  }

  if (isRedditPost(url)) {
    const rss = redditRssUrl(url);
    const { status, text, error } = await fetchWithBackoff(rss);
    if (status === 404 || status === 410) {
      console.log(`LIVENESS: expired (HTTP ${status})`);
      return;
    }
    if (status !== 200 || !text) {
      console.log(`LIVENESS: uncertain (reddit .rss HTTP ${status || 'error'}${error ? `: ${error}` : ''})`);
      console.log('Could not fetch the post body from Reddit. Score from the title only if provided, and mark budget/scope/legitimacy blocks as "not specified".');
      return;
    }
    const entries = parseAtom(text);
    // The first entry is the submission itself; later entries are comments.
    const post = entries[0];
    if (!post || !post.content) {
      console.log('LIVENESS: uncertain (post body empty in feed)');
      return;
    }
    console.log('LIVENESS: live');
    printReddit(post, url);
    return;
  }

  // Generic URL: fetch HTML and let the caller read it. Classify liveness with
  // the shared heuristic so expired postings are caught before scoring.
  const { status, text, finalUrl, error } = await fetchWithBackoff(url, { 'User-Agent': BROWSER_UA });
  if (!status) {
    console.log(`LIVENESS: uncertain (fetch failed${error ? `: ${error}` : ''})`);
    return;
  }
  const bodyText = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const { result, reason } = classifyLiveness({ status, finalUrl: finalUrl || url, bodyText });
  console.log(`LIVENESS: ${result} (${reason})`);
  console.log(`SOURCE_URL: ${url}`);
  console.log(`HTTP_STATUS: ${status}`);
  console.log('BODY:');
  console.log(bodyText.slice(0, 8000));
}

main();
