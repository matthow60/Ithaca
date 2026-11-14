import { PointerIcon, QuillIcon, SailIcon, StormIcon } from './Icons';

const TYPE_LABEL = { click: 'CLICK', input: 'INPUT', navigate: 'NAV' };
const TYPE_ICON = { click: PointerIcon, input: QuillIcon, navigate: SailIcon };

// Vertical timeline of the user's last actions, ending in the crash.
export default function ActionTimeline({ actions, crashTime, errorMessage }) {
  const crashMs = new Date(crashTime).getTime();

  return (
    <ol className="timeline">
      {actions.map((a, i) => {
        const diff = (new Date(a.timestamp).getTime() - crashMs) / 1000;
        const offset = Number.isFinite(diff) ? `${diff.toFixed(1)}s` : '';
        const TypeIcon = TYPE_ICON[a.type];
        return (
          <li key={i} className="timeline-item">
            <span className="timeline-num">{i + 1}</span>
            <span className={`type-pill type-${a.type}`}>
              {TypeIcon && <TypeIcon size={12} />}
              {TYPE_LABEL[a.type] ?? a.type}
            </span>
            <span className="timeline-target">
              {a.target}
              {a.value !== undefined && <code className="timeline-value">"{a.value}"</code>}
            </span>
            <span className="timeline-offset">{offset}</span>
          </li>
        );
      })}
      <li className="timeline-item crash">
        <span className="timeline-num">!</span>
        <span className="type-pill type-crash">
          <StormIcon size={12} />
          500
        </span>
        <span className="timeline-target">{errorMessage}</span>
        <span className="timeline-offset">0.0s</span>
      </li>
    </ol>
  );
}
