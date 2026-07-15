import { spawn } from 'node:child_process';
import { REPO_ROOT } from './paths.mjs';

export function runNode(script, args = [], { onLine, onErr, env } = {}) {
  return new Promise((resolve) => {
    const proc = spawn('node', [script, ...args], {
      cwd: REPO_ROOT,
      env: env ? { ...process.env, ...env } : process.env,
    });
    let stdout = '';
    let stderr = '';
    let buf = '';
    proc.stdout.on('data', (d) => {
      stdout += d;
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        onLine?.(line);
      }
    });
    proc.stderr.on('data', (d) => {
      stderr += d;
      onErr?.(String(d));
    });
    proc.on('close', (code) => {
      if (buf) onLine?.(buf);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function queryLeads(opts = {}) {
  const args = ['query', '--json'];
  if (opts.status) args.push('--status', opts.status);
  if (opts.limit) args.push('--limit', String(opts.limit));
  const res = await runNode('tracker.mjs', args);
  if (res.code !== 0) {
    if (/not found|no source of truth/i.test(res.stderr)) return [];
    throw new Error(res.stderr.trim() || 'tracker query failed');
  }
  try {
    return JSON.parse(res.stdout);
  } catch {
    return [];
  }
}
