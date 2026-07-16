import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { REPO_ROOT } from './lib/paths.mjs';
import { AGENT_PROVIDERS, normalizeProvider } from './lib/claude.mjs';
import pipeline from './routes/pipeline.mjs';
import leads from './routes/leads.mjs';
import reports from './routes/reports.mjs';
import config from './routes/config.mjs';
import scan from './routes/scan.mjs';
import modes from './routes/modes.mjs';
import stats from './routes/stats.mjs';

const app = express();
app.use(express.json({ limit: '2mb' }));
const execFileAsync = promisify(execFile);

app.use('/api/pipeline', pipeline);
app.use('/api/leads', leads);
app.use('/api/reports', reports);
app.use('/api/config', config);
app.use('/api/scan', scan);
app.use('/api/modes', modes);
app.use('/api/stats', stats);

app.get('/api/health', async (_req, res) => {
  const entries = await Promise.all(Object.values(AGENT_PROVIDERS).map(async (provider) => {
    try {
      const { stdout } = await execFileAsync(provider.bin, provider.versionArgs);
      return [provider.id, {
        id: provider.id,
        label: provider.label,
        connected: true,
        version: stdout.trim(),
        bin: provider.bin,
      }];
    } catch (err) {
      return [provider.id, {
        id: provider.id,
        label: provider.label,
        connected: false,
        version: null,
        bin: provider.bin,
        error: err.message,
      }];
    }
  }));
  const activeProvider = normalizeProvider();
  const providers = Object.fromEntries(entries);
  res.json({
    provider: activeProvider,
    activeProvider,
    providers,
    claude: providers.claude.connected,
    version: providers.claude.version,
    repoRoot: REPO_ROOT,
  });
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT || 4317;
app.listen(PORT, '127.0.0.1', () => console.log(`gig-pilot UI server on http://127.0.0.1:${PORT}`));
