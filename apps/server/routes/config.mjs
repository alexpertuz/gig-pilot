import { Router } from 'express';
import fs from 'node:fs/promises';
import { paths } from '../lib/paths.mjs';
import { readYaml, writeYaml, atomicWrite } from '../lib/files.mjs';

const r = Router();
const FILES = { profile: paths.profile, sources: paths.sources };

r.get('/:name', async (req, res) => {
  const fp = FILES[req.params.name];
  if (!fp) return res.status(404).json({ error: { message: 'unknown config' } });
  const raw = await fs.readFile(fp, 'utf8').catch(() => '');
  const data = raw ? await readYaml(fp).catch(() => ({})) : {};
  res.json({ data, raw });
});
r.put('/:name', async (req, res) => {
  const fp = FILES[req.params.name];
  if (!fp) return res.status(404).json({ error: { message: 'unknown config' } });
  try {
    if (typeof req.body.raw === 'string') await atomicWrite(fp, req.body.raw);
    else await writeYaml(fp, req.body.data);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: { message: e.message } });
  }
});
export default r;
