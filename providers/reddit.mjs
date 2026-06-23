// providers/reddit.mjs
//
// Fetches postings from Reddit subreddits via the Atom RSS feed.
// No auth required for the RSS endpoint. Respects rate limits.
//
// Reddit rate limits unauthenticated requests heavily (~1 req / 2-3s).
// We apply 3s throttle + 429 retry with backoff between subreddit calls.
//
// For higher volume (> 5 subreddits), create a Reddit script app at
// https://www.reddit.com/prefs/apps and add to .env:
//   REDDIT_CLIENT_ID=...
//   REDDIT_CLIENT_SECRET=...
// When present, the provider will use OAuth (100 req/min vs ~30 req/10min).
//
// sources.yml usage:
//
//   gig_boards:
//     - name: "r/forhire"
//       provider: reddit
//       subreddit: forhire
//       # search_queries are title-filtered locally — RSS doesn't support server-side search
//       search_queries:
//         - "[Hiring]"
//         - "looking for"

import { env } from 'process';

const BASE = 'https://www.reddit.com';
// Reddit blocks custom bot User-Agent strings on unauthenticated requests.
// We intentionally omit User-Agent so Node's default is used (accepted by Reddit).
// When REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET are set in .env, the provider
// switches to OAuth which allows a proper User-Agent and 100 req/min.
const DEFAULT_LIMIT = 100;
const THROTTLE_MS = 3000;       // between subreddit calls
const RETRY_BACKOFF_MS = 8000;  // on 429, wait this long before retry
const MAX_RETRIES = 2;

let lastRequestTime = 0;

async function throttledFetch(url, ctx) {
  const now = Date.now();
  const wait = THROTTLE_MS - (now - lastRequestTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const data = await ctx.fetchJson(url, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (data !== null) return data;
    // fetchJson returns null on 429 or non-JSON — wait and retry once
    if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
  }
  return null;
}

/**
 * Fetch raw Atom/RSS XML from Reddit, bypassing ctx.fetchJson (which expects JSON).
 */
async function fetchRss(url) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const now = Date.now();
    const wait = THROTTLE_MS - (now - lastRequestTime);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestTime = Date.now();

    const res = await fetch(url);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('x-ratelimit-reset') ?? '10', 10) * 1000;
      const delay = Math.max(retryAfter, RETRY_BACKOFF_MS);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`reddit: rate limited (429) after ${MAX_RETRIES + 1} attempts`);
    }
    if (!res.ok) throw new Error(`reddit: HTTP ${res.status} from ${url}`);
    return res.text();
  }
}

/**
 * Parse Atom/RSS XML into a list of entry objects.
 * Uses regex rather than a full XML parser to stay dep-free.
 * @param {string} xml
 * @returns {{ title: string, link: string, updated: string, author: string, content: string }[]}
 */
function parseAtom(xml) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const chunk = m[1];
    const title = (chunk.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) ?? [])[1]?.trim() ?? '';
    const link = (chunk.match(/<link[^>]+href="([^"]+)"/) ?? [])[1]?.trim()
      ?? (chunk.match(/<id>(https?:\/\/[^<]+)<\/id>/) ?? [])[1]?.trim()
      ?? '';
    const updated = (chunk.match(/<updated>([^<]+)<\/updated>/) ?? [])[1]?.trim() ?? '';
    const author = (chunk.match(/<name>([^<]+)<\/name>/) ?? [])[1]?.trim() ?? 'unknown';
    // content is HTML-encoded in CDATA
    const rawContent = (chunk.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/) ?? [])[1] ?? '';
    // Strip HTML tags for plain text
    const content = rawContent.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
    entries.push({ title, link, updated, author, content });
  }
  return entries;
}

/**
 * Normalize a parsed RSS entry into a Gig.
 * @param {{ title: string, link: string, updated: string, author: string, content: string }} entry
 * @param {string} subreddit
 * @returns {import('./_types.js').Gig}
 */
function normalizeEntry(entry, subreddit) {
  const text = `${entry.title}\n${entry.content}`.toLowerCase();

  // Payment model
  let paymentModel = 'unknown';
  if (/\bunpaid\b|for your portfolio|for portfolio|revenue share only|equity only|no pay|volunteer/.test(text)) {
    paymentModel = 'unpaid';
  } else if (/\bequity\b/.test(text) && !/salary|paid|compensation|rate|budget|usd|\$|€|£/.test(text)) {
    paymentModel = 'equity';
  } else if (/\$\s*\d|\d\s*\/\s*hr|hourly|per hour|\brate\b/.test(text)) {
    paymentModel = 'hourly';
  } else if (/fixed|flat fee|project rate|one.?time|lump sum/.test(text)) {
    paymentModel = 'fixed';
  } else if (/paid|compensation|budget|usd|eur|\$|€|£/.test(text)) {
    paymentModel = 'paid';
  }

  // Budget string
  const budgetMatch = `${entry.title} ${entry.content}`.match(
    /\$[\d,]+(?:[\s–-]+\$[\d,]+)?(?:\s*\/\s*h(?:r|our))?|\d+(?:\.\d+)?\s*(?:USD|EUR|GBP)(?:\s*\/\s*h(?:r|our))?/i
  );
  const budget = budgetMatch?.[0]?.trim();

  const postedAt = entry.updated
    ? new Date(entry.updated).toISOString().slice(0, 10)
    : undefined;

  return {
    title: entry.title,
    url: entry.link,
    poster: entry.author,
    source: `r/${subreddit}`,
    location: 'remote',
    description: entry.content,
    postedAt,
    budget,
    paymentModel,
    channel: 'dm',
    // posterScore not available from RSS — needs OAuth /user/{name}/about.json
    posterScore: undefined,
  };
}

/** @type {import('./_types.js').Provider} */
export default {
  id: 'reddit',

  detect(entry) {
    return (
      typeof entry.subreddit === 'string' ||
      (typeof entry.name === 'string' && /^r\/\w+$/i.test(entry.name.trim()))
    );
  },

  async fetch(entry, _ctx) {
    const subreddit = entry.subreddit
      || (entry.name?.startsWith('r/') ? entry.name.slice(2) : null);
    if (!subreddit) throw new Error(`reddit: no subreddit specified for entry "${entry.name}"`);

    const url = `${BASE}/r/${subreddit}/new/.rss?limit=${DEFAULT_LIMIT}`;
    const xml = await fetchRss(url);
    const atomEntries = parseAtom(xml);

    // search_queries work as local title filters (RSS has no server-side search)
    const queries = Array.isArray(entry.search_queries) && entry.search_queries.length > 0
      ? entry.search_queries.map(q => q.toLowerCase())
      : null;

    const seen = new Set();
    const results = [];

    for (const ae of atomEntries) {
      if (!ae.link || !ae.title) continue;
      if (seen.has(ae.link)) continue;
      seen.add(ae.link);

      // Apply search_queries as local title filter
      if (queries) {
        const titleLower = ae.title.toLowerCase();
        if (!queries.some(q => titleLower.includes(q))) continue;
      }

      results.push(normalizeEntry(ae, subreddit));
    }

    return results;
  },
};
