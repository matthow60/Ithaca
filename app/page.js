'use client';

import { useEffect, useState } from 'react';
import { fetchIncidents } from '../lib/api';
import IncidentList from '../components/IncidentList';
import StatusPipeline from '../components/StatusPipeline';
import ActionTimeline from '../components/ActionTimeline';
import DiffViewer from '../components/DiffViewer';
import GeminiSummary from '../components/GeminiSummary';

const POLL_MS = 3000;

export default function Dashboard() {
  const [incidents, setIncidents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  // Poll for incidents. TODO(backend): see lib/api.js for the MongoDB route.
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
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" />
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
          <div className="empty">Waiting for incidents…</div>
        ) : (
          <>
            <header className="incident-header">
              <div>
                <div className="muted mono">#{selected._id}</div>
                <h1>{selected.route}</h1>
                <div className="error-msg mono">{selected.errorMessage}</div>
              </div>
              {selected.prUrl ? (
                <a className="pr-button" href={selected.prUrl} target="_blank" rel="noreferrer">
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
                  User Journey <span className="muted">last {selected.actions.length} actions</span>
                </h2>
                <ActionTimeline
                  actions={selected.actions}
                  crashTime={selected.timestamp}
                  errorMessage={selected.errorMessage}
                />
              </section>

              <div className="stack">
                <section className="card">
                  <h2>Stack Trace</h2>
                  <pre className="trace">{selected.stackTrace}</pre>
                </section>
                <section className="card">
                  <h2>
                    Grok Patch <span className="muted">code diff</span>
                  </h2>
                  <DiffViewer diff={selected.codeDiff} />
                </section>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
