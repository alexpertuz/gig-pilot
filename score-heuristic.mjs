import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

const HOURLY_HINT = /\b(hour|hourly|per hour|an hour)\b|\/\s*hr/i;

/**
 * Parse a compensation signal out of free text.
 * @returns {{raw:string,min:number|null,max:number|null,unit:'hourly'|'project'}|null}
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
  // Hourly only when the text says so; otherwise treat a bare amount as a project budget.
  const unit = HOURLY_HINT.test(text) ? 'hourly' : 'project';
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
const SCAM = [
  'daily income', 'turn your charm', '% from each', 'earn 50', 'earn $', 'copy paste',
  'copy-paste', 'per day', '/day', 'passive income', 'no experience needed',
];

const lc = (s) => (s || '').toLowerCase();
const clamp = (n, lo = 1, hi = 5) => Math.max(lo, Math.min(hi, n));

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
 * @returns {{score:number, blocks:object, reasons:string[], redFlags:string[], verdict:string, budget:object|null}}
 */
export function scoreGig(gig, profile = {}) {
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
  for (const phrase of JOB_SEEKER) {
    if (text.includes(phrase)) {
      redFlags.push(`Job-seeker, not a client: "${phrase}"`);
      hardDecline = true;
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
    if (budget.unit === 'hourly') {
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

  return { score, blocks, reasons, redFlags, verdict, budget };
}
