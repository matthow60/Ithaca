// Data access for the dashboard. Two sources, switchable from the sidebar:
//   'mock' → simulated incidents from lib/mockIncidents.js (no backend needed)
//   'live' → real incidents from MongoDB via app/api/incidents, summaries via app/api/summarize
//
// The default comes from NEXT_PUBLIC_DATA_SOURCE in .env ('mock' or 'live').

import { MOCK_INCIDENTS } from './mockIncidents';

export const DEFAULT_SOURCE = process.env.NEXT_PUBLIC_DATA_SOURCE === 'live' ? 'live' : 'mock';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJson(res, fallbackMessage) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || fallbackMessage);
  return body;
}

export async function fetchIncidents(source) {
  if (source === 'live') {
    const res = await fetch('/api/incidents', { cache: 'no-store' });
    return readJson(res, 'Failed to load incidents');
  }
  return MOCK_INCIDENTS.map(simulateProgress);
}

export async function fetchSummary(incident, source) {
  if (source === 'live') {
    const res = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incidentId: incident._id }),
    });
    return readJson(res, 'Failed to generate summary');
  }
  await sleep(700); // fake network latency so the loading state is visible
  return incident.mockSummary ?? null;
}

// ---- Mock-only below ----

// Makes the "simulate" incident move through the pipeline so you can rehearse the demo.
let simStartedAt = Date.now();

export function restartSimulation() {
  simStartedAt = Date.now();
}

function simulateProgress(incident) {
  if (!incident.simulate) return incident;
  const secs = (Date.now() - simStartedAt) / 1000;
  if (secs < 8) return { ...incident, status: 'open', prUrl: null, codeDiff: null };
  if (secs < 18) return { ...incident, status: 'patching', prUrl: null, codeDiff: null };
  return { ...incident, status: 'fixed' };
}
