import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../lib/paths.mjs';

const r = Router();
r.get('/', async (_req, res) => {
  const files = await fs.readdir(paths.reportsDir).catch(() => []);
  const reports = files
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const m = file.match(/^(\d+)-(.+)-(\d{4}-\d{2}-\d{2})\.md$/);
      return m ? { file, num: m[1], slug: m[2], date: m[3] } : { file, num: null, slug: file, date: null };
    })
    .sort((a, b) => (b.num || '').localeCompare(a.num || ''));
  res.json({ reports });
});
r.get('/:file', async (req, res) => {
  const safe = path.basename(req.params.file);
  const markdown = await fs.readFile(path.join(paths.reportsDir, safe), 'utf8').catch(() => null);
  if (markdown === null) return res.status(404).json({ error: { message: 'not found' } });
  res.json({ markdown });
});
export default r;
