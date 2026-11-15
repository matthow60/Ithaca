// Boot the target app on a free port, then:
//   reproduce() — on the ORIGINAL code, replay the user's steps in a browser and confirm the 5xx
//   prove()     — on the PATCHED code, replay the request + the same steps and confirm no 5xx
// Screenshots of every step land in evidenceDir as before-NN.png / after-NN.png.
import { spawn, execFile } from 'node:child_process';
import getPort from 'get-port';
import { redact } from './log.js';
import { replayActions } from './replay.js';

const BOOT_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DROP_HEADERS = new Set([
  'host', 'content-length', 'connection', 'transfer-encoding', 'accept-encoding', 'keep-alive', 'upgrade',
]);
// Patcher secrets the target app has no business seeing.
const SECRET_ENV = ['GH_TOKEN', 'LLM_API_KEY', 'LLM_FALLBACK_API_KEY'];

/**
 * Replay against the original code to confirm the bug is real before patching.
 * Tries the user's steps in a browser first; falls back to replaying the raw request.
 * @returns {{ reproduced: boolean, by: 'browser'|'request'|null, browser, browserError, http, appOutput }}
 */
export async function reproduce({ dir, actions, request, evidenceDir }) {
  const app = await startApp(dir);
  try {
    let browser = null;
    let browserError = null;
    if (actions?.length) {
      try {
        browser = await replayActions({ baseUrl: app.baseUrl, actions, outDir: evidenceDir, label: 'before' });
        if (browser.crashed) return { reproduced: true, by: 'browser', browser, browserError, http: null };
      } catch (err) {
        browserError = `Browser replay failed: ${err.message}`;
      }
    }
    const http = request?.path ? await replayRequest(app.baseUrl, request) : null;
    if (http && http.status >= 500) return { reproduced: true, by: 'request', browser, browserError, http };
    return { reproduced: false, by: null, browser, browserError, http, appOutput: redact(app.output()) };
  } finally {
    await app.stop();
  }
}

/**
 * Prove the patched code fixed THE crash we were asked to fix, without breaking anything new.
 * Replays the user's steps in a browser, then the raw request, and sorts every 5xx it sees:
 *   target — the incident's own crash is still there       → fail
 *   new    — a 5xx the original code didn't produce        → fail (the patch broke something)
 *   known  — a 5xx the original code produced too, on a
 *            different endpoint (a separate, existing bug) → ignored, reported as knownErrors
 * Without `reproduction` there is nothing to compare against, so every 5xx fails.
 *
 * @param {object} [opts.reproduction] result of reproduce() on the original code
 * @param {string} [opts.route]        incident.route, e.g. "POST /checkout/split"
 * @returns {{ passed: boolean, error?: string, http, browser, browserError, target, knownErrors }}
 *   error is human-readable and is fed back to the next patch attempt.
 */
export async function prove({ dir, actions, request, evidenceDir, reproduction = null, route = null }) {
  const target = reproduction ? findTarget({ request, route, reproduction }) : null;
  const before = reproduction?.browser?.serverErrors ?? [];

  let app;
  try {
    app = await startApp(dir);
  } catch (err) {
    return { passed: false, error: err.message, target, knownErrors: [] };
  }
  try {
    // Browser replay first, on a fresh app, so the screenshots show exactly what the user did
    // (a request replay first would leave state behind, e.g. extra items in a cart).
    // Declare every result variable up front: an early `return` that mentions one declared
    // further down throws "Cannot access 'x' before initialization" and hides the real reason.
    let browser = null;
    let browserError = null;
    let http = null;
    if (actions?.length) {
      try {
        browser = await replayActions({ baseUrl: app.baseUrl, actions, outDir: evidenceDir, label: 'after' });
      } catch (err) {
        browserError = `Browser replay failed: ${err.message}`;
      }
    }
    const after = [...(browser?.serverErrors ?? [])];

    if (request?.path) {
      http = await replayRequest(app.baseUrl, request);
      if (http.status >= 500) {
        await sleep(200); // let the app flush its error log
        after.push({ step: 'request replay', status: http.status, method: (request.method || 'GET').toUpperCase(), url: request.path });
      }
    }

    const { targetErrors, newErrors, knownErrors } = classifyServerErrors({ after, before, target });
    if (!targetErrors.length && !newErrors.length) {
      return { passed: true, http, browser, browserError, target, knownErrors };
    }

    const lines = [];
    for (const e of targetErrors) {
      lines.push(`The crash being fixed is still there: ${e.status} on ${e.method} ${e.url} (${where(e)}).`);
    }
    for (const e of newErrors) {
      lines.push(`The patch introduced a new error: ${e.status} on ${e.method} ${e.url} (${where(e)}); the original code did not fail there.`);
    }
    if (knownErrors.length) {
      lines.push(`Ignore these; they also fail on the original code and are a separate bug: ` +
        `${unique(knownErrors).join(', ')}.`);
    }
    const body = http && http.status >= 500 ? `--- response body ---\n${http.body}\n` : '';
    return {
      passed: false,
      http,
      browser,
      browserError,
      target,
      knownErrors,
      error: `${lines.join('\n')}\n${body}--- app output ---\n${redact(app.output())}`,
    };
  } catch (err) {
    return { passed: false, target, knownErrors: [], error: `Replay failed: ${err.message}\n--- app output ---\n${redact(app.output())}` };
  } finally {
    await app.stop();
  }
}

