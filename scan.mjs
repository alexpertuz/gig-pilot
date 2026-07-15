#!/usr/bin/env node

/**
 * scan.mjs — Precision-first portal scanner with plugin-based acquisition.
 *
 * Providers live in providers/*.mjs and are loaded at startup. Each provider
 * exports a default object with:
 *   - id: string — matched against `provider:` in sources.yml
 *   - detect(entry): {url}|null — optional auto-detection from careers_url
 *   - fetch(entry, ctx): [{title,url,company,location}] — required
 *
 * Files prefixed with _ are shared helpers (e.g. _http.mjs) and are never
 * loaded as providers. Adding a new HTTP/API source = drop a *.mjs into
 * providers/. Local executable parsers use `providers/local-parser.mjs` when
 * `parser.command` + `parser.script` are set in sources.yml.
 *
 * A tracked_companies entry can set `provider:` explicitly to bypass
 * URL-based auto-detection. The `transport:` field is reserved for future
 * transports — Phase A only ships the http transport.
 *
 * Acquisition is local HTTP + JSON. Admission uses the selected local agent
 * runtime to validate bounded survivors; no model is pinned by this script.
 *
 * Usage:
 *   node scan.mjs                  # scan all enabled companies
 *   node scan.mjs --dry-run        # preview without writing files
 *   node scan.mjs --company Cohere # scan a single company
 *   node scan.mjs --verify         # Playwright-check each new URL; drop expired postings
 *   node scan.mjs --verify --headed-fallback  # retry anti-bot-blocked URLs in a headed browser (needs a display)
 *   node scan.mjs --verify --throttle          # jittered ~5-10s gap between checks (stay under rate limits)
 *   node scan.mjs --verify --throttle=8000     # custom base gap in ms (waits base..2*base)
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';
import yaml from 'js-yaml';

import { makeHttpCtx } from './providers/_http.mjs';
import { normalizeCandidate } from './triage/contracts.mjs';
import { triageCandidates } from './triage/engine.mjs';
import { readDerivedState, writeDerivedStateAtomic } from './triage/store.mjs';
import { normalizeProvider } from './agent-runtime.mjs';

const parseYaml = yaml.load;

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = process.env.GIG_OPS_SOURCES || 'sources.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const PROFILE_PATH = 'config/profile.yml';
const DERIVED_PATHS = {
  candidates: 'data/candidates.json',
  triage: 'data/triage.json',
  scores: 'data/scores.json',
};

export function formatScanProgressEvent({ name, completed, total, jobsInspected }) {
  return `::gig-ops-scan::${JSON.stringify({
    type: 'source',
    name,
    completed,
    total,
    jobsInspected,
  })}`;
}

export function formatTriageProgressEvent(metrics) {
  const bySource = Object.fromEntries(Object.entries(metrics.bySource || {}).map(([source, values]) => [source, {
    fetched: Number(values.fetched) || 0,
    accepted: Number(values.accepted) || 0,
    rejected: Number(values.rejected) || 0,
    quarantined: Number(values.quarantined) || 0,
  }]));
  return `::gig-ops-scan::${JSON.stringify({
    type: 'triage',
    fetched: Number(metrics.fetched) || 0,
    ruleRejected: Number(metrics.ruleRejected) || 0,
    modelEvaluated: Number(metrics.modelEvaluated) || 0,
    cached: Number(metrics.cached) || 0,
    accepted: Number(metrics.accepted) || 0,
    quarantined: Number(metrics.quarantined) || 0,
    bySource,
  })}`;
}

export function parseTriageOptions(args = [], env = process.env) {
  const modeArg = args.find((arg) => arg.startsWith('--triage-mode='));
  const mode = modeArg?.split('=')[1] || env.GIGOPS_TRIAGE_MODE || 'enforced';
  if (mode !== 'enforced' && mode !== 'shadow') {
    throw new Error(`triage mode must be "enforced" or "shadow", received: ${mode}`);
  }
  const providerArg = args.find((arg) => arg.startsWith('--agent-provider='));
  const provider = providerArg?.split('=')[1] || env.GIGOPS_AGENT_PROVIDER || 'claude';
  return { mode, provider, reclassify: args.includes('--reclassify') };
}

export function offerToTriageCandidate(offer, firstSeen) {
  return normalizeCandidate({
    ...offer,
    source: offer.channelSource || offer.source,
  }, {
    provider: offer.provider,
    firstSeen,
  });
}

export function selectOffersForTriageMode(offers, triageResult, mode) {
  if (mode === 'shadow') return offers;
  const acceptedUrls = new Set((triageResult?.accepted || []).map((candidate) => candidate.url));
  return offers.filter((offer) => acceptedUrls.has(offer.url));
}

export function rankTriagedOffers(offers, scores = {}) {
  return [...offers].sort((a, b) => {
    const activeA = Number(scores[a.url]?.score >= 3
      && scores[a.url]?.verdict !== 'DECLINE'
      && Number(scores[a.url]?.blocks?.A) >= 3
      && Number(scores[a.url]?.blocks?.B) > 1);
    const activeB = Number(scores[b.url]?.score >= 3
      && scores[b.url]?.verdict !== 'DECLINE'
      && Number(scores[b.url]?.blocks?.A) >= 3
      && Number(scores[b.url]?.blocks?.B) > 1);
    const scoreA = Number.isFinite(scores[a.url]?.score) ? scores[a.url].score : -Infinity;
    const scoreB = Number.isFinite(scores[b.url]?.score) ? scores[b.url].score : -Infinity;
    return activeB - activeA
      || scoreB - scoreA
      || (b.relevance ?? 0) - (a.relevance ?? 0)
      || normalizePriority(a.priority) - normalizePriority(b.priority)
      || (a._sourceOrder ?? 0) - (b._sourceOrder ?? 0)
      || (a._offerOrder ?? 0) - (b._offerOrder ?? 0);
  });
}

export function mergeTriageDerivedState(existing, result) {
  const candidates = { ...(existing?.candidates || {}), ...(result?.candidates || {}) };
  const triage = { ...(existing?.triage || {}), ...(result?.decisions || {}) };
  const scores = { ...(existing?.scores || {}) };
  for (const url of Object.keys(result?.candidates || {})) delete scores[url];
  Object.assign(scores, result?.scores || {});
  return { candidates, triage, scores };
}
const APPLICATIONS_PATH = 'data/leads.md';
const PROVIDERS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'providers');

// Ensure required directories exist (fresh setup)
mkdirSync('data', { recursive: true });

const CONCURRENCY = 10;

// ── Provider loading ────────────────────────────────────────────────

async function loadProviders(dir) {
  const providers = new Map();
  if (!existsSync(dir)) return providers;
  // Alphabetical order so detect() priority is deterministic across machines.
  const entries = readdirSync(dir)
    .filter(f => f.endsWith('.mjs') && !f.startsWith('_') && !f.endsWith('.test.mjs'))
    .sort();
  for (const file of entries) {
    const full = path.join(dir, file);
    let mod;
    try {
      mod = await import(pathToFileURL(full).href);
    } catch (err) {
      console.error(`⚠️  ${file}: failed to load — ${err.message}`);
      continue;
    }
    const p = mod.default;
    if (!p || typeof p.fetch !== 'function' || !p.id) {
      console.error(`⚠️  ${file}: skipping — default export must be { id, fetch }`);
      continue;
    }
    if (providers.has(p.id)) {
      console.error(`⚠️  ${file}: duplicate provider id "${p.id}" — keeping first`);
      continue;
    }
    providers.set(p.id, p);
  }
  return providers;
}

// Resolve which provider handles a tracked_companies entry.
// 1. Explicit `provider:` field wins (skips detect()).
// 2. local-parser when parser.command + script are configured (before API detect).
// 3. Otherwise each provider's detect() runs in load order; first hit wins.
function resolveProvider(entry, providers, { skipIds = [] } = {}) {
  if (entry.provider) {
    const p = providers.get(entry.provider);
    if (!p) return { error: `unknown provider: ${entry.provider}` };
    return { provider: p };
  }

  const localParser = providers.get('local-parser');
  if (localParser && !skipIds.includes('local-parser')) {
    try {
      const hit = localParser.detect?.(entry);
      if (hit) return { provider: localParser };
    } catch (err) {
      console.error(`⚠️  local-parser: detect() threw for "${entry.name}" — ${err.message}`);
    }
  }

  for (const p of providers.values()) {
    if (skipIds.includes(p.id)) continue;
    let hit;
    try {
      hit = p.detect?.(entry);
    } catch (err) {
      console.error(`⚠️  ${p.id}: detect() threw for "${entry.name}" — ${err.message}`);
      continue;
    }
    if (hit) return { provider: p };
  }
  return null;
}

// ── Title filter ────────────────────────────────────────────────────

// Compile a lowercased keyword into a matcher. Short all-letter acronyms
// (2-3 chars: cfo, coo, sdr, bdr, gsi…) match on WORD BOUNDARIES so "COO" no
// longer matches "Coordinator", "SDR" no longer matches anything mid-word, etc.
// Multi-word phrases and keywords containing non-letters (".NET", "SAP ",
// "L&D") keep fast, permissive substring matching.
export function compileKeyword(kw) {
  if (/^[a-z]{2,3}$/.test(kw)) {
    const re = new RegExp(`\\b${kw}\\b`);
    return (lower) => re.test(lower);
  }
  return (lower) => lower.includes(kw);
}

// Source priority is deliberately narrow: only the three documented integer
// tiers persist into pipeline/history metadata. Everything else safely falls
// back to the neutral tier instead of leaking malformed config downstream.
export function normalizePriority(value) {
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 2;
}

// Returns a stable, normalized copy so callers can schedule sources in tier
// order without mutating the config objects parsed from sources.yml.
export function sortTargetsByPriority(targets) {
  return targets
    .map(target => ({ ...target, priority: normalizePriority(target.priority) }))
    .sort((a, b) => a.priority - b.priority);
}

// Returns a scorer: (title) => { keep, relevance, matched }
//   - keep:      false ONLY when a negative keyword is present. Missing positive
//                keywords no longer rejects a post — it just scores 0 relevance.
//   - relevance: how many positive keywords the title hit (higher = more on-topic).
//   - matched:   the positive keywords that hit, surfaced into the pipeline so the
//                LLM can weigh them when ranking later.
export function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || [])
    .map(k => k.toLowerCase())
    .map(kw => ({ kw, test: compileKeyword(kw) }));
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase()).map(compileKeyword);

  return (title) => {
    const lower = (title || '').toLowerCase();
    if (negative.some(m => m(lower))) {
      return { keep: false, relevance: 0, matched: [] };
    }
    const matched = positive.filter(p => p.test(lower)).map(p => p.kw);
    return { keep: true, relevance: matched.length, matched };
  };
}

// Relevance is title-led: descriptions are considered only when no positive
// title keyword matched. This preserves title ranking while allowing demand
// language in provider-supplied descriptions to rescue generic role titles.
export function buildRelevanceFilter(titleFilter) {
  const matchTitle = buildTitleFilter(titleFilter);
  const positive = (titleFilter?.positive || [])
    .map(k => k.toLowerCase())
    .map(kw => ({ kw, test: compileKeyword(kw) }));

  return ({ title, description }) => {
    const titleMatch = matchTitle(title);
    if (!titleMatch.keep || titleMatch.relevance > 0) return titleMatch;
    const lowerDescription = typeof description === 'string' ? description.toLowerCase() : '';
    const matched = positive.filter(p => p.test(lowerDescription)).map(p => p.kw);
    return { keep: true, relevance: matched.length, matched };
  };
}

// ── Location filter ─────────────────────────────────────────────────
// Optional. If `location_filter` is absent from sources.yml, all locations pass.
// Semantics (case-insensitive substring, in this order):
//   - Empty / whitespace-only / non-string location → pass (don't penalize
//     missing or malformed provider data)
//   - `always_allow` matches → pass (takes precedence over `block` — lets a
//     multi-location string like "Remote, Belgium or France" through because
//     the home region is an option, even though "france" is blocked)
//   - `block` matches → reject
//   - `allow` empty → pass (already cleared block)
//   - `allow` non-empty → must match at least one keyword

// Normalize a keyword list from sources.yml: tolerates a bare string
// (wrapped to a 1-item array), null/undefined (→ []), and non-string
// entries (filtered out). Survivors are lowercased, trimmed, and any
// resulting empty strings are dropped — an empty keyword would otherwise
// match every location via String.includes(''), silently bypassing the
// other tiers.
function normalizeKeywordList(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .filter(k => typeof k === 'string')
    .map(k => k.toLowerCase().trim())
    .filter(Boolean);
}

export function buildLocationFilter(locationFilter) {
  if (!locationFilter) return () => true;
  const alwaysAllow = normalizeKeywordList(locationFilter.always_allow);
  const allow = normalizeKeywordList(locationFilter.allow);
  const block = normalizeKeywordList(locationFilter.block);

  return (location) => {
    if (typeof location !== 'string' || location.trim() === '') return true;
    const lower = location.toLowerCase();
    if (alwaysAllow.length > 0 && alwaysAllow.some(k => lower.includes(k))) return true;
    if (block.length > 0 && block.some(k => lower.includes(k))) return false;
    if (allow.length === 0) return true;
    return allow.some(k => lower.includes(k));
  };
}

// ── Content filter ──────────────────────────────────────────────────
// Optional. If `content_filter` is absent from sources.yml, all jobs pass.
// Filters on the job DESCRIPTION text to separate same-titled roles with
// different stacks (a "Software Engineer" listing that mentions "PHP" vs one
// that mentions "Rust"). Semantics (case-insensitive substring, in order):
//   - Empty / whitespace-only / non-string description → PASS at this early
//     filter. Precision triage later quarantines content that cannot support a
//     verified eligibility decision.
//   - any `negative` keyword present → reject
//   - `positive` empty → pass (already cleared negatives)
//   - `positive` non-empty → at least one keyword must be present
//
// Provider support: providers should preserve the fullest description their
// source payload exposes. Those without one leave it empty and therefore pass
// this early filter, but cannot bypass the later evidence-based triage gate.

export function buildContentFilter(contentFilter) {
  if (!contentFilter) return () => true;
  const positive = normalizeKeywordList(contentFilter.positive);
  const negative = normalizeKeywordList(contentFilter.negative);

  return (description) => {
    if (typeof description !== 'string' || description.trim() === '') return true;
    const lower = description.toLowerCase();
    if (negative.length > 0 && negative.some(k => lower.includes(k))) return false;
    if (positive.length === 0) return true;
    return positive.some(k => lower.includes(k));
  };
}

// ── Budget filter ───────────────────────────────────────────────────
// Freelance gigs are priced hourly or per-project, NOT as annual salaries.
// This filter drops gigs whose budget is clearly below your floor, and
// (optionally) gigs detected as unpaid/equity-only.
//
// Config (sources.yml → budget_filter):
//   min_hourly:    minimum acceptable $/hr (0 = no minimum)
//   min_project:   minimum acceptable fixed-project budget (0 = no minimum)
//   exclude_unpaid: drop gigs with paymentModel 'unpaid' or 'equity' (default true)
//
// Conservative by design: a gig only gets dropped when we can read a clearly
// below-threshold number or detect an unpaid/equity model. Gigs with no budget
// signal pass through — Block B of the evaluation handles them later.

// parseBudget extracts an hourly rate and/or a fixed amount from a gig's
// budget string. Returns { hourly: number|null, fixed: number|null }.
// Examples: "$50/hr" → { hourly: 50 }, "$500" → { fixed: 500 },
//           "$40-60/hr" → { hourly: 40 } (lower bound), "negotiable" → {}
export function parseBudget(budgetStr) {
  if (!budgetStr || typeof budgetStr !== 'string') return { hourly: null, fixed: null };
  const s = budgetStr.toLowerCase();
  // First number in the string (handles ranges by taking the lower bound)
  const numMatch = s.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!numMatch) return { hourly: null, fixed: null };
  const amount = Number(numMatch[0]);
  if (!Number.isFinite(amount)) return { hourly: null, fixed: null };
  const isHourly = /\/\s*h(r|our)?\b|per\s*hour|hourly/.test(s);
  return isHourly ? { hourly: amount, fixed: null } : { hourly: null, fixed: amount };
}

export function buildBudgetFilter(budgetFilter) {
  const cfg = budgetFilter && typeof budgetFilter === 'object' ? budgetFilter : {};
  const minHourly = Number(cfg.min_hourly ?? 0);
  const minProject = Number(cfg.min_project ?? 0);
  // exclude_unpaid defaults to true — unpaid/equity gigs are the thing we most
  // want to filter out in this domain.
  const excludeUnpaid = cfg.exclude_unpaid !== false;

  if (!Number.isFinite(minHourly) || !Number.isFinite(minProject) || minHourly < 0 || minProject < 0) {
    console.error('Warning: budget_filter.min_hourly/min_project must be non-negative — budget filter disabled');
    return () => true;
  }

  // Nothing to filter on
  if (minHourly === 0 && minProject === 0 && !excludeUnpaid) return () => true;

  return (gig) => {
    if (!gig || typeof gig !== 'object') return true;

    // Drop unpaid / equity-only gigs
    if (excludeUnpaid && (gig.paymentModel === 'unpaid' || gig.paymentModel === 'equity')) {
      return false;
    }

    // Parse the budget string (freelance providers set gig.budget)
    const { hourly, fixed } = parseBudget(gig.budget);

    // Below the hourly floor
    if (minHourly > 0 && hourly != null && hourly < minHourly) return false;
    // Below the project floor
    if (minProject > 0 && fixed != null && fixed < minProject) return false;

    // No readable budget signal → pass conservatively
    return true;
  };
}

// ── URL rediscovery (--rediscover-404) ──────────────────────────────
// When a tracked company's job URL returns 404/410, the role may have just
// moved to a new URL (Workday/Greenhouse rotate URLs without closing roles).
// These helpers back an opt-in search-and-reverify fallback before giving up.

// extractCareersUrlDomain returns the hostname of a company's careers_url, or
// null when it's missing/unparseable. The presence of a domain is what gates
// the fallback — broad-discovery offers without a careers_url stay ineligible.
export function extractCareersUrlDomain(careersUrl) {
  if (!careersUrl) return null;
  try {
    return new URL(careersUrl).hostname;
  } catch {
    return null;
  }
}

// resolveSearchHref unwraps a DuckDuckGo HTML redirect (`/l/?uddg=<encoded>`)
// to its real destination, so domain matching sees the actual host instead of
// duckduckgo.com. Non-redirect hrefs pass through unchanged.
function resolveSearchHref(href) {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const isDdgHost = u.hostname === 'duckduckgo.com' || u.hostname.endsWith('.duckduckgo.com');
    if (isDdgHost && u.pathname === '/l/') {
      const target = u.searchParams.get('uddg');
      if (target) return target;
    }
  } catch {
    /* fall through to the raw href */
  }
  return href;
}

