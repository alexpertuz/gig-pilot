// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

const ALGOLIA_API = 'https://hn.algolia.com/api/v1';
const COMMENT_URL = 'https://news.ycombinator.com/item?id=';
const FREELANCER_PREFIX = /^SEEKING\s+FREELANCER\b/i;
const FLEXIBLE_WORK = /\b(?:contract(?:or)?|freelanc(?:e|er|ing)|part[ -]?time)\b/i;

/**
 * Convert the small HTML subset returned by HN's Algolia API to plain text.
 * @param {unknown} value
 * @returns {string}
 */
export function stripHtml(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|blockquote|pre|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/gi, (_match, entity) => ({
      amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'",
    })[entity.toLowerCase()] || _match)
    .replace(/&#(x[\da-f]+|\d+);/gi, (_match, code) => {
      const value = String(code).toLowerCase().startsWith('x')
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isFinite(value) && value <= 0x10FFFF ? String.fromCodePoint(value) : _match;
    })
    .replace(/\r/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** @param {unknown} comment */
function normalizeComment(comment) {
  if (!comment || typeof comment !== 'object') return null;
  const raw = /** @type {{ objectID?: unknown, id?: unknown, author?: unknown, comment_text?: unknown, text?: unknown }} */ (comment);
  const id = typeof raw.objectID === 'string' || typeof raw.objectID === 'number'
    ? String(raw.objectID)
    : (typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : '');
  const description = stripHtml(raw.comment_text ?? raw.text);
  if (!id || !description) return null;
  const poster = typeof raw.author === 'string' && raw.author.trim() ? raw.author.trim() : 'HN';
  const title = description.split('\n').find(Boolean)?.trim() || description;
  return {
    title,
    url: `${COMMENT_URL}${encodeURIComponent(id)}`,
    company: poster,
    poster,
    location: '',
    description,
  };
}

/**
 * @param {unknown[]} comments
 * @returns {Array<{title: string, url: string, company: string, poster: string, location: string, description: string}>}
 */
export function normalizeFreelancerComments(comments) {
  if (!Array.isArray(comments)) return [];
  return comments
    .map(normalizeComment)
    .filter(comment => comment && FREELANCER_PREFIX.test(comment.description));
}

/**
 * @param {unknown[]} comments
 * @returns {Array<{title: string, url: string, company: string, poster: string, location: string, description: string}>}
 */
export function normalizeWhoIsHiringComments(comments) {
  if (!Array.isArray(comments)) return [];
  return comments
    .map(normalizeComment)
    .filter(comment => comment && FLEXIBLE_WORK.test(comment.description));
}

function storySearchUrl(thread) {
  const query = thread === 'freelancer'
    ? 'Freelancer? Seeking freelancer?'
    : 'Ask HN: Who is hiring?';
  const params = new URLSearchParams({ query, tags: 'story', hitsPerPage: '20' });
  return `${ALGOLIA_API}/search_by_date?${params}`;
}

/**
 * Select only the canonical monthly Ask HN thread. Algolia search is fuzzy and
 * can rank newer Show HN posts above the real thread, so hit order alone is not
 * an eligibility signal.
 * @param {unknown[]} hits
 * @param {'freelancer'|'whoishiring'} thread
 */
export function selectMonthlyStory(hits, thread) {
  if (!Array.isArray(hits)) return null;
  const expected = thread === 'freelancer'
    ? /^Ask HN:\s*Freelancer\?\s*Seeking freelancer\?\s*\([A-Za-z]+\s+\d{4}\)$/i
    : /^Ask HN:\s*Who is hiring\?\s*\([A-Za-z]+\s+\d{4}\)$/i;
  return hits.find(hit => hit
    && (typeof hit.objectID === 'string' || typeof hit.objectID === 'number')
    && typeof hit.title === 'string'
    && expected.test(hit.title.trim())) || null;
}

/** @type {Provider} */
export default {
  id: 'hn',

  /**
   * @param {{ thread?: unknown }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any> }} ctx
   */
  async fetch(entry, ctx) {
    const thread = entry?.thread;
    if (thread !== 'freelancer' && thread !== 'whoishiring') {
      throw new Error('hn: entry.thread must be "freelancer" or "whoishiring"');
    }

    const stories = await ctx.fetchJson(storySearchUrl(thread), { redirect: 'error' });
    const story = selectMonthlyStory(stories?.hits, thread);
    const storyId = story && (typeof story.objectID === 'string' || typeof story.objectID === 'number')
      ? String(story.objectID)
      : '';
    if (!storyId) throw new Error(`hn: canonical monthly ${thread} story was not found in search results`);

    const params = new URLSearchParams({ tags: `comment,story_${storyId}`, hitsPerPage: '1000' });
    const commentsResponse = await ctx.fetchJson(`${ALGOLIA_API}/search?${params}`, { redirect: 'error' });
    if (!Array.isArray(commentsResponse?.hits)) {
      throw new Error('hn: unexpected comments response — expected a hits array');
    }
    const topLevel = commentsResponse.hits.filter(comment => String(comment?.parent_id) === storyId);
    return thread === 'freelancer'
      ? normalizeFreelancerComments(topLevel)
      : normalizeWhoIsHiringComments(topLevel);
  },
};
