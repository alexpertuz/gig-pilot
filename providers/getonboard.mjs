// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

const API_BASE = 'https://www.getonbrd.com/api/v0/categories';

/** @param {unknown} value */
function text(value) {
  return typeof value === 'string' ? value.trim() : (typeof value === 'number' ? String(value) : '');
}

/** @param {unknown} value */
function stripHtml(value) {
  return text(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/gi, (_match, entity) => ({
      amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'",
    })[entity.toLowerCase()] || _match)
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {unknown} value */
function validHttpUrl(value) {
  const candidate = text(value);
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

/** @param {any} company */
function companyName(company) {
  if (typeof company === 'string') return company.trim();
  if (!company || typeof company !== 'object') return '';
  return text(company.name)
    || text(company.company_name)
    || text(company.attributes?.name)
    || text(company.data?.attributes?.name);
}

/** @param {any} attributes */
function budgetFrom(attributes) {
  const values = [];
  for (const key of ['budget', 'salary', 'salary_range', 'rate', 'hourly_rate', 'compensation']) {
    const value = text(attributes[key]);
    if (value) values.push(value);
  }
  for (const [minKey, maxKey] of [
    ['min_salary', 'max_salary'],
    ['salary_min', 'salary_max'],
    ['min_rate', 'max_rate'],
    ['rate_min', 'rate_max'],
  ]) {
    const min = text(attributes[minKey]);
    const max = text(attributes[maxKey]);
    if (min || max) values.push(min && max ? `${min} - ${max}` : (min || max));
  }
  return [...new Set(values)].join(' | ');
}

/**
 * Normalize one Get on Board job resource, accepting direct and JSON:API
 * wrappers. Invalid/incomplete jobs return null so callers never emit them.
 * @param {unknown} job
 * @returns {{title: string, url: string, company: string, poster: string, location: string, description: string, budget?: string} | null}
 */
export function normalizeJob(job) {
  if (!job || typeof job !== 'object') return null;
  const resource = /** @type {any} */ (job).data && typeof /** @type {any} */ (job).data === 'object' && !Array.isArray(/** @type {any} */ (job).data)
    ? /** @type {any} */ (job).data
    : job;
  const attributes = resource?.attributes && typeof resource.attributes === 'object'
    ? resource.attributes
    : resource;
  if (!attributes || typeof attributes !== 'object') return null;

  const title = text(attributes.title || attributes.name);
  const url = validHttpUrl(
    resource?.links?.public_url
      || resource?.links?.url
      || attributes.url
      || attributes.public_url
      || attributes.link,
  );
  if (!title || !url) return null;
  const company = companyName(attributes.company) || text(attributes.company_name) || 'Get on Board';
  const location = attributes.remote === true ? 'remote' : text(attributes.location || attributes.location_name);
  const description = stripHtml(attributes.description || attributes.description_html || attributes.body);
  const budget = budgetFrom(attributes);
  return {
    title,
    url,
    company,
    poster: company,
    location,
    description,
    ...(budget ? { budget } : {}),
  };
}

/** @type {Provider} */
export default {
  id: 'getonboard',

  /**
   * @param {{ categories?: unknown }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any> }} ctx
   */
  async fetch(entry, ctx) {
    const categories = entry?.categories;
    if (!Array.isArray(categories) || categories.length === 0 || categories.some(category => typeof category !== 'string' || !category.trim())) {
      throw new Error('getonboard: entry.categories must be a non-empty array of category strings');
    }

    const jobs = await Promise.all(categories.map(async category => {
      const url = `${API_BASE}/${encodeURIComponent(category.trim())}/jobs`;
      const payload = await ctx.fetchJson(url, { redirect: 'error' });
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
        throw new Error('getonboard: unexpected API response — expected a JSON:API data array');
      }
      return payload.data.map(normalizeJob).filter(Boolean);
    }));
    return jobs.flat();
  },
};
