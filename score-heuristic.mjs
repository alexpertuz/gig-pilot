import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

const HOURLY_HINT = /\b(hour|hourly|per hour|an hour)\b|\/\s*hr/i;
const ANNUAL_HINT = /\b(per\s+year|a\s+year|annuall?y?|per\s+annum|yearly)\b|\/\s*(year|yr)\b|p\.a\./i;

/**
 * Parse a compensation signal out of free text.
 * @returns {{raw:string,min:number|null,max:number|null,unit:'hourly'|'annual'|'project'}|null}
 */
export function parseBudget(text) {
  if (!text) return null;
  const amounts = [];
  const re = /\$\s*([\d,]+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n)) amounts.push(n);
  }
  if (amounts.length === 0) return null;
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  // Hourly wins when stated (a contract rate matters more than an annualized aside);
  // then annual salary; a bare amount is treated as a project budget.
  const unit = HOURLY_HINT.test(text) ? 'hourly' : ANNUAL_HINT.test(text) ? 'annual' : 'project';
  return {
    raw: text.match(/\$[\s\d,.\-–to/a-z]*/i)?.[0]?.trim() ?? `$${max}`,
    min: amounts.length > 1 ? min : null,
    max,
    unit,
  };
}

const JOB_SEEKER = [
  'looking for a job', 'looking for work', 'looking for any', 'looking for a part',
  'looking for side', 'need a job', 'hire me', 'i am available for', 'seeking work',
  'looking for people ready to work', 'willing to learn',
];
// High-precision "get-rich-quick" markers only. Bare day-rate patterns ("/day",
// "per day") are intentionally excluded — a freelance day rate is legitimate and
// must never hard-decline a real gig.
const SCAM = [
  'daily income', 'turn your charm', '% from each', 'earn 50', 'copy paste',
  'copy-paste', 'passive income',
];

const lc = (s) => (s || '').toLowerCase();
const clamp = (n, lo = 1, hi = 5) => Math.max(lo, Math.min(hi, n));
const normalizePriority = (value) => Number.isInteger(value) && value >= 1 && value <= 3 ? value : 2;

function archetypeKeywords(profile) {
  const stacks = (profile.archetypes || []).flatMap((a) => a.stack || []);
  const services = [
    ...(Array.isArray(profile.services?.primary) ? profile.services.primary : []),
    ...(Array.isArray(profile.services?.secondary) ? profile.services.secondary : []),
  ];
  return [...stacks, ...services]
    .map((s) => lc(s).replace(/\.js$/, '').trim())
    .filter(Boolean);
}

