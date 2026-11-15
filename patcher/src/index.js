import './env.js'; // shared repo-root .env
import express from 'express';
import { connectDb, dbName, incidents, resetIncident } from './db.js';
import { runIncident } from './pipeline.js';
import * as live from './live.js';

const PORT = Number(process.env.PORT || 4000);
const LLM_MODE = () => (process.env.LLM_MODE || 'mock').toLowerCase();

// ─── One-at-a-time in-memory queue ───────────────────────────────────────────
const queue = [];
const pending = new Set(); // queued or running
let current = null;

function enqueue(incidentId) {
  if (pending.has(incidentId)) return false;
  pending.add(incidentId);
  queue.push(incidentId);
  void drain();
  return true;
}

async function drain() {
  if (current) return;
  while (queue.length) {
    current = queue.shift();
    live.startRun(current);
    let result = {};
    try {
      await live.pace(live.PACE.detectMs); // demo pacing: let "Crash Detected" show before claiming
      result = (await runIncident(current)) ?? {};
    } catch (err) {
      // runIncident records its own failures; this only catches e.g. Mongo being down during claim.
      console.error(`[${current}] unhandled pipeline error:`, err);
    } finally {
      live.endRun(current, result);
      pending.delete(current);
      current = null;
    }
  }
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, llmMode: LLM_MODE(), running: current, queued: queue.length, pacing: live.PACE.enabled });
});

// Live event stream for the dashboard's "Live Journey" window (Server-Sent Events).
app.get('/live', live.liveHandler);

app.post('/incidents/:id/fix', (req, res) => {
  const accepted = enqueue(req.params.id);
  res.status(202).json({ incidentId: req.params.id, accepted, note: accepted ? 'queued' : 'already queued or running' });
});

app.post('/demo/run/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    if (pending.has(id)) return res.status(409).json({ error: `${id} is already queued or running` });
    const found = await resetIncident(id);
    if (!found) return res.status(404).json({ error: `No incident ${id}` });
    enqueue(id);
    res.status(202).json({ incidentId: id, reset: true, accepted: true });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// ─── Change stream: new open incidents trigger a run ────────────────────────
function watchIncidents() {
  const stream = incidents().watch([
    { $match: { operationType: 'insert', 'fullDocument.status': 'open' } },
  ]);
  stream.on('change', (change) => {
    const id = change.fullDocument?.incidentId;
    if (id) {
      console.log(`[${id}] new open incident from change stream`);
      enqueue(id);
    }
  });
  stream.on('error', (err) => {
    stream.close().catch(() => {});
    if (err.code === 40573 || /replica set/i.test(err.message)) {
      console.warn('⚠ Change streams need a replica set (Atlas or `mongod --replSet`). ' +
        'Auto-trigger disabled — use POST /incidents/:id/fix instead.');
      return;
    }
    console.error('change stream error, retrying in 5s:', err.message);
    setTimeout(watchIncidents, 5000);
  });
  console.log('watching incidents collection for new open incidents');
}

// ─── Boot ────────────────────────────────────────────────────────────────────
await connectDb();
console.log(`connected to Mongo db "${dbName()}"`);
app.listen(PORT, () =>
  console.log(`patcher listening on :${PORT} (LLM_MODE=${LLM_MODE()}${live.PACE.enabled ? ', DEMO_PACING on' : ''})`),
);
watchIncidents();
