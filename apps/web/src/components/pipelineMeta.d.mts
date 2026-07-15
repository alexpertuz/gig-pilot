export type SourceFamily = 'reddit' | 'hacker-news' | 'remote-ok' | 'generic';

export interface SourceIdentity {
  family: SourceFamily;
  label: string;
  detail: string;
  initial: string;
}

export type PostingFreshness = 'fresh' | 'recent' | 'aged' | 'stale';

export interface PostedAt {
  relative: string;
  date: string;
  time: string;
  freshness: PostingFreshness;
}

export function sourceIdentity(source: string | null | undefined): SourceIdentity;
export function formatPostedAt(iso: string | null | undefined, now?: number): PostedAt | null;
