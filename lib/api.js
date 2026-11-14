// Client-side data access for the dashboard. The browser only talks to our own
// Next.js API routes; MongoDB and Gemini credentials stay on the server.
//
//   GET  /api/incidents  → app/api/incidents/route.js  (MongoDB)
//   POST /api/summarize  → app/api/summarize/route.js  (MongoDB + Gemini)
//
// See BACKEND.md for the full contract.

async function readJson(res, fallbackMessage) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || fallbackMessage);
  return body;
}

// → Incident[] (already normalized by lib/incident.js on the server), newest first.
export async function fetchIncidents() {
  const res = await fetch('/api/incidents', { cache: 'no-store' });
  return readJson(res, 'Failed to load incidents');
}

// → { whatBroke, whyTriggered, howFixed }
export async function fetchSummary(incident) {
  const res = await fetch('/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ incidentId: incident._id }),
  });
  return readJson(res, 'Failed to generate summary');
}
