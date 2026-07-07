import express from 'express';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claudeBin, REPO_ROOT } from './lib/paths.mjs';
import pipeline from './routes/pipeline.mjs';
import leads from './routes/leads.mjs';
import reports from './routes/reports.mjs';
import config from './routes/config.mjs';
import scan from './routes/scan.mjs';
import modes from './routes/modes.mjs';
import stats from './routes/stats.mjs';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use('/api/pipeline', pipeline);
app.use('/api/leads', leads);
app.use('/api/reports', reports);
app.use('/api/config', config);
app.use('/api/scan', scan);
app.use('/api/modes', modes);
app.use('/api/stats', stats);

app.get('/api/health', (_req, res) => {
  execFile(claudeBin, ['--version'], (err, stdout) => {
    res.json({ claude: !err, version: err ? null : stdout.trim(), repoRoot: REPO_ROOT });
  });
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT || 4317;
app.listen(PORT, '127.0.0.1', () => console.log(`gig-ops UI server on http://127.0.0.1:${PORT}`));
