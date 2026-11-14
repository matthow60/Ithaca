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
 * Prove the patched code no longer crashes: the user's steps in a browser, then the raw request.
 * @returns {{ passed: boolean, error?: string, http, browser, browserError }}
 *   error is human-readable and is fed back to the next patch attempt.
 */
export async function prove({ dir, actions, request, evidenceDir }) {
  let app;
  try {
    app = await startApp(dir);
  } catch (err) {
    return { passed: false, error: err.message };
  }
  try {
    // Browser replay first, on a fresh app, so the screenshots show exactly what the user did
    // (a request replay first would leave state behind, e.g. extra items in a cart).
    let browser = null;
    let browserError = null;
    if (actions?.length) {
      try {
        browser = await replayActions({ baseUrl: app.baseUrl, actions, outDir: evidenceDir, label: 'after' });
      } catch (err) {
        browserError = `Browser replay failed: ${err.message}`;
      }
      if (browser?.crashed) {
        const e = browser.serverErrors[0];
        return {
          passed: false,
          http,
          browser,
          error: `Replaying the user's steps still hit ${e.status} on ${e.method} ${e.url} at step ${e.step}.\n` +
            `--- app output ---\n${redact(app.output())}`,
        };
      }
    }

    let http = null;
    if (request?.path) {
      http = await replayRequest(app.baseUrl, request);
      if (http.status >= 500) {
        await sleep(200); // let the app flush its error log
        return {
          passed: false,
          http,
          browser,
          error: `Replayed ${request.method || 'GET'} ${request.path} still returned ${http.status}.\n` +
            `--- response body ---\n${http.body}\n--- app output ---\n${redact(app.output())}`,
        };
      }
    }
    return { passed: true, http, browser, browserError };
  } catch (err) {
    return { passed: false, error: `Replay failed: ${err.message}\n--- app output ---\n${redact(app.output())}` };
  } finally {
    await app.stop();
  }
}

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
