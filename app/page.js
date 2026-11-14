'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SOURCE, fetchIncidents, restartSimulation } from '../lib/api';
import IncidentList from '../components/IncidentList';
import StatusPipeline from '../components/StatusPipeline';
import ActionTimeline from '../components/ActionTimeline';
import DiffViewer from '../components/DiffViewer';
import GeminiSummary from '../components/GeminiSummary';

const POLL_MS = 3000;
const SOURCE_KEY = 'dashboard:dataSource';

export default function Dashboard() {
  const [incidents, setIncidents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(DEFAULT_SOURCE);

  // Restore the last-used data source (read after mount to avoid a hydration mismatch).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SOURCE_KEY);
      if (saved === 'mock' || saved === 'live') setSource(saved);
    } catch {}
  }, []);

  function changeSource(next) {
    if (next === source) return;
    try {
      localStorage.setItem(SOURCE_KEY, next);
    } catch {}
    if (next === 'mock') restartSimulation(); // replay the Crash → Patching → PR Ready demo
    setIncidents([]);
    setSelectedId(null);
    setLastUpdated(null);
    setError(null);
    setSource(next);
  }

  // Poll for incidents from the selected source (see lib/api.js).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await fetchIncidents(source);
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
  }, [source]);

  const selected = incidents.find((i) => i._id === selectedId) ?? incidents[0];
  const openCount = incidents.filter((i) => i.status !== 'fixed').length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" />
          Incident Command
        </div>
        <div className="source-toggle" role="group" aria-label="Data source">
          <button
            className={source === 'mock' ? 'active' : ''}
            aria-pressed={source === 'mock'}
            onClick={() => changeSource('mock')}
          >
            Simulated
          </button>
          <button
            className={source === 'live' ? 'active' : ''}
            aria-pressed={source === 'live'}
            onClick={() => changeSource('live')}
          >
            Live (MongoDB)
          </button>
        </div>
        <div className="live">
          <span className="live-dot" /> {source === 'live' ? 'Live' : 'Simulated'}
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
            {source === 'live'
              ? 'No incidents in MongoDB yet. Trigger a crash in the target app, or switch to Simulated.'
              : 'Waiting for incidents…'}
          </div>
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

            <GeminiSummary incident={selected} source={source} />

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
