// Runs reproduce()/prove() end to end against a tiny fixture app in a real headless browser,
// plus unit tests for how prove() decides which 5xx responses count.
//
// Regression guards:
// - "Cannot access 'http' before initialization": prove() crashed while reporting a
//   still-failing browser replay, hiding the real reason and wasting the attempt.
// - The split-checkout incident failed verification 3 times because an unrelated, existing
//   bug (POST /api/cart/add) also returned 500 during the replay. Only the target crash and
//   NEW errors may fail verification.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prove, reproduce, findTarget, classifyServerErrors } from '../src/verify.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'app');
const page = 'http://localhost:9999/';
const click = (name) => ({ type: 'click', target: `[data-testid="${name}"]`, url: page });
const err = (step, url, method = 'POST') => ({ step, status: 500, method, url });

let evidenceDir;
before(async () => { evidenceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'patcher-verify-')); });
after(() => fs.rm(evidenceDir, { recursive: true, force: true }));

const run = (fn, failing, input) => {
  process.env.TARGET_START_CMD = `node server.js ${failing}`;
  return fn({ dir, evidenceDir, ...input });
};

describe('one bug on the user path', () => {
  const actions = [{ type: 'navigate', url: page }, click('boom')];
  const request = { method: 'POST', path: '/api/boom', headers: {} };

  test('reproduce: confirms the crash on the original code', async () => {
    const result = await run(reproduce, 'boom', { actions, request });
    assert.equal(result.reproduced, true);
    assert.equal(result.by, 'browser');
  });

  test('prove: browser replay still hitting the 5xx is reported, not thrown', async () => {
    const result = await run(prove, 'boom', { actions, request });
    assert.equal(result.passed, false);
    assert.doesNotMatch(result.error, /before initialization|Replay failed/);
    assert.match(result.error, /still there: 500 on POST \/api\/boom \(step 2/);
    assert.equal(result.browser.crashed, true);
  });

  test('prove: raw request still returning 5xx is reported', async () => {
    const result = await run(prove, 'boom', { actions: [], request });
    assert.equal(result.passed, false);
    assert.match(result.error, /still there: 500 on POST \/api\/boom \(request replay\)/);
    assert.equal(result.http.status, 500);
  });

  test('prove: passes once the bug is fixed', async () => {
    const result = await run(prove, 'none', { actions, request });
    assert.equal(result.error, undefined);
    assert.equal(result.passed, true);
    assert.equal(result.http.status, 200);
    assert.equal(result.browser.crashed, false);
  });
});

// Mirrors the split-checkout incident: add-to-cart (other) is broken too, and the incident's
// route is stored without the /api prefix.
describe('a separate, existing bug on the user path', () => {
  const actions = [{ type: 'navigate', url: page }, click('other'), click('extra'), click('boom')];
  const route = 'POST /boom';
  let reproduction;

  before(async () => {
    reproduction = await run(reproduce, 'other,boom', { actions, request: null });
  });

  test('reproduce sees both 500s', () => {
    assert.equal(reproduction.reproduced, true);
    assert.deepEqual(reproduction.browser.serverErrors.map((e) => `${e.step} ${e.url}`), ['2 /api/other', '4 /api/boom']);
  });

  test('prove: passes when the target is fixed, and reports the existing bug', async () => {
    const result = await run(prove, 'other', { actions, request: null, reproduction, route });
    assert.equal(result.error, undefined);
    assert.equal(result.passed, true);
    assert.equal(result.target.label, 'POST /boom');
    assert.equal(result.target.from, 'route');
    assert.deepEqual(result.knownErrors.map((e) => e.url), ['/api/other']);
  });

  test('prove: fails when the target is still broken, and tells the LLM to ignore the other bug', async () => {
    const result = await run(prove, 'other,boom', { actions, request: null, reproduction, route });
    assert.equal(result.passed, false);
    assert.match(result.error, /still there: 500 on POST \/api\/boom \(step 4/);
    assert.match(result.error, /Ignore these.*500 on POST \/api\/other/);
  });

  test('prove: fails when the patch introduces a new 500 elsewhere', async () => {
    const result = await run(prove, 'other,extra', { actions, request: null, reproduction, route });
    assert.equal(result.passed, false);
    assert.match(result.error, /introduced a new error: 500 on POST \/api\/extra \(step 3/);
    assert.doesNotMatch(result.error, /still there/);
  });
});

describe('findTarget', () => {
  const reproduction = { by: 'browser', browser: { serverErrors: [err(2, '/api/cart/add'), err(5, '/api/checkout/split')] } };

  test('prefers the recorded request when the reproduction saw it', () => {
    const t = findTarget({ request: { method: 'post', path: '/api/checkout/split?x=1' }, route: 'POST /cart/add', reproduction });
    assert.deepEqual([t.label, t.from], ['POST /api/checkout/split', 'request']);
  });

  test('matches a route stored without the mount prefix', () => {
    const t = findTarget({ request: null, route: 'POST /checkout/split', reproduction });
    assert.deepEqual([t.label, t.from], ['POST /checkout/split', 'route']);
  });

  test('falls back to the last 5xx when request and route do not match what was seen', () => {
    const t = findTarget({ request: null, route: 'GET /nowhere', reproduction });
    assert.deepEqual([t.label, t.from], ['POST /api/checkout/split', 'reproduction']);
  });

  test('route suffix only matches whole path segments', () => {
    const t = findTarget({ request: null, route: 'POST /split', reproduction: { browser: { serverErrors: [err(1, '/api/checkout/split')] } } });
    assert.equal(t.from, 'route');
    const { targetErrors, newErrors } = classifyServerErrors({ after: [err(1, '/api/checkout/xsplit')], before: [], target: t });
    assert.equal(targetErrors.length, 0);
    assert.equal(newErrors.length, 1);
  });
});

describe('classifyServerErrors', () => {
  const target = { method: 'POST', path: '/api/checkout/split', from: 'request' };
  const beforeErrors = [err(2, '/api/cart/add'), err(5, '/api/checkout/split')];

  test('sorts target, known and new errors', () => {
    const r = classifyServerErrors({
      after: [err(2, '/api/cart/add'), err(4, '/api/orders'), err(5, '/api/checkout/split')],
      before: beforeErrors,
      target,
    });
    assert.deepEqual(r.targetErrors.map((e) => e.url), ['/api/checkout/split']);
    assert.deepEqual(r.knownErrors.map((e) => e.url), ['/api/cart/add']);
    assert.deepEqual(r.newErrors.map((e) => e.url), ['/api/orders']);
  });

  test('a different method on the same path is not the target', () => {
    const r = classifyServerErrors({ after: [err(5, '/api/checkout/split', 'GET')], before: beforeErrors, target });
    assert.equal(r.targetErrors.length, 0);
    assert.equal(r.newErrors.length, 1);
  });

  test('with nothing to compare against, every 5xx fails', () => {
    const r = classifyServerErrors({ after: [err(2, '/api/cart/add')], before: [], target: null });
    assert.equal(r.targetErrors.length, 1);
  });
});