function daysSince(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

/**
 * Score a gig against the 6-block rubric using mechanical signals only.
 * @returns {{score:number, blocks:object, reasons:string[], redFlags:string[], verdict:string, budget:object|null, jobSeeker:boolean}}
 */
export function scoreGig(gig, profile = {}, priority = 2) {
  const text = lc(`${gig.title || ''} ${gig.body || ''}`);
  const reasons = [];
  const redFlags = [];
  const rc = profile.rate_card || {};
  const declined = (rc.declined_models || ['unpaid', 'equity', 'revenue_share']).map((d) =>
    lc(d).replace(/_/g, ' '),
  );

  // ---- Hard-decline signals ----
  let hardDecline = false;
  for (const phrase of declined.concat(['unpaid', 'for exposure', 'for your portfolio'])) {
    if (text.includes(phrase)) {
      redFlags.push(`Unpaid/declined model: "${phrase}"`);
      hardDecline = true;
    }
  }
  let jobSeeker = false;
  for (const phrase of JOB_SEEKER) {
    if (text.includes(phrase)) {
      redFlags.push(`Job-seeker, not a client: "${phrase}"`);
      hardDecline = true;
      jobSeeker = true;
      break;
    }
  }
  for (const phrase of SCAM) {
    if (text.includes(phrase)) {
      redFlags.push(`Scam pattern: "${phrase}"`);
      hardDecline = true;
      break;
    }
  }

  // ---- B: Budget ----
  const budget = parseBudget(`${gig.title || ''} ${gig.body || ''}`);
  const walk = rc.hourly?.walk_away ?? 30;
  const target = rc.hourly?.target ?? 60;
  const projMin = rc.project?.min ?? 300;
  let B = 2.5;
  if (declined.some((d) => text.includes(d))) {
    B = 1;
    reasons.push('Budget: unpaid / declined model');
  } else if (budget) {
    if (budget.unit === 'annual') {
      // An annual salary means a full-time employment posting, not a freelance gig.
      B = 1.5;
      reasons.push('Annual salary — full-time role, not a project budget');
      redFlags.push(`Salaried full-time posting (${budget.raw})`);
    } else if (budget.unit === 'hourly') {
      const rate = budget.max;
      if (rate < walk) { B = 1.5; reasons.push(`$${rate}/hr below $${walk} walk-away`); }
      else if (rate < target) { B = 3.5; reasons.push(`$${rate}/hr between walk-away and target`); }
      else { B = 5; reasons.push(`$${rate}/hr at or above $${target} target`); }
    } else {
      const val = budget.max;
      if (val < projMin) { B = 2; reasons.push(`$${val} project below $${projMin} minimum`); }
      else { B = 4; reasons.push(`$${val} project at or above minimum`); }
    }
  } else {
    reasons.push('Budget not specified');
  }

  // ---- A: Archetype fit ----
  const keys = archetypeKeywords(profile);
  const hits = [...new Set(keys.filter((k) => k && text.includes(k)))];
  let A;
  if (hits.length >= 2) { A = 5; reasons.push(`Strong archetype match: ${hits.slice(0, 3).join(', ')}`); }
  else if (hits.length === 1) { A = 3.5; reasons.push(`Partial archetype match: ${hits[0]}`); }
  else { A = 2; reasons.push('No archetype keyword match'); }

  // ---- C: Scope clarity (nudged only) ----
  const green = (profile.ideal_gig?.green_flags || []).map(lc);
  const yellow = (profile.ideal_gig?.yellow_flags || []).map(lc);
  const avoid = (profile.ideal_gig?.avoid_scope || []).map(lc);
  let C = 2.5;
  C += Math.min(1.5, green.filter((g) => g && text.includes(g)).length * 0.75);
  C -= Math.min(1.5, yellow.filter((y) => y && text.includes(y)).length * 0.75);
  if (avoid.some((a) => a && text.includes(a))) C = Math.min(C, 2);
  C = clamp(C);

  // ---- D: Legitimacy (nudged only) ----
  let D = 3;
  if (hardDecline) D = 1;

  // ---- E: Channel ----
  let E = 3;
  if (/\b(dm|pm me|message me)\b/.test(text)) E = 3.5;
  else if (/@|\bemail\b/.test(text)) E = 4;
  const normalizedPriority = normalizePriority(priority);
  if (normalizedPriority === 1) E += 0.75;
  else if (normalizedPriority === 3) E -= 0.75;
  E = clamp(E);

  // ---- F: Timing ----
  const age = daysSince(gig.firstSeen);
  let F = 3;
  if (age === null) F = 3;
  else if (age <= 7) F = 5;
  else if (age <= 21) F = 4;
  else if (age <= 45) F = 3;
  else if (age <= 90) F = 2;
  else { F = 1; reasons.push(`Stale: ${age} days old`); }

  const blocks = { A, B, C, D, E, F };
  let score = A * 0.25 + B * 0.25 + C * 0.2 + D * 0.15 + E * 0.1 + F * 0.05;
  score = Math.round(score * 10) / 10;

  let verdict;
  if (hardDecline || B === 1) verdict = 'DECLINE';
  else if (score >= 4.0) verdict = 'GO';
  else if (score >= 3.0) verdict = 'NEGOTIATE';
  else verdict = 'DECLINE';

  return { score, blocks, reasons, redFlags, verdict, budget, jobSeeker };
}

const PIPE_LINE = /^- \[( |x)\]\s+(.+)$/;

function parsePipelineLines(text) {
  const items = [];
  for (const raw of text.split('\n')) {
    const m = raw.match(PIPE_LINE);
    if (!m) continue;
    const parts = m[2].split('|').map((s) => s.trim());
    const url = parts[0];
    if (!/^https?:\/\//.test(url)) continue;
    const tier = m[2].match(/\btier:([1-3])\b/)?.[1];
    items.push({ url, status: parts[1] || null, title: parts[2] || null, priority: tier ? Number(tier) : null });
  }
  return items;
}

function parseScanHistory(text) {
  const rows = {};
  const lines = text.split('\n').filter(Boolean);
  if (lines.length === 0) return rows;
  const header = lines[0].split('\t');
  const idx = (name) => header.indexOf(name);
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    const url = cols[idx('url')];
    if (!url) continue;
    rows[url] = {
      first_seen: cols[idx('first_seen')] || null,
      portal: cols[idx('portal')] || null,
      title: cols[idx('title')] || null,
      location: cols[idx('location')] || null,
      priority: Number.parseInt(cols[idx('priority')], 10),
    };
  }
  return rows;
}

function sourceFromUrl(url) {
  const m = url.match(/reddit\.com\/r\/([^/]+)/i);
  if (m) return `r/${m[1]}`;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

/**
 * Score every gig in the pipeline and write the derived scores.json.
 * @returns {Promise<Record<string, object>>}
 */
export async function scoreAll({ pipelinePath, scanHistoryPath, profilePath, scoresPath }) {
  const [pipelineText, historyText, profileText] = await Promise.all([
    readFile(pipelinePath, 'utf8').catch(() => ''),
    readFile(scanHistoryPath, 'utf8').catch(() => ''),
    readFile(profilePath, 'utf8').catch(() => ''),
  ]);
  const profile = (profileText && yaml.load(profileText)) || {};
  const items = parsePipelineLines(pipelineText);
  const history = parseScanHistory(historyText);

  const out = {};
  for (const it of items) {
    const h = history[it.url] || {};
    const title = h.title || it.title || it.url;
    const gig = {
      url: it.url,
      title,
      body: '',
      source: sourceFromUrl(it.url) || h.portal || null,
      firstSeen: h.first_seen || null,
    };
    const priority = normalizePriority(Number.isInteger(h.priority) ? h.priority : it.priority);
    const r = scoreGig(gig, profile, priority);
    out[it.url] = {
      title,
      source: gig.source,
      first_seen: gig.firstSeen,
      priority,
      budget: r.budget,
      score: r.score,
      blocks: r.blocks,
      reasons: r.reasons,
      redFlags: r.redFlags,
      verdict: r.verdict,
      jobSeeker: r.jobSeeker,
      state: 'estimated',
      report: null,
      scoredAt: new Date().toISOString(),
    };
  }
  await writeFile(scoresPath, JSON.stringify(out, null, 2));
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = process.cwd();
  scoreAll({
    pipelinePath: path.join(root, 'data', 'pipeline.md'),
    scanHistoryPath: path.join(root, 'data', 'scan-history.tsv'),
    profilePath: path.join(root, 'config', 'profile.yml'),
    scoresPath: path.join(root, 'data', 'scores.json'),
  })
    .then((out) => console.log(`Scored ${Object.keys(out).length} gigs → data/scores.json`))
    .catch((e) => { console.error(e); process.exit(1); });
}
