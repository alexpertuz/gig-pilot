import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, '..', '..');
const apiPort = process.env.PORT || '4317';

const children = new Set();
let shuttingDown = false;

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: 'inherit',
  });

  children.add(child);

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;

    const detail = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[dev] ${name} exited with ${detail}`);
    stopAll(code || 1);
  });

  return child;
}

function stopAll(code = 0) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 100);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

console.log(`[dev] starting API on http://127.0.0.1:${apiPort}`);
start('api', process.execPath, ['apps/server/index.mjs'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: apiPort,
    GIGPILOT_ROOT: process.env.GIGPILOT_ROOT || repoRoot,
  },
});

console.log('[dev] starting web on http://127.0.0.1:5273');
start('web', process.execPath, [path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js')], {
  cwd: webRoot,
});
