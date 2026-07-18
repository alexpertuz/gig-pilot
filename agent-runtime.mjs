import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REPO_ROOT = process.env.GIGPILOT_ROOT
  ? path.resolve(process.env.GIGPILOT_ROOT)
  : path.dirname(fileURLToPath(import.meta.url));

// On Windows, spawn/execFile without a shell cannot run the `claude.cmd` shim
// that npm puts on PATH (Node rejects .cmd/.bat for security), so a bare
// 'claude' fails with ENOENT even when the CLI is installed and logged in.
// Probe the known locations of the native claude.exe instead.
function resolveClaudeBin() {
  if (process.env.GIGPILOT_CLAUDE_BIN) return process.env.GIGPILOT_CLAUDE_BIN;
  if (process.platform !== 'win32') return 'claude';
  const home = process.env.USERPROFILE || homedir();
  const candidates = [
    // Native installer (irm https://claude.ai/install.ps1 | iex)
    path.join(home, '.local', 'bin', 'claude.exe'),
    // npm global install ships a native launcher inside the package
    process.env.APPDATA
      ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
      : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'claude';
}

export const claudeBin = resolveClaudeBin();
export const codexBin = process.env.GIGPILOT_CODEX_BIN || 'codex';

export const AGENT_PROVIDERS = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    bin: claudeBin,
    versionArgs: ['--version'],
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    bin: codexBin,
    versionArgs: ['--version'],
  },
};

export function normalizeProvider(provider = process.env.GIGPILOT_AGENT_PROVIDER || 'claude') {
  const id = String(provider || '').trim().toLowerCase();
  if (!AGENT_PROVIDERS[id]) throw new Error(`unknown agent provider: ${provider}`);
  return id;
}

// Directive for headless runs (web console, quality-eval): there is no human to
// answer follow-up questions, so the agent must complete the task on its own.
export const NON_INTERACTIVE_DIRECTIVE = [
  'You are running in a non-interactive session. The user cannot reply, approve prompts, or paste anything.',
  'Never ask the user questions or offer to wait for input — no "want me to…?", no "paste it here", no y/n prompts.',
  'Fetch whatever you need yourself using the pre-approved tooling: run `node fetch-gig.mjs <url>` to retrieve a gig posting (it uses Reddit\'s .rss feed and needs no approval). Do not use WebFetch or curl.',
  'If something cannot be retrieved after a retry, proceed with the information you have, state your assumptions explicitly, and still produce the final deliverable (e.g. the report). Do not stop to ask.',
].join(' ');

export function buildAgentSpawn(
  provider,
  prompt,
  { readOnly = false, ephemeral = readOnly, appendSystemPrompt = '' } = {},
) {
  const id = normalizeProvider(provider);
  const config = AGENT_PROVIDERS[id];
  let args;
  let stdin = id === 'codex' ? prompt : null;
  if (id === 'codex') {
    args = ['exec', '--json'];
    if (ephemeral) args.push('--ephemeral');
    if (readOnly) args.push('--sandbox', 'read-only');
    args.push('--cd', REPO_ROOT, '-');
    // codex exec has no system-prompt flag; prepend the directive to the prompt.
    if (appendSystemPrompt) stdin = `${appendSystemPrompt}\n\n${prompt}`;
  } else {
    // The prompt travels via stdin, not argv: triage batches embed whole gig
    // postings, and Windows caps the command line at ~32K chars, so passing
    // them as an argument fails with spawn ENAMETOOLONG.
    args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);
    if (ephemeral) args.push('--no-session-persistence');
    if (readOnly) args.push('--tools', '');
    stdin = prompt;
  }
  return {
    provider: id,
    bin: config.bin,
    args,
    stdin,
    options: { cwd: REPO_ROOT, stdio: [stdin == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] },
  };
}

function eventText(provider, event) {
  const payload = event?.payload ?? event;
  if (provider === 'codex') {
    if (event?.type === 'item.completed' && event.item?.type === 'agent_message') {
      return { kind: 'final', text: event.item.text || event.item.message || '' };
    }
    if (payload?.type === 'agent_message') {
      return { kind: 'final', text: payload.message || payload.text || '' };
    }
    if (payload?.type === 'task_complete') {
      return { kind: 'final', text: payload.last_agent_message || '' };
    }
    if (/assistant|agent/.test(String(payload?.type || ''))) {
      return { kind: 'stream', text: payload.message || payload.text || '' };
    }
    return null;
  }

  if (event?.type === 'result') return { kind: 'final', text: event.result ?? '' };
  if (event?.type === 'assistant' && Array.isArray(event.message?.content)) {
    const text = event.message.content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
    return text ? { kind: 'stream', text } : null;
  }
  return null;
}

export function runAgentText({
  provider = process.env.GIGPILOT_AGENT_PROVIDER || 'claude',
  prompt,
  timeoutMs = 300_000,
  spawnImpl = spawn,
} = {}) {
  const spec = buildAgentSpawn(provider, prompt, { readOnly: true, ephemeral: true });
  return new Promise((resolve, reject) => {
    const proc = spawnImpl(spec.bin, spec.args, spec.options);
    let settled = false;
    let stdoutBuffer = '';
    let stderr = '';
    const streamed = [];
    let finalText = '';
    const structuredErrors = [];

    const handleJsonLine = (value) => {
      const line = String(value || '').trim();
      if (!line) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      const structuredError = event?.type === 'error'
        ? event.message
        : event?.type === 'turn.failed'
          ? event.error?.message
          : null;
      if (structuredError && !structuredErrors.includes(structuredError)) structuredErrors.push(structuredError);
      const extracted = eventText(spec.provider, event);
      if (!extracted?.text) return;
      if (extracted.kind === 'final') finalText = extracted.text;
      else streamed.push(extracted.text);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const timer = setTimeout(() => {
      proc.kill?.('SIGTERM');
      finishReject(new Error(`${spec.provider} agent task timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdin?.on?.('error', () => {});
    proc.stdin?.end?.(spec.stdin ?? undefined);
    proc.stdout?.on('data', (chunk) => {
      stdoutBuffer += String(chunk);
      let newline;
      while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        handleJsonLine(line);
      }
    });
    proc.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    proc.on('error', (error) => finishReject(error));
    proc.on('close', (code, signal) => {
      if (settled) return;
      handleJsonLine(stdoutBuffer);
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const context = [...structuredErrors, stderr.trim()].filter(Boolean).join('; ');
        reject(new Error(`${spec.provider} agent exited with ${code ?? signal ?? 'unknown'}${context ? `: ${context}` : ''}`));
        return;
      }
      const text = String(finalText || streamed.join('')).trim();
      if (!text) {
        reject(new Error(`${spec.provider} agent returned no assistant text${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
        return;
      }
      resolve({
        text,
        runtimeFingerprint: `${spec.provider}:${process.env.GIGPILOT_AGENT_RUNTIME_FINGERPRINT || 'default'}`,
      });
    });
  });
}
