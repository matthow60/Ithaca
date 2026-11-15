// Runs prove() / reproduce() end to end against a tiny fixture app in a real headless browser.
// Regression guard for "Cannot access 'http' before initialization": prove() crashed while
// reporting a still-failing browser replay, hiding the real reason and wasting the attempt.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prove, reproduce } from '../src/verify.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'app');
const actions = [
  { type: 'navigate', url: 'http://localhost:9999/' },
  { type: 'click', target: '[data-testid="boom"]', url: 'http://localhost:9999/' },
];
const request = { method: 'POST', path: '/api/boom', headers: {} };

let evidenceDir;
before(async () => { evidenceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'patcher-verify-')); });
after(() => fs.rm(evidenceDir, { recursive: true, force: true }));

const run = (fn, mode, input) => {
  process.env.TARGET_START_CMD = `node server.js ${mode}`;
  return fn({ dir, evidenceDir, ...input });
};

test('prove: browser replay still hitting a 5xx is reported, not thrown', async () => {
  const result = await run(prove, 'broken', { actions, request });
  assert.equal(result.passed, false);
  assert.doesNotMatch(result.error, /before initialization|Replay failed/);
  assert.match(result.error, /still hit 500 on POST \/api\/boom at step 2/);
  assert.equal(result.http, null);
  assert.equal(result.browser.crashed, true);
});

test('prove: raw request still returning 5xx is reported', async () => {
  const result = await run(prove, 'broken', { actions: [], request });
  assert.equal(result.passed, false);
  assert.match(result.error, /still returned 500/);
  assert.equal(result.http.status, 500);
});

test('prove: passes once the bug is fixed', async () => {
  const result = await run(prove, 'fixed', { actions, request });
  assert.equal(result.error, undefined);
  assert.equal(result.passed, true);
  assert.equal(result.http.status, 200);
  assert.equal(result.browser.crashed, false);
});

test('reproduce: confirms the crash on the original code', async () => {
  const result = await run(reproduce, 'broken', { actions, request });
  assert.equal(result.reproduced, true);
  assert.equal(result.by, 'browser');
});
