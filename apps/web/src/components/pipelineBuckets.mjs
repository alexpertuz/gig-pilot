const PASS_STATUSES = new Set(['dropped', 'passed', 'declined']);

function byScore(a, b) {
  return (b.score ?? -1) - (a.score ?? -1);
}

function hasConfirmedScore(item) {
  return item.eligibility === 'eligible'
    && item.state === 'evaluated'
    && Number.isFinite(item.score);
}

function isActiveFit(item) {
  return hasConfirmedScore(item)
    && item.score >= 3
    && item.verdict !== 'DECLINE'
    && Number(item.blocks?.A) >= 3
    && Number(item.blocks?.B) > 1;
}

export function partitionPipelineItems(items) {
  const buckets = {
    active: [],
    lowFit: [],
    quarantine: [],
    rejected: [],
  };

  for (const item of items) {
    const manuallyPassed = PASS_STATUSES.has(String(item.status || '').toLowerCase());
    if (item.jobSeeker || item.eligibility === 'rejected' || manuallyPassed) {
      buckets.rejected.push(item);
    } else if (!hasConfirmedScore(item)) {
      buckets.quarantine.push(item);
    } else if (isActiveFit(item)) {
      buckets.active.push(item);
    } else {
      buckets.lowFit.push(item);
    }
  }

  for (const list of Object.values(buckets)) list.sort(byScore);
  return buckets;
}
