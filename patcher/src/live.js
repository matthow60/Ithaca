// Live view of what the engine is doing, for the dashboard's "Live Journey" window.
//
// The pipeline reports what it's doing (phase changes, log lines, replay steps, the file it's
// looking at, browser frames) and every connected dashboard gets it instantly over
// Server-Sent Events at GET /live. Nothing here changes what the engine does; it only reports it.
//
// DEMO_PACING=1 slows the run down so people can follow it:
//   - each status is shown for at least PHASE_MIN_MS (longer than the dashboard's 3 s poll,
//     so the progress bar at the top keeps pace with the live window)
//   - a pause before each replayed browser action, with a visible cursor moving to the target
//   - a short hold on "Crash Detected" before the engine claims the incident

const PACING = /^(1|true|yes|on)$/i.test(String(process.env.DEMO_PACING || ''));
export const PACE = {
  enabled: PACING,
  phaseMinMs: PACING ? 3500 : 0,
  actionMs: PACING ? 750 : 0,
  detectMs: PACING ? 3500 : 0,
};

const MAX_LOG_LINES = 40;
const clients = new Set();

// Snapshot of the current (or last) run, sent to dashboards that connect mid-run.
let state = emptyState();
function emptyState() {
  return { incidentId: null, status: null, startedAt: null, logs: [], step: null, focus: null, frame: null, result: null };
}
let phaseStartedAt = 0;

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** True when a dashboard is watching (used to skip the screencast when nobody is). */
export const hasViewers = () => clients.size > 0;

/** Whether replays should draw the cursor and pause between actions. */
export const showCursor = () => PACE.enabled || hasViewers();

/** Pause for `ms` only when pacing is on. */
export const pace = (ms) => (PACE.enabled ? sleep(ms) : Promise.resolve());

function send(type, data) {
  if (!clients.size) return;
  const chunk = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(chunk);
}

export function startRun(incidentId) {
  state = { ...emptyState(), incidentId, status: 'open', startedAt: Date.now() };
  phaseStartedAt = Date.now();
  send('run', { incidentId, status: 'open', startedAt: state.startedAt });
}

export function endRun(incidentId, result = {}) {
  state.result = { fixed: Boolean(result.fixed), prUrl: result.prUrl ?? null, skipped: Boolean(result.skipped) };
  send('done', { incidentId, ...state.result });
}

/** Called before a status write: with pacing on, wait until the current status has been visible long enough. */
export async function holdPhase(nextStatus) {
  if (!PACE.enabled || nextStatus === state.status) return;
  await sleep(PACE.phaseMinMs - (Date.now() - phaseStartedAt));
}

/** Called after a status write. */
export function status(incidentId, next) {
  if (next === state.status) return;
  state.status = next;
  phaseStartedAt = Date.now();
  send('status', { incidentId, status: next });
}

export function log(incidentId, level, text) {
  const line = { t: Date.now(), level, text };
  state.logs = [...state.logs.slice(-(MAX_LOG_LINES - 1)), line];
  send('log', { incidentId, ...line });
}

/** One replayed user step: phase "start" (cursor on target) or "end" (with result). */
export function step(data) {
  state.step = data;
  send('step', { incidentId: state.incidentId, ...data });
}

/** The file and line the engine is looking at, with a few lines of context. */
export function focus(data) {
  state.focus = data;
  send('focus', { incidentId: state.incidentId, ...data });
}

/** Focus on a file: sends ±CONTEXT lines around `line` (1-based) so the window can show the code. */
export function focusFile(file, line, content, context = 6) {
  const all = String(content ?? '').split(/\r?\n/);
  const at = Number(line) > 0 ? Number(line) : 1;
  const from = Math.max(1, at - context);
  const to = Math.min(all.length, at + context);
  focus({ file, line: Number(line) || null, from, lines: all.slice(from - 1, to) });
}

/** A JPEG frame (base64) from the replay browser. */
export function frame(label, data) {
  state.frame = { label, data };
  send('frame', { incidentId: state.incidentId, label, data });
}

/** Express handler for GET /live (Server-Sent Events). */
export function liveHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // The dashboard runs on another port of the same machine.
    'Access-Control-Allow-Origin': '*',
  });
  res.write(`event: snapshot\ndata: ${JSON.stringify({ ...state, pacing: PACE.enabled })}\n\n`);
  clients.add(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}
