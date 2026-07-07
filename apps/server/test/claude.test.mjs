import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { buildPrompt, startJob, subscribe, getJob, setSpawner, _reset } from '../lib/claude.mjs';

test('buildPrompt maps modes to slash commands', () => {
  assert.equal(buildPrompt('gig', { url: 'https://x/y' }), '/gig https://x/y');
  assert.equal(buildPrompt('proposal', { report: '007' }), '/proposal 007');
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
