// Data access for the dashboard. Everything here is MOCKED so the UI runs
// with no backend. Each function marks what the real version needs.

import { MOCK_INCIDENTS } from './mockIncidents';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startedAt = Date.now();

export async function fetchIncidents() {
  // TODO(backend): replace the mock with a real call, e.g.
  //   const res = await fetch('/api/incidents', { cache: 'no-store' });
  //   if (!res.ok) throw new Error('Failed to load incidents');
  //   return res.json();
  //
  // TODO(backend): create app/api/incidents/route.js (server-only) that:
  //   - connects to MongoDB Atlas with process.env.MONGODB_URI (npm install mongodb)
  //   - returns db.collection('incidents').find().sort({ timestamp: -1 }).limit(50)
  //   - converts ObjectId _id values to strings before returning JSON
  //   Never put the Mongo connection string in client code.
  //
  // TODO(backend, optional): swap polling for push updates
  //   (MongoDB Change Streams → WebSocket / Server-Sent Events).
  return MOCK_INCIDENTS.map(simulateProgress);
}

// Mock-only: makes the "simulate" incident move through the pipeline
// so you can rehearse the demo. Delete once real data flows in.
function simulateProgress(incident) {
  if (!incident.simulate) return incident;
  const secs = (Date.now() - startedAt) / 1000;
  if (secs < 8) return { ...incident, status: 'open', prUrl: null, codeDiff: null };
  if (secs < 18) return { ...incident, status: 'patching', prUrl: null, codeDiff: null };
  return { ...incident, status: 'fixed' };
}

export async function fetchSummary(incident) {
  // TODO(backend): replace the mock with a real call, e.g.
  //   const res = await fetch('/api/summarize', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ incidentId: incident._id }),
  //   });
  //   return res.json(); // { whatBroke, whyTriggered, howFixed }
  //
  // TODO(backend): create app/api/summarize/route.js (server-only) that:
  //   - loads the incident from MongoDB by id
  //   - builds the prompt with buildIncidentPrompt() from lib/geminiPrompt.js
  //   - calls Gemini with process.env.GEMINI_API_KEY (npm install @google/genai)
  //   - parses the JSON reply and returns { whatBroke, whyTriggered, howFixed }
  //   - optionally caches the result on the incident doc so Gemini runs once per incident
  //   Never call Gemini from the browser: the API key would be exposed.
  await sleep(700); // fake network latency so the loading state is visible
  return incident.mockSummary ?? null;
}
