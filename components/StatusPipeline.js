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

const stageIndex = (status) => STAGES.findIndex((s) => s.statuses.includes(status));

export function StatusBadge({ status }) {
  if (FAILURES[status]) return <span className="badge badge-failed">{FAILURES[status]}</span>;
  const stage = STAGES[stageIndex(status)] ?? STAGES[0];
  return <span className={`badge badge-${stage.key}`}>{stage.label}</span>;
}

export default function StatusPipeline({ status }) {
  const failure = FAILURES[status];
  // A failed run stopped somewhere after detection; show detection as done, the rest pending.
  const current = failure ? 1 : Math.max(0, stageIndex(status));
  return (
    <ol className="pipeline">
      {STAGES.map((stage, i) => {
        const state = i < current ? 'done' : i === current && !failure ? 'active' : 'pending';
        return (
          <li key={stage.key} className={`pipeline-step ${state} step-${stage.key}`}>
            <span className="pipeline-dot" />
            {stage.label}
          </li>
        );
      })}
      {failure && (
        <li className="pipeline-step active step-failed">
          <span className="pipeline-dot" />
          {failure}
        </li>
      )}
    </ol>
  );
}
