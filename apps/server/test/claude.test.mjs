import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { buildPrompt, startJob, subscribe, getJob, setSpawner, _reset } from '../lib/claude.mjs';

test('buildPrompt routes modes through the gig-pilot skill', () => {
  assert.equal(buildPrompt('gig', { url: 'https://x/y' }), '/gig-pilot gig https://x/y');
  assert.equal(buildPrompt('proposal', { report: '007' }), '/gig-pilot proposal 007');
});

test('buildPrompt maps Codex to mode-file instructions', () => {
  const prompt = buildPrompt('gig', { url: 'https://x/y' }, 'codex');
  assert.match(prompt, /modes\/gig\.md/);
  assert.match(prompt, /https:\/\/x\/y/);
  assert.doesNotMatch(prompt, /^\/gig/);
});

test('startJob streams assistant text then done', async () => {
  _reset();
  // fake process that emits two stream-json lines then closes 0
  setSpawner(() => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    setImmediate(() => {
      proc.stdout.emit('data', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } }) + '\n');
      proc.emit('close', 0);
    });
    return proc;
  });
  const { jobId } = startJob('gig', { url: 'https://x/y' });
  const events = [];
  await new Promise((resolve) => {
    subscribe(jobId, (e) => {
      events.push(e);
      if (e.type === 'done') resolve();
    });
  });
  assert.ok(events.some((e) => e.type === 'text' && e.data.includes('Hi')));
  assert.equal(getJob(jobId).status, 'done');
});

test('startJob writes the Codex prompt to child stdin and closes it', async () => {
  _reset();
  let stdinValue = null;
  setSpawner((prompt) => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { end: (value) => { stdinValue = value; } };
    proc.kill = () => {};
    setImmediate(() => {
      proc.emit('close', 0);
    });
    return { process: proc, stdin: prompt };
  });
  const { jobId } = startJob('gig', { url: 'https://x/y' }, 'codex');
  await new Promise((resolve) => {
    subscribe(jobId, (e) => {
      if (e.type === 'done') resolve();
    });
  });
  assert.match(stdinValue, /modes\/gig\.md/);
  assert.match(stdinValue, /https:\/\/x\/y/);
  assert.equal(getJob(jobId).status, 'done');
});

test('startJob streams Codex agent messages then done', async () => {
  _reset();
  setSpawner(() => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    setImmediate(() => {
      proc.stdout.emit('data', JSON.stringify({
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'Codex says hi' },
      }) + '\n');
      proc.emit('close', 0);
    });
    return proc;
  });
  const { jobId } = startJob('gig', { url: 'https://x/y' }, 'codex');
  const events = [];
  await new Promise((resolve) => {
    subscribe(jobId, (e) => {
      events.push(e);
      if (e.type === 'done') resolve();
    });
  });
  assert.ok(events.some((e) => e.type === 'text' && e.data.includes('Codex says hi')));
  assert.equal(getJob(jobId).provider, 'codex');
  assert.equal(getJob(jobId).status, 'done');
});

test('startJob streams current Codex item.completed agent messages', async () => {
  _reset();
  setSpawner(() => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { end() {} };
    proc.kill = () => {};
    setImmediate(() => {
      proc.stdout.emit('data', JSON.stringify({
        type: 'item.completed',
        item: { id: 'item-1', type: 'agent_message', text: 'Current Codex says hi' },
      }) + '\n');
      proc.emit('close', 0);
    });
    return proc;
  });
  const { jobId } = startJob('gig', { url: 'https://x/y' }, 'codex');
  const events = [];
  await new Promise((resolve) => {
    subscribe(jobId, (event) => {
      events.push(event);
      if (event.type === 'done') resolve();
    });
  });
  assert.ok(events.some((event) => event.type === 'text' && event.data === 'Current Codex says hi'));
});