// pickRediscoveredUrl chooses the first result whose hostname *exactly* equals
// the careers domain (no substring/look-alike matches), unwrapping search-engine
// redirects first. Pure + exported so result-matching is unit-testable without
// driving a real browser. Returns null when nothing matches.
export function pickRediscoveredUrl(hrefs, domain) {
  if (!domain || !Array.isArray(hrefs)) return null;
  for (const raw of hrefs) {
    const href = resolveSearchHref(raw);
    let host;
    try {
      host = new URL(href).hostname;
    } catch {
      continue;
    }
    if (host === domain) return href;
  }
  return null;
}

// REDISCOVER_TIMEOUT_MS bounds the single fallback search so a slow or blocked
// search engine can't stall the sequential verify loop.
const REDISCOVER_TIMEOUT_MS = 10_000;

// searchForNewUrl runs one site-scoped search for a moved tracked role and
// returns a same-domain URL if found, else null. Every failure path returns
// null — the fallback must never throw into the verify loop. Leaves the page on
// a blank document so the next checkUrlLiveness call starts clean.
async function searchForNewUrl(page, offer) {
  const domain = offer.careersUrlDomain;
  if (!domain) return null;
  const query = `"${offer.title}" "${offer.company}" site:${domain}`;
  try {
    await page.goto(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { waitUntil: 'domcontentloaded', timeout: REDISCOVER_TIMEOUT_MS },
    );
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a.result__a'))
        .map((a) => a.getAttribute('href'))
        .filter(Boolean),
    );
    return pickRediscoveredUrl(hrefs, domain);
  } catch {
    return null;
  } finally {
    try {
      await page.goto('about:blank');
    } catch {
      /* ignore — best-effort cleanup */
    }
  }
}

