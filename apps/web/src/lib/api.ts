async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any)?.error?.message || res.statusText);
  }
  return res.json();
}

export interface PipelineItem {
  url: string;
  status: string | null;
  title: string | null;
  checked: boolean;
}

export const api = {
  pipeline: () => fetch('/api/pipeline').then(j<{ items: PipelineItem[] }>),
  addUrl: (url: string, title?: string) =>
    fetch('/api/pipeline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, title }),
    }).then(j<{ items: PipelineItem[] }>),
  patchItem: (url: string, patch: { status?: string; checked?: boolean }) =>
    fetch('/api/pipeline', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, ...patch }),
    }).then(j<{ items: PipelineItem[] }>),
  leads: (q = '') => fetch(`/api/leads${q}`).then(j<{ leads: any[] }>),
  reports: () => fetch('/api/reports').then(j<{ reports: any[] }>),
  report: (file: string) => fetch(`/api/reports/${file}`).then(j<{ markdown: string }>),
  config: (name: string) => fetch(`/api/config/${name}`).then(j<{ data: any; raw: string }>),
  saveConfig: (name: string, payload: { data?: any; raw?: string }) =>
    fetch(`/api/config/${name}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(j),
  stats: () => fetch('/api/stats').then(j<any>),
  health: () => fetch('/api/health').then(j<{ claude: boolean; version: string | null; repoRoot: string }>),
  runMode: (mode: string, args: any) =>
    fetch('/api/modes/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, args }),
    }).then(j<{ jobId: string }>),
};
