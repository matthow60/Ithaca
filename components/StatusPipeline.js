'use client';

import { useEffect, useRef, useState } from 'react';
import { CompassIcon, OwlIcon, ShipIcon, StormIcon, WaveIcon } from './Icons';

// Maps the MongoDB `status` field (written by patcher/) to the demo stages.
// A stage can cover several statuses; failed / not_reproducible end the pipeline early.
export const STAGES = [
  { key: 'open', statuses: ['open'], label: 'Crash Detected' },
  { key: 'reproducing', statuses: ['reproducing'], label: 'Reproducing Steps' },
  { key: 'patching', statuses: ['patching', 'verifying'], label: 'AI Patching' },
  { key: 'fixed', statuses: ['fixed'], label: 'PR Ready' },
];

const FAILURES = {
  failed: 'Fix Failed',
  not_reproducible: 'Not Reproducible',
};

// Odyssey icon for each stage (shown inside the port markers and badges).
const ICONS = {
  open: StormIcon,
  reproducing: CompassIcon,
  patching: OwlIcon,
  fixed: ShipIcon,
  failed: WaveIcon,
};

const stageIndex = (status) => STAGES.findIndex((s) => s.statuses.includes(status));

export function StatusBadge({ status }) {
  if (FAILURES[status]) {
    return (
      <span className="badge badge-failed">
        <WaveIcon size={12} />
        {FAILURES[status]}
      </span>
    );
  }
  const stage = STAGES[stageIndex(status)] ?? STAGES[0];
  const StageIcon = ICONS[stage.key];
  return (
    <span className={`badge badge-${stage.key}`}>
      <StageIcon size={12} />
      {stage.label}
    </span>
  );
}

// The pipeline as a voyage: a ship sails along the sea line to the current stage, leaving a
// teal wake. When the status changes it glides on to the next port (CSS transition on --at).
export default function StatusPipeline({ status, incidentKey }) {
  const failure = FAILURES[status];
  const stops = failure
    ? [...STAGES, { key: 'failed', label: failure }]
    : STAGES;
  // A failed run stopped somewhere after detection; the ship ends up at the failure port.
  const current = failure ? stops.length - 1 : Math.max(0, stageIndex(status));
  const finished = status === 'fixed';

  // Each newly selected incident starts at the first port (instantly), then sails to where it
  // is now. Later status changes on the same incident just glide on from the current port.
  const [at, setAt] = useState(0);
  const [instant, setInstant] = useState(true);
  const lastKey = useRef(null);
  useEffect(() => {
    if (lastKey.current === incidentKey) {
      setAt(current);
      return;
    }
    lastKey.current = incidentKey;
    setInstant(true);
    setAt(0);
    // Let the browser paint the ship at the first port before it sets sail.
    let sailed = false;
    const timer = setTimeout(() => {
      sailed = true;
      setInstant(false);
      setAt(current);
    }, 80);
    return () => {
      clearTimeout(timer);
      // Cancelled before setting sail (e.g. React dev re-running effects): start over next time.
      if (!sailed) lastKey.current = null;
    };
  }, [incidentKey, current]);

  const shipState = failure ? 'wrecked' : finished ? 'docked' : 'sailing';

  return (
    <div
      className={`voyage ${instant ? 'is-instant' : ''}`}
      style={{ '--stops': stops.length, '--at': at, '--last': stops.length - 1 }}
      role="group"
      aria-label={`Status: ${failure || STAGES[current].label}`}
    >
      <div className="voyage-sea" aria-hidden="true">
        <div className="voyage-water" />
        <div className={`voyage-wake ${failure ? 'is-failed' : ''}`} />
        <div className={`voyage-ship ${shipState}`}>
          <ShipIcon size={30} />
        </div>
      </div>
      <ol className="pipeline">
        {stops.map((stage, i) => {
          let state = 'pending';
          if (stage.key === 'failed') state = 'active';
          else if (failure) state = i === 0 ? 'done' : 'pending'; // only detection is known to be done
          else if (i < current || (finished && i === current)) state = 'done';
          else if (i === current) state = 'active';
          const StageIcon = ICONS[stage.key];
          return (
            <li key={stage.key} className={`pipeline-step ${state} step-${stage.key}`}>
              <span className="pipeline-dot">
                <StageIcon size={18} />
              </span>
              <span className="pipeline-label">{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