/**
 * Which endpoint is the incident's crash? First match wins:
 *   1. the recorded request (method + path)
 *   2. incident.route; matched by method + path suffix, since routes are often stored without
 *      the mount prefix ("POST /checkout/split" vs "/api/checkout/split")
 *   3. the last 5xx in the reproduction: the error the user actually ran into
 * 1 and 2 only count if the reproduction actually saw that crash (or reproduced via the request).
 * @returns {{ method: string|null, path: string, from: 'request'|'route'|'reproduction', label: string } | null}
 */
export function findTarget({ request, route, reproduction }) {
  const seen = reproduction?.browser?.serverErrors ?? [];
  const candidates = [];
  if (request?.path) {
    candidates.push({ method: (request.method || 'GET').toUpperCase(), path: pathOnly(request.path), from: 'request' });
  }
  const m = String(route ?? '').trim().match(/^([A-Za-z]+)\s+(\/\S*)$/);
  if (m) candidates.push({ method: m[1].toUpperCase(), path: pathOnly(m[2]), from: 'route' });

  for (const c of candidates) {
    const confirmed = seen.some((e) => matchesTarget(e, c)) || (c.from === 'request' && reproduction?.by === 'request');
    if (confirmed) return { ...c, label: `${c.method} ${c.path}` };
  }
  const last = seen.at(-1);
  if (last) {
    const path = pathOnly(last.url);
    return { method: last.method.toUpperCase(), path, from: 'reproduction', label: `${last.method.toUpperCase()} ${path}` };
  }
  const fallback = candidates[0];
  return fallback ? { ...fallback, label: `${fallback.method} ${fallback.path}` } : null;
}

/** Does a 5xx ({ method, url }) belong to the target endpoint? */
export function matchesTarget(error, target) {
  if (!target) return false;
  if (target.method && error.method?.toUpperCase() !== target.method) return false;
  const path = pathOnly(error.url);
  if (path === target.path) return true;
  // Routes may lack the mount prefix: "/api/checkout/split" matches route "/checkout/split".
  // target.path starts with "/", so endsWith() only matches on a segment boundary.
  return target.from === 'route' && target.path !== '/' && path.endsWith(target.path);
}

/**
 * Sort the 5xx responses seen on the patched code against those seen on the original code.
 * With no target (nothing to compare against), every 5xx counts as target.
 */
export function classifyServerErrors({ after, before, target }) {
  const targetErrors = [];
  const newErrors = [];
  const knownErrors = [];
  const existing = new Set(before.map(key));
  for (const e of after) {
    if (!target || matchesTarget(e, target)) targetErrors.push(e);
    else if (existing.has(key(e))) knownErrors.push(e);
    else newErrors.push(e);
  }
  return { targetErrors, newErrors, knownErrors };
}

const pathOnly = (url) => {
  try {
    return new URL(url, 'http://x').pathname.replace(/\/+$/, '') || '/';
  } catch {
    return String(url);
  }
};
const key = (e) => `${String(e.method).toUpperCase()} ${pathOnly(e.url)}`;
const unique = (errors) => [...new Set(errors.map((e) => `${e.status} on ${key(e)}`))];
const where = (e) => (typeof e.step === 'number' ? `step ${e.step} of the user's steps` : e.step);

/** Start TARGET_START_CMD on a free port; resolves once it answers HTTP. */
export async function startApp(dir, startCmd = process.env.TARGET_START_CMD || 'node server/index.js') {
  const port = await getPort();
  const env = { ...process.env, PORT: String(port) };
  for (const key of SECRET_ENV) delete env[key];

  const child = spawn(startCmd, {
    cwd: dir,
    env,
    shell: true,
    detached: process.platform !== 'win32', // own process group so we can kill the whole tree
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const keep = (chunk) => { output = (output + chunk).slice(-4000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });
  child.on('error', (err) => { exited = { code: null, signal: null, error: err }; });

  const app = {
    baseUrl: `http://127.0.0.1:${port}`,
    output: () => output,
    stop: () => killTree(child),
  };

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) {
      await app.stop();
      throw new Error(
        `App exited before responding (code ${exited.code}, signal ${exited.signal}${exited.error ? `, ${exited.error.message}` : ''})` +
          `\n--- app output ---\n${redact(output)}`,
      );
    }
    try {
      // Any HTTP response (even a 404) means the server is listening.
      await fetch(`${app.baseUrl}/`, { signal: AbortSignal.timeout(1000), redirect: 'manual' });
      return app;
    } catch {
      await sleep(300);
    }
  }
  await app.stop();
  throw new Error(`App did not respond within ${BOOT_TIMEOUT_MS / 1000}s\n--- app output ---\n${redact(output)}`);
}

/** Send the stored crashing request. Returns { status, body } (body truncated). */
export async function replayRequest(baseUrl, request) {
  const method = (request.method || 'GET').toUpperCase();
  const headers = {};
  for (const [k, v] of Object.entries(request.headers || {})) {
    if (!DROP_HEADERS.has(k.toLowerCase()) && v !== undefined && v !== null) headers[k] = String(v);
  }

  let body;
  if (!['GET', 'HEAD'].includes(method) && request.body !== undefined && request.body !== null) {
    if (typeof request.body === 'string') {
      body = request.body;
    } else {
      body = JSON.stringify(request.body);
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
    }
  }

  const url = new URL(request.path, baseUrl); // path may include a query string
  const res = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: res.status, body: (await res.text().catch(() => '')).slice(0, 1500) };
}

async function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    if (process.platform === 'win32') {
      // shell: true means child.pid is cmd.exe; /T takes node with it.
      await new Promise((resolve) => execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => resolve()));
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
  await Promise.race([exited, sleep(3000)]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
