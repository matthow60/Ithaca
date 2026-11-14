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

// Odyssey icon for each stage (shown inside the shield markers and badges).
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

export default function StatusPipeline({ status }) {
  const failure = FAILURES[status];
  // A failed run stopped somewhere after detection; show detection as done, the rest pending.
  const current = failure ? 1 : Math.max(0, stageIndex(status));
  return (
    <ol className="pipeline">
      {STAGES.map((stage, i) => {
        const state = i < current ? 'done' : i === current && !failure ? 'active' : 'pending';
        const StageIcon = ICONS[stage.key];
        return (
          <li key={stage.key} className={`pipeline-step ${state} step-${stage.key}`}>
            <span className="pipeline-dot">
              <StageIcon size={20} />
            </span>
            <span className="pipeline-label">{stage.label}</span>
          </li>
        );
      })}
      {failure && (
        <li className="pipeline-step active step-failed">
          <span className="pipeline-dot">
            <WaveIcon size={20} />
          </span>
          <span className="pipeline-label">{failure}</span>
        </li>
      )}
    </ol>
  );
}
