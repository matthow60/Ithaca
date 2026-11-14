'use client';

import { useEffect, useState } from 'react';
import { fetchSummary } from '../lib/api';
import { ScrollIcon } from './Icons';
import Pillar from './Pillar';
import ShaderCanvas from './ShaderCanvas';

const SECTIONS = [
  ['whatBroke', 'What broke'],
  ['whyTriggered', "Why the user's steps triggered it"],
  ['howFixed', 'How the PR fixes it'],
];

export default function GeminiSummary({ incident }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const ready = incident.status === 'fixed';

  // Re-run when the incident changes or flips to "fixed" (the patch diff is needed).
  useEffect(() => {
    if (!ready) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSummary(incident)
      .then((s) => !cancelled && setSummary(s))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [incident._id, ready]); // intentionally not re-fetching on every poll

  return (
    <section className="card gemini">
      <ShaderCanvas variant="oracle" className="card-shader" />
      <h2>
        <ScrollIcon />
        Gemini Incident Summary <span className="muted">plain English</span>
      </h2>
      {!ready && <div className="empty">Summary is generated once Gemini's PR is ready.</div>}
      {ready && loading && <div className="empty shimmer">Asking Gemini…</div>}
      {ready && !loading && error && <div className="error">{error}</div>}
      {ready && !loading && !error && !summary && <div className="empty">No summary available.</div>}
      {ready && !loading && summary && (
        <div className="summary-grid">
          {SECTIONS.map(([key, title]) => (
            <Pillar key={key} title={title}>
              {summary[key]}
            </Pillar>
          ))}
        </div>
      )}
    </section>
  );
}
