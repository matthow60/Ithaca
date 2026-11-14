import { StatusBadge } from './StatusPipeline';

export function timeAgo(iso) {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function IncidentList({ incidents, selectedId, onSelect }) {
  return (
    <ul className="incident-list">
      {incidents.map((inc) => (
        <li key={inc._id}>
          <button
            className={`incident-item ${inc._id === selectedId ? 'selected' : ''}`}
            onClick={() => onSelect(inc._id)}
          >
            <div className="incident-item-top">
              <span className="incident-id">#{inc.incidentId.replace('incident-', '')}</span>
              <StatusBadge status={inc.status} />
            </div>
            <div className="incident-route">{inc.route}</div>
            <div className="incident-time">{timeAgo(inc.timestamp)}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}
