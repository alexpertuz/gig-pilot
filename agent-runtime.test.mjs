import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  buildAgentSpawn,
  NON_INTERACTIVE_DIRECTIVE,
  normalizeProvider,
  runAgentText,
} from './agent-runtime.mjs';

function fakeProcess(lines = [], { code = 0, closeDelay = 0, trailingNewline = true } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.killCalls = [];
  proc.kill = (signal) => {
    proc.killCalls.push(signal);
    queueMicrotask(() => proc.emit('close', null, signal));
    return true;
  };
  queueMicrotask(() => {
    lines.forEach((line, index) => {
      const suffix = trailingNewline || index < lines.length - 1 ? '\n' : '';
      proc.stdout.write(`${JSON.stringify(line)}${suffix}`);
    });
    proc.stdout.end();
    setTimeout(() => proc.emit('close', code, null), closeDelay);
  });
  return proc;
}

test('Codex structured tasks are ephemeral and read-only without pinning a model', () => {
  const prompt = 'classify these candidates';
  const spec = buildAgentSpawn('codex', prompt, { readOnly: true });

  assert.match(spec.bin, /codex$/);
  assert.ok(spec.args.includes('--json'));
  assert.ok(spec.args.includes('--ephemeral'));
  assert.ok(spec.args.includes('--sandbox'));
  assert.ok(spec.args.includes('read-only'));
  assert.equal(spec.args.includes('--model'), false);
  assert.equal(spec.args.includes(prompt), false);
  assert.equal(spec.args.at(-1), '-');
  assert.equal(spec.stdin, prompt);
});

test('Claude structured tasks disable tools without pinning a model', () => {
  const spec = buildAgentSpawn('claude', 'classify these candidates', { readOnly: true });

  assert.match(spec.bin, /claude(\.exe)?$/);
  const toolsIndex = spec.args.indexOf('--tools');
  assert.ok(toolsIndex >= 0);
  assert.equal(spec.args[toolsIndex + 1], '');
  assert.equal(spec.args.includes('--model'), false);
});

test('Claude receives the prompt via stdin, never argv', () => {
  // Triage prompts embed whole gig postings; on Windows argv is capped at
  // ~32K chars and overflowing it fails with spawn ENAMETOOLONG.
  const prompt = 'classify these candidates';
  const spec = buildAgentSpawn('claude', prompt);

  assert.equal(spec.args.includes(prompt), false);
  assert.equal(spec.stdin, prompt);
  assert.equal(spec.options.stdio[0], 'pipe');
});

test('Claude passes appendSystemPrompt via --append-system-prompt', () => {
  const spec = buildAgentSpawn('claude', '/gig-pilot gig https://x/y', {
    appendSystemPrompt: NON_INTERACTIVE_DIRECTIVE,
  });
  const i = spec.args.indexOf('--append-system-prompt');
  assert.ok(i >= 0);
  assert.equal(spec.args[i + 1], NON_INTERACTIVE_DIRECTIVE);
});

test('Codex prepends appendSystemPrompt to the stdin prompt', () => {
  const spec = buildAgentSpawn('codex', 'do the thing', {
    appendSystemPrompt: NON_INTERACTIVE_DIRECTIVE,
  });
  assert.equal(spec.args.includes('--append-system-prompt'), false);
  assert.ok(spec.stdin.startsWith(NON_INTERACTIVE_DIRECTIVE));
  assert.ok(spec.stdin.endsWith('do the thing'));
});

test('runAgentText collects the final Codex agent message', async () => {
  const proc = fakeProcess([
    { type: 'thread.started', thread_id: 'abc' },
    { type: 'item.completed', item: { id: '1', type: 'agent_message', text: '[{"url":"https://x.test"}]' } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 8 } },
  ]);

  const result = await runAgentText({
    provider: 'codex',
    prompt: 'classify',
    spawnImpl: () => proc,
  });

  assert.equal(result.text, '[{"url":"https://x.test"}]');
  assert.match(result.runtimeFingerprint, /^codex:/);
});

test('runAgentText parses a valid final event without a trailing newline', async () => {
  const proc = fakeProcess([
    { type: 'item.completed', item: { type: 'agent_message', text: '[{"ok":true}]' } },
  ], { trailingNewline: false });

  const result = await runAgentText({ provider: 'codex', prompt: 'classify', spawnImpl: () => proc });

  assert.equal(result.text, '[{"ok":true}]');
});

test('runAgentText prefers the Claude result event over streamed assistant text', async () => {
  const proc = fakeProcess([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } },
    { type: 'result', result: '[{"url":"https://x.test"}]' },
  ]);

  const result = await runAgentText({ provider: 'claude', prompt: 'classify', spawnImpl: () => proc });
  assert.equal(result.text, '[{"url":"https://x.test"}]');
});

test('runAgentText kills a hung process and rejects on timeout', async () => {
  const proc = fakeProcess([], { closeDelay: 1000 });

  await assert.rejects(
    runAgentText({ provider: 'codex', prompt: 'classify', timeoutMs: 5, spawnImpl: () => proc }),
    /timed out/i,
  );
  assert.deepEqual(proc.killCalls, ['SIGTERM']);
});

test('runAgentText rejects non-zero exits with stderr context', async () => {
  const proc = fakeProcess([], { code: 2 });
  proc.stderr.write('authentication required');

  await assert.rejects(
    runAgentText({ provider: 'codex', prompt: 'classify', spawnImpl: () => proc }),
    /authentication required/i,
  );
});

test('runAgentText surfaces structured Codex errors on non-zero exit', async () => {
  const proc = fakeProcess([
    { type: 'thread.started', thread_id: 'abc' },
    { type: 'error', message: 'usage limit reached; try again later' },
    { type: 'turn.failed', error: { message: 'usage limit reached; try again later' } },
  ], { code: 1 });

  await assert.rejects(
    runAgentText({ provider: 'codex', prompt: 'classify', spawnImpl: () => proc }),
    /usage limit reached/i,
  );
});

test('normalizeProvider validates explicit providers', () => {
  assert.equal(normalizeProvider('CODEX'), 'codex');
  assert.equal(normalizeProvider('claude'), 'claude');
  assert.throws(() => normalizeProvider('unknown'), /unknown agent provider/i);
});