// ── Dedup ───────────────────────────────────────────────────────────

const PERMANENT_SCAN_HISTORY_STATUSES = new Set([
  'skipped_invalid_url',
  'skipped_blocked_host',
]);

function daysBetweenIsoDates(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (startDate.toISOString().slice(0, 10) !== start || endDate.toISOString().slice(0, 10) !== end) return null;
  return Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));
}

export function shouldDedupScanHistoryRow({ firstSeen, status = 'added' }, { recheckAfterDays = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (PERMANENT_SCAN_HISTORY_STATUSES.has(status)) return true;
  if (status !== 'added') return true;
  if (recheckAfterDays == null) return true;
  const ageDays = daysBetweenIsoDates(firstSeen, today);
  if (ageDays == null) return true;
  return ageDays < recheckAfterDays;
}

function scanHistoryPolicy(config = {}) {
  const raw = config.scan_history?.recheck_after_days;
  const parsed = Number.parseInt(raw, 10);
  return {
    recheckAfterDays: Number.isFinite(parsed) && parsed >= 0 ? parsed : null,
  };
}

export function loadSeenUrls(policy = {}) {
  const seen = new Set();
  let recheckEligible = 0;

  // scan-history.tsv
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) { // skip header
      const [url, firstSeen, , , , status = 'added'] = line.split('\t');
      if (!url) continue;
      if (shouldDedupScanHistoryRow({ firstSeen, status }, policy)) seen.add(url);
      else recheckEligible++;
    }
  }

  // pipeline.md — extract URLs from checkbox lines
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }

  // applications.md — extract URLs from report links and any inline URLs
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }

  return { seen, recheckEligible };
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    // Parse markdown table rows: | # | Date | Company | Role | ...
    for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const company = match[1].trim().toLowerCase();
      const role = match[2].trim().toLowerCase();
      if (company && role && company !== 'company') {
        seen.add(`${company}::${role}`);
      }
    }
  }
  return seen;
}

