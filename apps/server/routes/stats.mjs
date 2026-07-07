import { Router } from 'express';
import { readPipeline } from '../lib/files.mjs';
import { queryLeads } from '../lib/cli.mjs';

const r = Router();
r.get('/', async (_req, res) => {
  const [items, leads] = await Promise.all([readPipeline(), queryLeads().catch(() => [])]);
  const byStatus = {};
  for (const l of leads) {
    const s = (l.status || l.Status || 'unknown').toLowerCase();
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  res.json({
    pipeline: { total: items.length, unevaluated: items.filter((i) => !i.checked).length },
    leads: { total: leads.length, byStatus },
  });
});
export default r;
