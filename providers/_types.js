// providers/_types.js
//
// Documentation-only JSDoc types for the gig-pilot provider contract.
// This file is NOT imported at runtime — it's a catalog for tooling and documentation.
// Providers must implement the Provider interface below.
//
// Import type annotation (for IDE support only):
//   /** @type {import('./_types.js').Provider} */

/**
 * A normalized gig posting.
 * Every provider's fetch() must return an array of these.
 *
 * Fields marked optional may be undefined when the source does not expose them.
 * scan.mjs's filters operate on whichever fields are present; missing fields
 * are treated as "unknown" (not filtered out) unless the filter explicitly
 * requires the field.
 *
 * @typedef {object} Gig
 * @property {string} title       - Gig title or posting subject (required)
 * @property {string} url         - Canonical URL of the posting (required, used for dedup)
 * @property {string} poster      - Poster handle or company name (required)
 * @property {string} source      - Provider ID that produced this entry (required, set by scan.mjs)
 * @property {string} [location]  - Location string ("remote", city, etc.) or empty = remote
 * @property {string} [description] - Full post text. Preserved for source-aware rules and
 *                                    model triage. Always treated as untrusted input.
 * @property {string} [postedAt]  - ISO 8601 date string (YYYY-MM-DD or full datetime)
 * @property {string} [budget]    - Raw budget/rate string from the source
 *                                    e.g. "$50/hr", "$500 fixed", "€800", "negotiable"
 * @property {PaymentModel} [paymentModel] - Normalized payment model (derived by provider or scan.mjs)
 * @property {Channel} [channel]  - How to respond to this gig
 * @property {number} [posterScore] - Source-specific trust score (0–100).
 *                                    For Reddit: derived from account age + karma.
 *                                    Used by legitimacy scoring in modes/gig.md.
 * @property {1|2|3} [priority]    - Resolved source tier stamped by scan.mjs.
 *                                    1 is highest priority; omitted/invalid values resolve to 2.
 * @property {string[]} [sourceSignals] - Source-specific evidence retained for triage.
 * @property {object} [_raw]      - Original source object for debugging (not written to pipeline.md)
 */

/**
 * Payment model of a gig.
 * Providers should set this when the source makes it clear.
 * scan.mjs can also derive it from budget strings via parseBudget.
 *
 * @typedef {'paid'|'hourly'|'fixed'|'equity'|'unpaid'|'unknown'} PaymentModel
 */

/**
 * Channel through which to respond to this gig.
 *
 * @typedef {'dm'|'email'|'comment'|'apply'|'unknown'} Channel
 */

/**
 * A gig source entry from sources.yml.
 * Passed to provider.fetch() as the first argument.
 *
 * @typedef {object} SourceEntry
 * @property {string} name        - Human-readable name (e.g. "r/forhire")
 * @property {string} [provider]  - Explicit provider id override
 * @property {boolean} [enabled]  - Set false to skip
 * @property {string} [subreddit] - For Reddit provider: subreddit name (no r/ prefix)
 * @property {string[]} [search_queries] - For Reddit provider: search terms to use
 * @property {string[]} [tags]    - For RemoteOK/WorkingNomads: tag filters
 * @property {string[]} [categories] - For WorkingNomads and Get on Board: category filters
 * @property {1|2|3} [priority]   - Source scheduling tier; defaults to 2 in scan.mjs
 * @property {'freelancer'|'whoishiring'} [thread] - Hacker News thread to scan
 */

/**
 * Shared context passed to every provider.fetch() call.
 *
 * @typedef {object} FetchContext
 * @property {(url: string, options?: object) => Promise<object>} fetchJson
 *   Fetch JSON from a URL with SSRF protection (redirect: 'error').
 *   Always use this instead of raw fetch() in providers.
 * @property {number} [timeoutMs] - Per-request timeout in ms (default: 10000)
 */

/**
 * The provider contract. Every file in providers/*.mjs must export a default
 * object matching this interface.
 *
 * @typedef {object} Provider
 * @property {string} id          - Unique provider id (e.g. 'reddit', 'remoteok')
 * @property {(entry: SourceEntry) => boolean} [detect]
 *   Optional. Return true if this provider can handle the given entry without
 *   an explicit `provider:` key. Used by scan.mjs to auto-detect providers.
 * @property {(entry: SourceEntry, ctx: FetchContext) => Promise<Gig[]>} fetch
 *   Fetch and normalize gigs from this source. Must return an array of Gig
 *   objects. On error: throw (scan.mjs catches and logs). Never return null.
 */
