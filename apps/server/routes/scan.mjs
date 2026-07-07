import { Router } from 'express';
import { runNode } from '../lib/cli.mjs';

const r = Router();
r.post('/', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders?.();
  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  const args = Array.isArray(req.body?.args) ? req.body.args : [];
  const result = await runNode('scan.mjs', args, {
    onLine: (l) => send('line', l),
    onErr: (e) => send('stderr', e),
  });
  send('done', { code: result.code });
  res.end();
});
export default r;
