import { Router } from 'express';
import { startJob, subscribe, getJob } from '../lib/claude.mjs';

const r = Router();
r.post('/run', (req, res) => {
  const { mode, args, provider } = req.body;
  try {
    res.json(startJob(mode, args || {}, provider));
  } catch (e) {
    res.status(400).json({ error: { message: e.message } });
  }
});
r.get('/stream/:jobId', (req, res) => {
  if (!getJob(req.params.jobId)) return res.status(404).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders?.();
  const unsub = subscribe(req.params.jobId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'done') {
      unsub();
      res.end();
    }
  });
  req.on('close', unsub);
});
export default r;