// ── Pipeline writer ─────────────────────────────────────────────────

function normalizeScanScalar(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function normalizeScanUrl(value) {
  return String(value ?? '').trim().split(/\s+/)[0] || '';
}

const MARKDOWN_ESCAPE_CHARS = {
  '\\': '\\\\',
  '[': '\\[',
  ']': '\\]',
};

export function sanitizeMarkdownField(value) {
  return normalizeScanScalar(value)
    .replace(/[\\[\]]/g, char => MARKDOWN_ESCAPE_CHARS[char])
    .replace(/\|/g, '/');
}

function sanitizePipelineUrl(value) {
  return normalizeScanUrl(value)
    .replace(/[\\[\]]/g, char => MARKDOWN_ESCAPE_CHARS[char])
    .replace(/\|/g, '%7C');
}

export function sanitizeTsvField(value) {
  const normalized = normalizeScanScalar(value);
  return /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
}

export function formatPipelineOffer(offer) {
  const url = sanitizePipelineUrl(offer.url);
  const company = sanitizeMarkdownField(offer.company);
  const title = sanitizeMarkdownField(offer.title);
  // Trailing relevance signal: keyword-hit count + which positive keywords hit.
  // Additive 4th field — `/pipeline` reads the URL (field 1) and Company/Role
  // (fields 2–3), so this is safe to append and gives the LLM a ranking hint.
  const relevance = Number.isFinite(offer.relevance) ? offer.relevance : 0;
  const priority = normalizePriority(offer.priority);
  const matched = Array.isArray(offer.matchedKeywords) ? offer.matchedKeywords : [];
  const signal = matched.length
    ? `relevance:${relevance} tier:${priority} [${sanitizeMarkdownField(matched.join(', '))}]`
    : `relevance:${relevance} tier:${priority}`;
  return `- [ ] ${url} | ${company} | ${title} | ${signal}`;
}

export function formatScanHistoryRow(offer, date, status = 'added') {
  return [
    normalizeScanUrl(offer.url),
    date,
    offer.source,
    offer.title,
    offer.company,
    status,
    offer.location || '',
    normalizePriority(offer.priority),
  ].map(sanitizeTsvField).join('\t');
}

// Standard skeleton created on fresh install — matches the format documented
// in modes/pipeline.md and expected by /gig-ops pipeline.
const PIPELINE_SKELETON = `# Pipeline — Pending URLs

Paste job URLs below as \`- [ ] {url}\` then run \`/gig-ops pipeline\`.

## Pending

## Processed
`;

// Current section names (English). Legacy Spanish names are checked as fallback
// so existing pipeline.md files created before this change keep working.
const PENDING_MARKERS = ['## Pending', '## Pendientes'];
const PROCESSED_MARKERS = ['## Processed', '## Procesadas'];

export function appendToPipeline(offers) {
  if (offers.length === 0) return;

  // Auto-create with standard skeleton if missing (fresh-install guard).
  if (!existsSync(PIPELINE_PATH)) {
    writeFileSync(PIPELINE_PATH, PIPELINE_SKELETON, 'utf-8');
  }

  let text = readFileSync(PIPELINE_PATH, 'utf-8');

  const marker = PENDING_MARKERS.find(m => text.includes(m)) ?? null;
  const idx = marker !== null ? text.indexOf(marker) : -1;

  if (idx === -1) {
    // No Pending section found — insert one before Processed (or at end)
    const procIdx = PROCESSED_MARKERS.reduce((found, m) => {
      const i = text.indexOf(m);
      return (found === -1 || (i !== -1 && i < found)) ? i : found;
    }, -1);
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n## Pending\n\n` + offers.map(formatPipelineOffer).join('\n') + '\n\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    // Find the end of existing Pending content (next ## or end)
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;

    const block = '\n' + offers.map(formatPipelineOffer).join('\n') + '\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

export function appendToScanHistory(offers, date, status = 'added') {
  // Ensure file + header exist. Location appended as 7th column for non-breaking
  // backward compat — older scan-history.tsv files with 6 columns still parse fine
  // since loadSeenUrls only reads column 0. `status` is parameterized so callers
  // can record verify outcomes (`skipped_expired`, etc.) without the legacy
  // `(expired)` suffix in `source`.
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tpriority\n', 'utf-8');
  } else {
    const history = readFileSync(SCAN_HISTORY_PATH, 'utf-8');
    const newline = history.indexOf('\n');
    const header = newline === -1 ? history : history.slice(0, newline);
    if (!header.split('\t').includes('priority')) {
      const remainder = newline === -1 ? '' : history.slice(newline);
      writeFileSync(SCAN_HISTORY_PATH, `${header}\tpriority${remainder}`, 'utf-8');
    }
  }

  const lines = offers.map(o => formatScanHistoryRow(o, date, status)).join('\n') + '\n';

  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── Parallel fetch with concurrency limit ───────────────────────────

async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function verifyOffers(offers, { headedFallback = false, throttleBaseMs = 0, rediscover = false } = {}) {
  // Dynamic imports keep the default zero-token path free of Playwright startup
  let chromium;
  let checkUrlLiveness;
  let checkUrlLivenessWithFallback;
  let createHeadedPageProvider;
  let newLivenessPage;
  let jitteredDelayMs;
  let sleep;
  try {
    ({ chromium } = await import('playwright'));
    ({ checkUrlLiveness, checkUrlLivenessWithFallback, createHeadedPageProvider, newLivenessPage, jitteredDelayMs, sleep } = await import('./liveness-browser.mjs'));
  } catch (err) {
    throw new Error(
      `--verify requires Playwright with Chromium (run "npx playwright install chromium"): ${err.message}`,
      { cause: err },
    );
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    throw new Error(
      `--verify could not launch Chromium (run "npx playwright install chromium" or re-run without --verify): ${err.message}`,
      { cause: err },
    );
  }

  // Three permanent buckets + one transient passthrough:
  //   verified  → active pages and transient nav errors (retry next scan)
  //   expired   → classifier-confirmed dead postings (HTTP 4xx, redirect markers,
  //               body patterns, listing pages, insufficient content)
  //   dropped   → page loaded but classifier saw no Apply control. --verify is an
  //               opt-in stricter filter; keeping these defeats the purpose.
  //   invalid   → up-front URL guard rejections (malformed / non-http / private)
  const verified = [];
  const expired = [];
  const dropped = [];
  const invalid = [];
  const migrated = [];

  const headed = headedFallback ? createHeadedPageProvider(chromium) : null;
  const getHeadedPage = headed ? () => headed.get() : undefined;

  try {
    const page = await newLivenessPage(browser);
    // Sequential — project rule: never Playwright in parallel
    for (let i = 0; i < offers.length; i++) {
      const offer = offers[i];
      const { result, code, reason } = headed
        ? await checkUrlLivenessWithFallback(page, offer.url, { getHeadedPage })
        : await checkUrlLiveness(page, offer.url);
      if (result === 'expired') {
        // 404/410 on a tracked company may just be a moved role — run one
        // search + re-verify before giving up (opt-in via --rediscover-404).
        // Only http_gone (HTTP 404/410) qualifies; soft-expiry signals
        // (redirect/body/listing) are real closures, not URL moves.
        if (rediscover && code === 'http_gone' && offer.tracked && offer.careersUrlDomain) {
          const newUrl = await searchForNewUrl(page, offer);
          if (newUrl) {
            // Mirror the primary check: without the headed fallback, a
            // challenge-prone domain would flag the rediscovered URL as
            // expired just because the recheck hit the same anti-bot wall.
            const recheck = headed
              ? await checkUrlLivenessWithFallback(page, newUrl, { getHeadedPage })
              : await checkUrlLiveness(page, newUrl);
            // Require a *confirmed* live page before migrating. A transient
            // 'uncertain' (timeout/DNS/5xx) must not commit an unverified URL —
            // fall through to expired (the original 404/410 is a real closure).
            if (recheck.result === 'active') {
              migrated.push({ ...offer, url: newUrl, previousUrl: offer.url });
              console.log(`  🔄 migrated  ${offer.company} | ${offer.title} → ${newUrl}`);
              continue;
            }
          }
        }
        expired.push({ ...offer, reason });
        console.log(`  ❌ expired   ${offer.company} | ${offer.title} (${reason})`);
      } else if (result === 'uncertain' && GUARD_CODES.has(code)) {
        // Guard failures are permanent (not transient like a timeout) — record them
        // separately so they don't end up in pipeline.md but DO appear in scan-history
        // with a precise status, dedup-blocking them on subsequent scans.
        invalid.push({ ...offer, code, reason });
        console.log(`  ⛔ invalid   ${offer.company} | ${offer.title} (${reason})`);
      } else if (result === 'uncertain' && code === 'no_apply_control') {
        // Page loaded but classifier could not find an Apply control. Treat like
        // expired for routing — drop from pipeline AND record in scan-history so
        // we don't burn a verify cycle on the same URL next scan.
        dropped.push({ ...offer, reason });
        console.log(`  ⚠️ no-apply  ${offer.company} | ${offer.title} (${reason})`);
      } else {
        // 'active' or 'uncertain' due to navigation_error (transient — retry next scan)
        verified.push(offer);
        const icon = result === 'active' ? '✅' : '⚠️';
        console.log(`  ${icon} ${result.padEnd(9)} ${offer.company} | ${offer.title}`);
      }

      const wait = i < offers.length - 1 ? jitteredDelayMs(throttleBaseMs) : 0;
      if (wait) await sleep(wait);
    }
  } finally {
    if (headed) await headed.close();
    await browser.close();
  }

  return { verified, expired, dropped, invalid, migrated };
}

// Stable codes from liveness-browser's up-front URL guard. Routing dispatches
// on these codes (not on regex over reason strings) so wording can change
// without breaking the pipeline.
const GUARD_CODES = new Set(['invalid_url', 'unsupported_protocol', 'blocked_host']);

// guardStatusFor maps a guard code to the canonical scan-history status string.
function guardStatusFor(code) {
  if (code === 'blocked_host') return 'skipped_blocked_host';
  // invalid_url and unsupported_protocol both surface as malformed input
  return 'skipped_invalid_url';
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verify = args.includes('--verify');
  const triageOptions = parseTriageOptions(args);
  triageOptions.provider = normalizeProvider(triageOptions.provider);
  // Opt-in: on an anti-bot challenge (e.g. pracuj.pl Cloudflare wall), retry the
  // URL in a headed browser. Off by default — headed Chromium needs a display, so
  // scheduled/unattended scans should not rely on it.
  const headedFallback = args.includes('--headed-fallback');
  // --throttle or --throttle=<ms>: jittered gap between --verify checks to stay
  // under rate-based WAF limits (pracuj.pl flags the session after a few rapid
  // hits). Default base 5000ms. Off by default — most ATS feeds don't need it.
  const throttleArg = args.find((a) => a === '--throttle' || a.startsWith('--throttle='));
  const throttleBaseMs = throttleArg ? (Number(throttleArg.split('=')[1]) || 5000) : 0;
  // --rediscover-404: when a tracked company's URL 404/410s, search for the
  // moved role and re-verify before marking it expired. Opt-in; rides on --verify.
  const rediscover = args.includes('--rediscover-404');
  const companyFlag = args.indexOf('--company');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;

  // 1. Load providers
  const providers = await loadProviders(PROVIDERS_DIR);
  if (providers.size === 0) {
    console.error('Error: no providers loaded from providers/');
    process.exit(1);
  }

  // 2. Read sources.yml
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: sources.yml not found. Run onboarding first.');
    process.exit(1);
  }

  let rawConfig;
  try {
    rawConfig = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  } catch (err) {
    console.error(`Error: failed to parse ${PORTALS_PATH}: ${err.message}`);
    process.exit(1);
  }
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const companies = Array.isArray(config.tracked_companies) ? config.tracked_companies : [];
  // Support both legacy job_boards and new gig_boards key
  const boards = Array.isArray(config.gig_boards) ? config.gig_boards
    : Array.isArray(config.job_boards) ? config.job_boards : [];
  const relevanceFilter = buildRelevanceFilter(config.title_filter);
  const locationFilter = buildLocationFilter(config.location_filter);
  const budgetFilter = buildBudgetFilter(config.budget_filter);
  const contentFilter = buildContentFilter(config.content_filter);

  // 3. Resolve a provider for each enabled company / board
  const targets = [];
  let skippedCount = 0;
  let boardCount = 0;
  const resolveErrors = [];
  const agentHandoff = [];

  /**
   * Processes a list of configuration entries, resolves their appropriate data providers,
   * and appends valid entries to the global scanning targets list.
   * @param {Array<{ name?: string, enabled?: boolean, [key: string]: unknown }>} entries - List of entries.
   * @param {{ isBoard?: boolean }} [options={}] - Configuration options.
   */
  function resolveEntries(entries, { isBoard = false } = {}) {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.enabled === false) continue;
      if (typeof entry.name !== 'string' || !entry.name.trim()) {
        console.error(`⚠️  Skipping entry — missing or non-string 'name' field: ${JSON.stringify(entry)}`);
        continue;
      }
      if (filterCompany && !entry.name.toLowerCase().includes(filterCompany)) continue;
      
      const resolved = resolveProvider(entry, providers);
      if (!resolved) {
        skippedCount++;
        if (entry.scan_method === 'websearch') {
          agentHandoff.push({
            company: entry.name,
            method: 'websearch',
            query: entry.scan_query || entry.search_query || entry.careers_url || '',
          });
        }
        continue;
      }
      
      if (resolved.error) { 
        resolveErrors.push({ company: entry.name, error: resolved.error }); 
        continue; 
      }
      
      targets.push({ ...entry, _provider: resolved.provider, _isBoard: isBoard });
      if (isBoard) boardCount++;
    }
  }

  resolveEntries(companies);
  resolveEntries(boards, { isBoard: true });

  const prioritizedTargets = sortTargetsByPriority(targets)
    .map((target, sourceOrder) => ({ ...target, _sourceOrder: sourceOrder }));
  const localParserCount = prioritizedTargets.filter(t => t._provider.id === 'local-parser').length;
  const companyCount = prioritizedTargets.length - boardCount;
  const parts = [`${companyCount} companies`];
  if (boardCount > 0) parts.push(`${boardCount} job boards`);
  parts.push(`${localParserCount} local parser`);
  parts.push(`${skippedCount} skipped — no provider matched`);
  console.log(`Scanning ${parts.join('; ')} via providers`);
  if (dryRun) console.log('(dry run — no files will be written)\n');

  // 4. Load dedup sets
  const historyPolicy = scanHistoryPolicy(config);
  const seenUrlState = loadSeenUrls(historyPolicy);
  const seenUrls = seenUrlState.seen;
  const seenCompanyRoles = loadSeenCompanyRoles();

  // 5. Fetch from each target
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFilteredTitle = 0;
  let totalFilteredLocation = 0;
  let totalFilteredBudget = 0;
  let totalFilteredContent = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [...resolveErrors];

  let completedTargets = 0;
  let jobsInspected = 0;
  const tasks = prioritizedTargets.map(company => async () => {
    let provider = company._provider;
    const ctx = makeHttpCtx();
    let sourceName = provider.id === 'local-parser' ? 'local-parser' : `${provider.id}-api`;
    let sourceJobs = 0;
    try {
      let jobs;
      try {
        jobs = await provider.fetch(company, ctx);
      } catch (parserErr) {
        if (provider.id !== 'local-parser') throw parserErr;
        const fallback = resolveProvider(company, providers, { skipIds: ['local-parser'] });
        if (!fallback || fallback.error) throw parserErr;
        provider = fallback.provider;
        sourceName = `${provider.id}-api`;
        jobs = await provider.fetch(company, ctx);
        errors.push({
          company: company.name,
          error: `local parser failed, used API fallback: ${parserErr.message}`,
        });
      }
      if (!Array.isArray(jobs)) {
        throw new Error(`${provider.id}: fetch() did not return an array`);
      }
      sourceJobs = jobs.length;
      totalFound += jobs.length;

      for (const [offerOrder, job] of jobs.entries()) {
        const titleMatch = relevanceFilter(job);
        if (!titleMatch.keep) {
          // Only negative keywords reject now (renamed counter below).
          totalFilteredTitle++;
          continue;
        }
        if (!locationFilter(job.location)) {
          totalFilteredLocation++;
          continue;
        }
        if (!budgetFilter(job)) {
          totalFilteredBudget++;
          continue;
        }
        if (!contentFilter(job.description)) {
          totalFilteredContent++;
          continue;
        }
        if (seenUrls.has(job.url)) {
          totalDupes++;
          continue;
        }
        // Reddit (and other demand-side providers) have no `company` — use the
        // poster as the identity. Guard both fields so a missing one can never
        // throw and abort the whole source's job loop.
        const identity = (job.company ?? job.poster ?? '').toLowerCase();
        const key = `${identity}::${(job.title ?? '').toLowerCase()}`;
        if (seenCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }
        // Mark as seen to avoid intra-scan dupes
        seenUrls.add(job.url);
        seenCompanyRoles.add(key);
        // Tag with the company's careers domain so verify can offer a 404/410
        // rediscovery fallback. A null domain (no careers_url) marks the offer
        // as broad-discovery — ineligible for the fallback, per the issue scope.
        const careersUrlDomain = extractCareersUrlDomain(company.careers_url);
        newOffers.push({
          ...job,
          source: sourceName,
          channelSource: job.source || company.name || provider.id,
          provider: provider.id,
          sourceSignals: [
            `configured-source:${company.name}`,
            ...(company.thread ? [`thread:${company.thread}`] : []),
            ...titleMatch.matched.map(keyword => `keyword:${keyword}`),
          ],
          tracked: Boolean(careersUrlDomain),
          careersUrlDomain,
          relevance: titleMatch.relevance,
          matchedKeywords: titleMatch.matched,
          priority: company.priority,
          _sourceOrder: company._sourceOrder,
          _offerOrder: offerOrder,
        });
      }
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
    } finally {
      completedTargets += 1;
      jobsInspected += sourceJobs;
      if (process.env.GIG_OPS_SCAN_EVENTS === '1') {
        console.log(formatScanProgressEvent({
          name: company.name,
          completed: completedTargets,
          total: prioritizedTargets.length,
          jobsInspected,
        }));
      }
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  // 5.5. Optional liveness verification — drop expired and guard-rejected postings
  let verifiedOffers = newOffers;
  let expiredOffers = [];
  let droppedOffers = [];
  let invalidOffers = [];
  let migratedOffers = [];
  if (verify && newOffers.length > 0) {
    console.log(`\nVerifying liveness of ${newOffers.length} new offer(s) with Playwright (sequential)...`);
    const result = await verifyOffers(newOffers, { headedFallback, throttleBaseMs, rediscover });
    verifiedOffers = result.verified;
    expiredOffers = result.expired;
    droppedOffers = result.dropped;
    invalidOffers = result.invalid;
    migratedOffers = result.migrated;
    // Migrated offers re-enter the pipeline at their newly discovered URL.
    if (migratedOffers.length > 0) {
      verifiedOffers = [...verifiedOffers, ...migratedOffers];
    }
  }

  // 5.6. Precision-first triage — no offer crosses the User Layer write
  // boundary until deterministic rules and the selected active model confirm
  // that it is paid, client-side independent work.
  let triageResult = {
    accepted: [], rejected: [], uncertain: [], candidates: {}, decisions: {}, scores: {}, issues: [],
    metrics: {
      fetched: verifiedOffers.length, ruleRejected: 0, modelEvaluated: 0,
      cached: 0, accepted: 0, quarantined: verifiedOffers.length,
    },
  };
  if (verifiedOffers.length > 0) {
    try {
      if (!existsSync(PROFILE_PATH)) throw new Error('config/profile.yml not found; complete onboarding before AI triage');
      const profile = parseYaml(readFileSync(PROFILE_PATH, 'utf8')) || {};
      const existingDerived = await readDerivedState(DERIVED_PATHS);
      for (const issue of existingDerived.issues) errors.push({ company: 'Derived triage cache', error: issue });

      const candidates = [];
      for (const offer of verifiedOffers) {
        try {
          candidates.push(offerToTriageCandidate(offer, date));
        } catch (error) {
          errors.push({ company: offer.company ?? offer.poster ?? offer.source ?? 'Candidate', error: `candidate normalization failed: ${error.message}` });
        }
      }

      triageResult = await triageCandidates(candidates, {
        profile,
        provider: triageOptions.provider,
        cache: existingDerived.triage,
        reclassify: triageOptions.reclassify,
        maxModelCandidates: Number(config.ai_triage?.max_candidates_per_scan) || 30,
        batchSize: Number(config.ai_triage?.batch_size) || 10,
        timeoutMs: Number(config.ai_triage?.timeout_ms) || 300_000,
      });
      for (const issue of triageResult.issues) errors.push({ company: 'AI triage', error: issue });

      if (!dryRun) {
        const nextDerived = mergeTriageDerivedState(existingDerived, triageResult);
        await writeDerivedStateAtomic(DERIVED_PATHS, nextDerived);
      }
      verifiedOffers = selectOffersForTriageMode(verifiedOffers, triageResult, triageOptions.mode);
    } catch (error) {
      errors.push({ company: 'AI triage', error: error.message });
      if (triageOptions.mode === 'enforced') verifiedOffers = [];
    }
  }

  if (process.env.GIG_OPS_SCAN_EVENTS === '1') {
    console.log(formatTriageProgressEvent(triageResult.metrics));
  }

  // Rank: positive-keyword hits first, then source tier, then the scheduled
  // source/job order. The latter makes concurrent fetch completion invisible
  // to users when relevance and priority tie.
  verifiedOffers = rankTriagedOffers(verifiedOffers, triageResult.scores);

  // 6. Write results
  if (!dryRun && verifiedOffers.length > 0) {
    appendToPipeline(verifiedOffers);
    appendToScanHistory(verifiedOffers, date);
  }
  // Expired postings — plus the old URLs of migrated offers — are recorded as
  // skipped_expired so subsequent scans dedup-skip the dead URLs.
  const expiredForHistory = [
    ...expiredOffers,
    ...migratedOffers.map(o => ({ ...o, url: o.previousUrl })),
  ];
  if (!dryRun && expiredForHistory.length > 0) {
    appendToScanHistory(expiredForHistory, date, 'skipped_expired');
  }
  // Pages that loaded but had no Apply control: record so we don't re-verify
  // them next scan, but never let them reach pipeline.md.
  if (!dryRun && droppedOffers.length > 0) {
    appendToScanHistory(droppedOffers, date, 'skipped_no_apply_control');
  }
  // Guard-rejected URLs (invalid / unsupported protocol / blocked host) are
  // recorded with a precise status so subsequent scans dedup-skip them via
  // loadSeenUrls, but they never reach pipeline.md.
  if (!dryRun && invalidOffers.length > 0) {
    // Group by code so the TSV reflects the actual reason category.
    const byStatus = new Map();
    for (const o of invalidOffers) {
      const status = guardStatusFor(o.code);
      if (!byStatus.has(status)) byStatus.set(status, []);
      byStatus.get(status).push(o);
    }
    for (const [status, group] of byStatus) {
      appendToScanHistory(group, date, status);
    }
  }

  // 7. Print summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Portal Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  const summaryCompanies = prioritizedTargets.filter(t => !t._isBoard).length;
  const summaryBoards = prioritizedTargets.filter(t => t._isBoard).length;
  console.log(`Companies scanned:     ${summaryCompanies}`);
  if (summaryBoards > 0) console.log(`Job boards scanned:    ${summaryBoards}`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Rejected (neg. words): ${totalFilteredTitle} removed`);
  console.log(`Filtered by location:  ${totalFilteredLocation} removed`);
  console.log(`Filtered by budget:   ${totalFilteredBudget} removed`);
  console.log(`Filtered by content:  ${totalFilteredContent} removed`);
  console.log(`Duplicates:            ${totalDupes} skipped`);
  console.log(`Rule-rejected:         ${triageResult.metrics.ruleRejected || 0}`);
  console.log(`Model evaluated:       ${triageResult.metrics.modelEvaluated || 0}`);
  console.log(`Triage cache hits:     ${triageResult.metrics.cached || 0}`);
  console.log(`Quarantined:           ${triageResult.metrics.quarantined || 0}`);
  const sourceQuality = Object.entries(triageResult.metrics.bySource || {});
  if (sourceQuality.length > 0) {
    console.log('Source quality:');
    for (const [source, values] of sourceQuality.sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${source}: ${values.fetched} fetched, ${values.accepted} accepted, ${values.rejected} rejected, ${values.quarantined} quarantined`);
    }
  }
  if (historyPolicy.recheckAfterDays != null) {
    console.log(`Recheck eligible:      ${seenUrlState.recheckEligible} old scan-history URL(s)`);
  }
  if (verify) {
    console.log(`Expired (verified):    ${expiredOffers.length} dropped`);
    console.log(`Rediscovered (moved):  ${migratedOffers.length} migrated`);
    console.log(`No apply control:      ${droppedOffers.length} dropped`);
    console.log(`Invalid (guarded):     ${invalidOffers.length} dropped`);
  }
  console.log(`New offers added:      ${verifiedOffers.length}`);

  if (agentHandoff.length > 0) {
    console.log(`Agent/WebSearch handoff: ${agentHandoff.length} compan${agentHandoff.length === 1 ? 'y' : 'ies'} not handled by zero-token providers`);
    for (const item of agentHandoff.slice(0, 25)) {
      const hint = item.query ? ` — ${item.query}` : '';
      console.log(`  • ${item.company} (${item.method})${hint}`);
    }
    if (agentHandoff.length > 25) {
      console.log(`  … ${agentHandoff.length - 25} more omitted; narrow with --company or inspect sources.yml`);
    }
  }

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }

  if (verifiedOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of verifiedOffers) {
      const fit = triageResult.scores[o.url];
      const fitLabel = fit ? ` | fit ${Number(fit.score).toFixed(1)} ${fit.verdict}` : '';
      console.log(`  + ${o.company ?? o.poster ?? '—'} | ${o.title} | ${o.location || 'N/A'}${fitLabel}`);
    }
    if (dryRun) {
      console.log('\n(dry run — run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
    }
  }

  console.log(`\n→ Run /gig-ops pipeline to evaluate new offers.`);
  console.log('→ Share results and get help: https://discord.gg/8pRpHETxa4');
}

// Only run main() when invoked directly (`node scan.mjs`), not when imported by tests.
// `|| ''` guards the case where Node is invoked without a script arg (e.g. `node -e`).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
