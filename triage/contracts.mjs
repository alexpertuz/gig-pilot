import { createHash } from 'node:crypto';

export const MAX_CONTENT_CHARS = 12_000;
export const CLASSIFIER_VERSION = 'precision-triage-v1';
export const RUBRIC_VERSION = 'gig-rubric-v1';

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const HOURLY = /(?:\/\s*h(?:r|our)?\b|\bper\s+hour\b|\bhourly\b)/i;
const ANNUAL = /(?:\/\s*(?:year|yr)\b|\bper\s+year\b|\ba\s+year\b|\bannual(?:ly)?\b|\byearly\b|\bper\s+annum\b|\bp\.a\.\b)/i;
const MONTHLY = /(?:\/\s*(?:month|mo)\b|\bper\s+month\b|\bmonthly\b)/i;
const PROJECT = /\b(?:fixed(?:-price)?|flat\s+fee|project\s+(?:budget|rate|fee)|one[ -]?time|milestone|budget(?:ed)?\s+(?:at|of|is|:))\b/i;

export function normalizeText(value, maxLength = MAX_CONTENT_CHARS) {
  if (value == null) return '';
  return String(value)
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARACTERS, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function nullableText(value, maxLength) {
  const normalized = normalizeText(value, maxLength);
  return normalized || null;
}

function normalizeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function moneyAmounts(text) {
  const values = [];
  const pattern = /(?:\$|USD\s*|EUR\s*|GBP\s*|€\s*|£\s*)([\d,]+(?:\.\d+)?)/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const amount = Number(match[1].replace(/,/g, ''));
    if (Number.isFinite(amount)) values.push(amount);
  }
  return values;
}

function currencyFrom(text) {
  if (/€|\bEUR\b/i.test(text)) return 'EUR';
  if (/£|\bGBP\b/i.test(text)) return 'GBP';
  if (/\$|\bUSD\b/i.test(text)) return 'USD';
  return null;
}

export function normalizeCompensation(rawBudget, text = '') {
  const raw = normalizeText(rawBudget, 300);
  const haystack = normalizeText(`${raw}\n${text}`, MAX_CONTENT_CHARS + 400);
  const amounts = moneyAmounts(haystack);
  let cadence = 'unknown';
  if (HOURLY.test(haystack)) cadence = 'hourly';
  else if (ANNUAL.test(haystack)) cadence = 'annual';
  else if (MONTHLY.test(haystack)) cadence = 'monthly';
  else if (PROJECT.test(haystack)) cadence = 'project';

  return {
    raw: raw || (haystack.match(/(?:\$|USD\s*|EUR\s*|GBP\s*|€\s*|£\s*)[\d,]+(?:\.\d+)?(?:\s*(?:-|–|to)\s*(?:\$|USD\s*|EUR\s*|GBP\s*|€\s*|£\s*)?[\d,]+(?:\.\d+)?)?/i)?.[0] ?? null),
    min: amounts.length > 1 ? Math.min(...amounts) : null,
    max: amounts.length > 0 ? Math.max(...amounts) : null,
    currency: currencyFrom(haystack),
    cadence,
  };
}

function normalizeSignals(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeText(item, 120)).filter(Boolean))];
}

export function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function candidateText(candidate) {
  return normalizeText(`${candidate?.title || ''}\n${candidate?.description || ''}`, MAX_CONTENT_CHARS + 600);
}

export function normalizeCandidate(offer, context = {}) {
  const url = normalizeHttpUrl(offer?.url);
  if (!url) throw new Error('candidate requires a valid HTTP URL');
  const title = normalizeText(offer?.title, 500);
  if (!title) throw new Error('candidate requires a non-empty title');

  const description = normalizeText(offer?.description, MAX_CONTENT_CHARS);
  const source = normalizeText(offer?.source || context.source, 120) || new URL(url).hostname;
  const provider = normalizeText(context.provider || offer?.provider, 80) || 'unknown';
  const firstSeen = normalizeText(context.firstSeen, 40) || new Date().toISOString().slice(0, 10);
  const candidate = {
    url,
    title,
    description,
    source,
    provider,
    poster: nullableText(offer?.poster, 120),
    company: nullableText(offer?.company, 160),
    postedAt: nullableText(offer?.postedAt, 40),
    firstSeen,
    location: nullableText(offer?.location, 200),
    compensation: normalizeCompensation(offer?.budget, `${title}\n${description}`),
    paymentModel: nullableText(offer?.paymentModel, 40),
    sourceSignals: normalizeSignals(offer?.sourceSignals),
  };

  return { ...candidate, contentHash: hashJson(candidate) };
}
