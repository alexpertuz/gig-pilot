// Pure, framework-free helpers for the AI Console evaluation flow.
// Kept in .mjs so they are unit-testable with `node --test`, mirroring
// the pattern in apps/web/src/components/pipelineBuckets.mjs.

export const EVAL_PHASES = [
  'Reading the posting…',
  'Sizing up the budget…',
  'Checking scope & deliverables…',
  'Vetting the poster…',
  'Scanning for red flags…',
  'Scoring fit across the board…',
  'Writing your report…',
];

// Advance the phrase index, holding on the last phrase (never wraps).
export function nextPhaseIndex(current, total) {
  return Math.min(current + 1, total - 1);
}

// Find the pipeline item for `url` and return its report path without the
// leading `reports/` prefix, or null when there is no match or no report.
export function resolveReportFile(items, url) {
  if (!Array.isArray(items) || !url) return null;
  const match = items.find((it) => it && it.url === url);
  const report = match && match.report;
  if (!report) return null;
  return String(report).replace(/^reports\//, '');
}
