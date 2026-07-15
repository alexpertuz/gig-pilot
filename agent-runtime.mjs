import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REPO_ROOT = process.env.GIGOPS_ROOT
  ? path.resolve(process.env.GIGOPS_ROOT)
  : path.dirname(fileURLToPath(import.meta.url));

export const claudeBin = process.env.GIGOPS_CLAUDE_BIN || 'claude';
export const codexBin = process.env.GIGOPS_CODEX_BIN || 'codex';

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

export function normalizeProvider(provider = process.env.GIGOPS_AGENT_PROVIDER || 'claude') {
  const id = String(provider || '').trim().toLowerCase();
  if (!AGENT_PROVIDERS[id]) throw new Error(`unknown agent provider: ${provider}`);
  return id;
}

export function buildAgentSpawn(provider, prompt, { readOnly = false, ephemeral = readOnly } = {}) {
  const id = normalizeProvider(provider);
  const config = AGENT_PROVIDERS[id];
  let args;
  if (id === 'codex') {
    args = ['exec', '--json'];
    if (ephemeral) args.push('--ephemeral');
    if (readOnly) args.push('--sandbox', 'read-only');
    args.push('--cd', REPO_ROOT, '-');
  } else {
    args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (ephemeral) args.push('--no-session-persistence');
    if (readOnly) args.push('--tools', '');
  }
  return {
    provider: id,
    bin: config.bin,
    args,
    stdin: id === 'codex' ? prompt : null,
    options: { cwd: REPO_ROOT, stdio: [id === 'codex' ? 'pipe' : 'ignore', 'pipe', 'pipe'] },
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
  provider = process.env.GIGOPS_AGENT_PROVIDER || 'claude',
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
        runtimeFingerprint: `${spec.provider}:${process.env.GIGOPS_AGENT_RUNTIME_FINGERPRINT || 'default'}`,
      });
    });
  });
}
