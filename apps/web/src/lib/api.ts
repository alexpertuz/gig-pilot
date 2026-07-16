const API_DEV_HINT =
  'API backend unavailable. Start `npm run ui:dev` from the repo root; it starts both the API on 127.0.0.1:4317 and the web UI on 127.0.0.1:5273.';

function isGenericServerError(message: string | undefined, status: number): boolean {
  if (status < 500) return false;
  const text = (message || '').trim().toLowerCase();
  return !text || text === 'internal server error' || text === 'bad gateway' || text === 'service unavailable';
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = (body as any)?.error?.message || res.statusText;
    if (isGenericServerError(message, res.status)) {
      throw new Error(`${message}. ${API_DEV_HINT}`);
    }
    throw new Error(message);
  }
  return res.json();
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (error instanceof TypeError || /fetch/i.test(message) || /network/i.test(message)) {
      throw new Error(API_DEV_HINT);
    }
    throw error;
  }
}

export interface Budget {
  raw?: string;
  min?: number | null;
  max?: number | null;
  unit?: 'hourly' | 'annual' | 'monthly' | 'project' | 'unknown' | null;
}

export interface TriageEvidence {
  quote: string;
  meaning: string;
}

export interface PipelineItem {
  url: string;
  status: string | null;
  title: string | null;
  checked: boolean;
  inPipeline: boolean;
  score: number | null;
  verdict: 'GO' | 'NEGOTIATE' | 'DECLINE' | null;
  blocks: { A: number; B: number; C: number; D: number; E: number; F: number } | null;
  jobSeeker: boolean;
  state: 'estimated' | 'evaluated' | null;
  eligibility: 'eligible' | 'rejected' | 'uncertain';
  confidence: number | null;
  intent: 'client_hiring' | 'worker_seeking' | 'discussion' | 'promotion' | 'unknown';
  engagement: 'freelance' | 'project' | 'contract' | 'part_time' | 'full_time' | 'unpaid' | 'unknown';
  relationship: 'independent' | 'employee' | 'unknown';
  paid: boolean | null;
  triageOrigin: 'model' | 'rule' | 'system' | null;
  triageReasons: string[];
  triageEvidence: TriageEvidence[];
  budget: Budget | null;
  source: string | null;
  location: string | null;
  firstSeen: string | null;
  reasons: string[];
  redFlags: string[];
  report: string | null;
}

export type ScanStatus = 'idle' | 'running' | 'completed' | 'completed_with_issues' | 'failed';

export interface ScanState {
  status: ScanStatus;
  phase: 'idle' | 'preparing' | 'scanning' | 'verifying' | 'triaging' | 'summarizing' | 'scoring' | 'finished';
  startedAt: string | null;
  finishedAt: string | null;
  scope: { companies: number; jobBoards: number; localParsers: number; skipped: number };
  progress: { completed: number; total: number; currentSource: string | null; jobsInspected: number };
  summary: {
    totalJobsFound: number;
    filtered: number;
    duplicates: number;
    newOffersAdded: number;
    ruleRejected: number;
    modelEvaluated: number;
    cached: number;
    accepted: number;
    quarantined: number;
    bySource: Record<string, { fetched: number; accepted: number; rejected: number; quarantined: number }>;
  };
  issues: string[];
  newItems: PipelineItem[];
  log: Array<{ kind: 'stdout' | 'stderr'; text: string }>;
}

export interface AgentProviderHealth {
  id: string;
  label: string;
  connected: boolean;
  version: string | null;
  bin: string;
  error?: string;
}

export interface Health {
  provider: string;
  activeProvider: string;
  providers: Record<string, AgentProviderHealth>;
  claude: boolean;
  version: string | null;
  repoRoot: string;
}

export function getAgentProvider() {
  return localStorage.getItem('gigpilot.agentProvider') || undefined;
}

export function setAgentProvider(provider: string) {
  localStorage.setItem('gigpilot.agentProvider', provider);
}

export const api = {
  scanState: () => apiFetch('/api/scan').then(j<{ scan: ScanState }>),
  pipeline: () => apiFetch('/api/pipeline').then(j<{ items: PipelineItem[] }>),
  addUrl: (url: string, title?: string) =>
    apiFetch('/api/pipeline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, title }),
    }).then(j<{ items: PipelineItem[] }>),
  patchItem: (url: string, patch: { status?: string; checked?: boolean }) =>
    apiFetch('/api/pipeline', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, ...patch }),
    }).then(j<{ items: PipelineItem[] }>),
  leads: (q = '') => apiFetch(`/api/leads${q}`).then(j<{ leads: any[] }>),
  reports: () => apiFetch('/api/reports').then(j<{ reports: any[] }>),
  report: (file: string) => apiFetch(`/api/reports/${file}`).then(j<{ markdown: string }>),
  config: (name: string) => apiFetch(`/api/config/${name}`).then(j<{ data: any; raw: string }>),
  saveConfig: (name: string, payload: { data?: any; raw?: string }) =>
    apiFetch(`/api/config/${name}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(j),
  stats: () => apiFetch('/api/stats').then(j<any>),
  health: () => apiFetch('/api/health').then(j<Health>),
  runMode: (mode: string, args: any) =>
    apiFetch('/api/modes/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, args, provider: getAgentProvider() }),
    }).then(j<{ jobId: string }>),
};
