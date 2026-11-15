'use client';

import { useEffect, useState } from 'react';
import { fetchIncidents } from '../lib/api';
import IncidentList from '../components/IncidentList';
import StatusPipeline from '../components/StatusPipeline';
import ActionTimeline from '../components/ActionTimeline';
import DiffViewer from '../components/DiffViewer';
import LiveJourney from '../components/LiveJourney';
import GeminiSummary from '../components/GeminiSummary';
import ShaderCanvas from '../components/ShaderCanvas';
import { ColumnIcon, LabyrinthIcon, OwlIcon, SailIcon, ShipIcon } from '../components/Icons';

const POLL_MS = 3000;

export default function Dashboard() {
  const [incidents, setIncidents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  // Poll /api/incidents (MongoDB). See lib/api.js and BACKEND.md.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await fetchIncidents();
        if (cancelled) return;
        setIncidents(data);
        setLastUpdated(new Date());
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const selected = incidents.find((i) => i._id === selectedId) ?? incidents[0];
  const openCount = incidents.filter((i) => i.status !== 'fixed').length;

  return (
    <div className="app">
      <ShaderCanvas variant="sea" className="page-shader" />
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <ColumnIcon size={22} />
          </span>
          Incident Command
        </div>
        <div className="live">
          <span className="live-dot" /> Live
          <span className="muted">
            {lastUpdated ? ` · updated ${lastUpdated.toLocaleTimeString()}` : ' · connecting…'}
          </span>
        </div>
        <div className="sidebar-heading">
          Incidents <span className="count">{openCount} active</span>
        </div>
        {error && <div className="error">{error}</div>}
        <IncidentList
          incidents={incidents}
          selectedId={selected?._id}
          onSelect={setSelectedId}
        />
      </aside>

      <main className="main">
        {!selected ? (
          <div className="empty">
            {error
              ? 'Could not load incidents. Check the server logs and MONGODB_URI.'
              : lastUpdated
                ? 'No incidents yet. Trigger a crash in the target app.'
                : 'Connecting to MongoDB…'}
          </div>
        ) : (
          <>
            <header className="incident-header">
              <div>
                <div className="muted mono">#{selected.incidentId}</div>
                <h1>{selected.route}</h1>
                <div className="error-msg mono">{selected.errorMessage}</div>
              </div>
              {selected.prUrl ? (
                <a className="pr-button" href={selected.prUrl} target="_blank" rel="noreferrer">
                  <ShipIcon />
                  View GitHub PR →
                </a>
              ) : (
                <span className="pr-button disabled">PR pending</span>
              )}
            </header>

            <StatusPipeline status={selected.status} />

            <GeminiSummary incident={selected} />

            <div className="detail-grid">
              <section className="card">
                <h2>
                  <SailIcon />
                  User Journey <span className="muted">last {selected.actions.length} actions</span>
                </h2>
                <ActionTimeline
                  actions={selected.actions}
                  crashTime={selected.timestamp}
                  errorMessage={selected.errorMessage}
                />
              </section>

              {/* Live view of the engine at work (patcher GET /live). */}
              <LiveJourney incident={selected} />
            </div>

            <div className="detail-grid">
              <section className="card">
                <h2>
                  <LabyrinthIcon />
                  Stack Trace
                </h2>
                <pre className="trace">{selected.stackTrace}</pre>
              </section>
              <section className="card">
                <h2>
                  <OwlIcon />
                  Gemini Patch <span className="muted">code diff</span>
                </h2>
                <DiffViewer diff={selected.codeDiff} />
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
