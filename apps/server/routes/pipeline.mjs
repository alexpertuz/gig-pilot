import { Router } from 'express';
import { readPipeline, writePipeline } from '../lib/files.mjs';

const r = Router();
r.get('/', async (_req, res) => res.json({ items: await readPipeline() }));
r.post('/', async (req, res) => {
  const { url, title = null } = req.body;
  if (!/^https?:\/\//.test(url || '')) return res.status(400).json({ error: { message: 'invalid url' } });
  const items = await readPipeline();
  if (items.some((i) => i.url === url)) return res.status(409).json({ error: { message: 'already in pipeline' } });
  items.push({ url, status: 'new', title, checked: false });
  await writePipeline(items);
  res.status(201).json({ items });
});
r.patch('/', async (req, res) => {
  const { url, status, checked } = req.body;
  const items = await readPipeline();
  const it = items.find((i) => i.url === url);
  if (!it) return res.status(404).json({ error: { message: 'not found' } });
  if (status !== undefined) it.status = status;
  if (checked !== undefined) it.checked = checked;
  await writePipeline(items);
  res.json({ items });
});
export default r;
