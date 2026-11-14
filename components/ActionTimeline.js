const TYPE_LABEL = { click: 'CLICK', input: 'INPUT', navigate: 'NAV' };

// Vertical timeline of the user's last actions, ending in the crash.
export default function ActionTimeline({ actions, crashTime, errorMessage }) {
  const crashMs = new Date(crashTime).getTime();

  return (
    <ol className="timeline">
      {actions.map((a, i) => {
        const offset = ((new Date(a.timestamp).getTime() - crashMs) / 1000).toFixed(1);
        return (
          <li key={i} className="timeline-item">
            <span className="timeline-num">{i + 1}</span>
            <span className={`type-pill type-${a.type}`}>{TYPE_LABEL[a.type] ?? a.type}</span>
            <span className="timeline-target">
              {a.target}
              {a.value !== undefined && <code className="timeline-value">"{a.value}"</code>}
            </span>
            <span className="timeline-offset">{offset}s</span>
          </li>
        );
      })}
      <li className="timeline-item crash">
        <span className="timeline-num">!</span>
        <span className="type-pill type-crash">500</span>
        <span className="timeline-target">{errorMessage}</span>
        <span className="timeline-offset">0.0s</span>
      </li>
    </ol>
  );
}
