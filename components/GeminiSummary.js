'use client';

import { useEffect, useState } from 'react';
import { fetchSummary } from '../lib/api';

const SECTIONS = [
  ['whatBroke', 'What broke'],
  ['whyTriggered', "Why the user's steps triggered it"],
  ['howFixed', 'How the PR fixes it'],
];

export default function GeminiSummary({ incident }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const ready = incident.status === 'fixed';

  // Re-run when the incident changes or flips to "fixed" (Grok's diff is needed).
  useEffect(() => {
    if (!ready) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchSummary(incident)
      .then((s) => !cancelled && setSummary(s))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [incident._id, ready]); // intentionally not re-fetching on every poll

  return (
    <section className="card gemini">
      <h2>
        Gemini Incident Summary <span className="muted">plain English</span>
      </h2>
      {!ready && <div className="empty">Summary is generated once Grok's PR is ready.</div>}
      {ready && loading && <div className="empty shimmer">Asking Gemini…</div>}
      {ready && !loading && !summary && <div className="empty">No summary available.</div>}
      {ready && !loading && summary && (
        <div className="summary-grid">
          {SECTIONS.map(([key, title]) => (
            <div key={key} className="summary-block">
              <h3>{title}</h3>
              <p>{summary[key]}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
