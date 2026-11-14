// Maps the MongoDB `status` field to the three demo stages.
export const STAGES = [
  { status: 'open', label: 'Crash Detected' },
  { status: 'patching', label: 'Grok Patching' },
  { status: 'fixed', label: 'PR Ready' },
];

export function StatusBadge({ status }) {
  const stage = STAGES.find((s) => s.status === status) ?? STAGES[0];
  return <span className={`badge badge-${stage.status}`}>{stage.label}</span>;
}

export default function StatusPipeline({ status }) {
  const current = Math.max(0, STAGES.findIndex((s) => s.status === status));
  return (
    <ol className="pipeline">
      {STAGES.map((stage, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'pending';
        return (
          <li key={stage.status} className={`pipeline-step ${state} step-${stage.status}`}>
            <span className="pipeline-dot" />
            {stage.label}
          </li>
        );
      })}
    </ol>
  );
}
