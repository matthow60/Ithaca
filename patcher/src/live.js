// Live view of what the engine is doing, for the dashboard's "Live Journey" window.
//
// Every incident gets its own live channel. The pipeline reports what it's doing (phase changes,
// log lines, replay steps, the file it's fixing, browser frames) and dashboards subscribed to that
// incident get it instantly over Server-Sent Events at GET /live?incident=<incidentId>.
// Nothing here changes what the engine does; it only reports it.
//
// A channel only exists for incidents THIS engine claimed. If several engines share the database,
// each one streams only its own runs; the dashboard uses `claimedBy` on the incident to tell the
// difference (see ENGINE below).
//
// DEMO_PACING=1 slows the run down so people can follow it:
//   - each status is shown for at least PHASE_MIN_MS (longer than the dashboard's 3 s poll,
//     so the progress bar at the top keeps pace with the live window)
//   - a pause before each replayed browser action, with a visible cursor moving to the target
//   - a short hold on "Crash Detected" before the engine claims the incident
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const PACING = /^(1|true|yes|on)$/i.test(String(process.env.DEMO_PACING || ''));
export const PACE = {
  enabled: PACING,
  phaseMinMs: PACING ? 3500 : 0,
  actionMs: PACING ? 750 : 0,
  detectMs: PACING ? 3500 : 0,
};

/** Who this engine is. Stored on incidents it claims (claimedBy) so dashboards can tell engines apart. */
export const ENGINE = { engineId: randomUUID(), host: os.hostname() };

const MAX_LOG_LINES = 40;
const MAX_RUNS_KEPT = 10; // finished runs stay viewable until this many newer ones exist

const runs = new Map(); // incidentId -> run state
const clients = new Map(); // SSE response -> incidentId it watches
let activeId = null; // the incident this engine is working on right now (one at a time)
let phaseStartedAt = 0;

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const watchers = (incidentId) => {
  let n = 0;
  for (const id of clients.values()) if (id === incidentId) n++;
  return n;
};

/** True when a dashboard is watching the incident being worked on (used to skip the screencast otherwise). */
export const hasViewers = () => Boolean(activeId) && watchers(activeId) > 0;

/** Whether replays should draw the cursor and pause between actions. */
export const showCursor = () => PACE.enabled || hasViewers();

/** Pause for `ms` only when pacing is on. */
export const pace = (ms) => (PACE.enabled ? sleep(ms) : Promise.resolve());

function send(incidentId, type, data) {
  const chunk = `event: ${type}\ndata: ${JSON.stringify({ incidentId, ...data })}\n\n`;
  for (const [res, id] of clients) if (id === incidentId) res.write(chunk);
}

const runFor = (incidentId) => (incidentId ? runs.get(incidentId) : undefined);

/** Called right after THIS engine successfully claims an incident. */
export function startRun(incidentId, status = 'reproducing') {
  const run = { incidentId, status, startedAt: Date.now(), logs: [], step: null, focus: null, frame: null, result: null };
  runs.delete(incidentId); // re-runs start fresh and move to the newest slot
  runs.set(incidentId, run);
  while (runs.size > MAX_RUNS_KEPT) runs.delete(runs.keys().next().value);
  activeId = incidentId;
  phaseStartedAt = Date.now();
  send(incidentId, 'run', { status, startedAt: run.startedAt });
}

/** Called when the engine finishes with an incident (any outcome). No-op if it never claimed it. */
export function endRun(incidentId, result = {}) {
  const run = runFor(incidentId);
  if (activeId === incidentId) activeId = null;
  if (!run) return;
  run.result = { fixed: Boolean(result.fixed), prUrl: result.prUrl ?? null };
  run.frame = null; // keep memory small; the final card doesn't need it
  send(incidentId, 'done', run.result);
}

/** Called before a status write: with pacing on, wait until the current status has been visible long enough. */
export async function holdPhase(incidentId, nextStatus) {
  const run = runFor(incidentId);
  if (!PACE.enabled || !run || nextStatus === run.status) return;
  await sleep(PACE.phaseMinMs - (Date.now() - phaseStartedAt));
}

/** Called after a status write. */
export function status(incidentId, next) {
  const run = runFor(incidentId);
  if (!run || next === run.status) return;
  run.status = next;
  phaseStartedAt = Date.now();
  send(incidentId, 'status', { status: next });
}

export function log(incidentId, level, text) {
  const run = runFor(incidentId);
  if (!run) return; // e.g. "already claimed — skipping" for an incident another engine took
  const line = { t: Date.now(), level, text };
  run.logs = [...run.logs.slice(-(MAX_LOG_LINES - 1)), line];
  send(incidentId, 'log', line);
}

/** One replayed user step (of the active incident): phase "start" (cursor on target) or "end". */
export function step(data) {
  const run = runFor(activeId);
  if (!run) return;
  run.step = data;
  send(activeId, 'step', data);
}

/** The file and line the engine is looking at, with a few lines of context. */
export function focus(data) {
  const run = runFor(activeId);
  if (!run) return;
  run.focus = data;
  send(activeId, 'focus', data);
}

/** Focus on a file: sends ±context lines around `line` (1-based) so the window can show the code. */
export function focusFile(file, line, content, context = 6) {
  const all = String(content ?? '').split(/\r?\n/);
  const at = Number(line) > 0 ? Number(line) : 1;
  const from = Math.max(1, at - context);
  const to = Math.min(all.length, at + context);
  focus({ file, line: Number(line) || null, from, lines: all.slice(from - 1, to) });
}

/** A JPEG frame (base64) from the replay browser of the active incident. */
export function frame(label, data) {
  const run = runFor(activeId);
  if (!run) return;
  run.frame = { label, data };
  send(activeId, 'frame', { label, data });
}

/** Express handler for GET /live?incident=<incidentId> (Server-Sent Events). */
export function liveHandler(req, res) {
  const incidentId = String(req.query.incident || '');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // The dashboard runs on another port of the same machine.
    'Access-Control-Allow-Origin': '*',
  });
  const snapshot = { incidentId, engine: ENGINE, pacing: PACE.enabled, run: runFor(incidentId) ?? null };
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  clients.set(res, incidentId);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}
