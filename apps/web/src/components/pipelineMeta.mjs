const DAY_MS = 86_400_000;

/**
 * @param {string | null | undefined} source
 * @returns {{ family: 'reddit' | 'hacker-news' | 'remote-ok' | 'generic', label: string, detail: string, initial: string }}
 */
export function sourceIdentity(source) {
  const cleaned = typeof source === 'string' ? source.trim().replace(/\s+/g, ' ') : '';
  const normalized = cleaned.toLowerCase().replace(/[._-]+/g, ' ');

  if (/^r\//i.test(cleaned)) {
    return { family: 'reddit', label: 'Reddit', detail: cleaned, initial: 'R' };
  }
  if (normalized === 'reddit' || normalized.startsWith('reddit ')) {
    return { family: 'reddit', label: 'Reddit', detail: cleaned === 'Reddit' ? '' : cleaned, initial: 'R' };
  }
  if (normalized === 'hn' || normalized === 'hacker news' || normalized === 'hackernews') {
    return { family: 'hacker-news', label: 'Hacker News', detail: '', initial: 'Y' };
  }
  if (normalized === 'remote ok' || normalized === 'remoteok') {
    return { family: 'remote-ok', label: 'Remote OK', detail: '', initial: 'R' };
  }

  const initial = cleaned.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() || '↗';
  return { family: 'generic', label: cleaned || 'Source', detail: '', initial };
}

/**
 * @param {string | null | undefined} iso
 * @param {number} [now]
 * @returns {{ relative: string, date: string, time: string, freshness: 'fresh' | 'recent' | 'aged' | 'stale' } | null}
 */
export function formatPostedAt(iso, now = Date.now()) {
  if (!iso) return null;
  const postedAt = Date.parse(iso);
  if (!Number.isFinite(postedAt)) return null;

  const value = new Date(postedAt);
  const current = new Date(now);
  const postedDay = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const currentDay = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  const days = Math.max(0, Math.round((currentDay - postedDay) / DAY_MS));
  const relative = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  const freshness = days <= 3 ? 'fresh' : days <= 14 ? 'recent' : days <= 45 ? 'aged' : 'stale';

  return {
    relative,
    date: new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(value),
    time: new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(value),
    freshness,
  };
}
