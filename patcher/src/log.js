// Small logging helpers shared by the pipeline steps.
import * as live from './live.js';

export function makeLogger(incidentId) {
  const prefix = `[${incidentId}]`;
  // Every log line also goes to the dashboard's live window.
  const log = (...args) => {
    console.log(prefix, ...args);
    live.log(incidentId, 'info', args.join(' '));
  };
  log.error = (...args) => {
    console.error(prefix, ...args);
    live.log(incidentId, 'error', args.join(' '));
  };

  /** Run fn as a named step, logging start, duration, and failure. */
  log.step = async (name, fn) => {
    const started = Date.now();
    log(`▶ ${name}`);
    try {
      const result = await fn();
      log(`✔ ${name} (${Date.now() - started}ms)`);
      return result;
    } catch (err) {
      log.error(`✖ ${name} failed after ${Date.now() - started}ms: ${redact(err?.message ?? err)}`);
      throw err;
    }
  };
  return log;
}

/** Strip secrets (the GitHub token embedded in clone URLs, API keys) from text. */
export function redact(text) {
  let out = String(text ?? '');
  for (const key of ['GH_TOKEN', 'LLM_API_KEY', 'LLM_FALLBACK_API_KEY']) {
    const value = process.env[key];
    if (value) out = out.split(value).join('***');
  }
  return out.replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@');
}
