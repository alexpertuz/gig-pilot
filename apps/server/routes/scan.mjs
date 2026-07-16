import { Router } from 'express';
import { runNode } from '../lib/cli.mjs';
import { createScanSession } from '../lib/scan-session.mjs';
import { mergePipeline, readPipeline, readScanHistory, readScores, readTriage } from '../lib/files.mjs';
import { normalizeProvider } from '../../../agent-runtime.mjs';

export function buildScanArgs(args = [], provider) {
  const clean = Array.isArray(args)
    ? args.filter((arg) => typeof arg === 'string' && !arg.startsWith('--agent-provider='))
    : [];
  if (provider == null || provider === '') return clean;
  return [...clean, `--agent-provider=${normalizeProvider(provider)}`];
}

async function readPipelineView() {
  const [items, scores, history, triage] = await Promise.all([
    readPipeline(),
    readScores(),
    readScanHistory(),
    readTriage(),
  ]);
  return mergePipeline(items, scores, history, triage);
}

const session = createScanSession({
  readPipeline: readPipelineView,
  execute: (args, events) => runNode('scan.mjs', args, {
    ...events,
    env: { GIG_PILOT_SCAN_EVENTS: '1' },
  }),
});

const r = Router();

r.get('/', (_req, res) => {
  res.json({ scan: session.getState() });
});

r.post('/', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let connected = true;
  const send = (type, data) => {
    if (connected && !res.writableEnded) res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };
  const unsubscribe = session.subscribe((state) => send('state', state));
  res.on('close', () => {
    connected = false;
    unsubscribe();
  });

  let args;
  try {
    args = buildScanArgs(req.body?.args, req.body?.provider);
  } catch (error) {
    send('error', { message: error.message });
    unsubscribe();
    if (connected && !res.writableEnded) res.end();
    return;
  }
  const result = await session.start(args);
  if (!result.started) send('already_running', result.state);
  send('done', session.getState());
  unsubscribe();
  if (connected && !res.writableEnded) res.end();
});

export default r;
