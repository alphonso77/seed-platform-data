import type { RunStage, SimulationRunSummary } from '../lib/types';

const STAGE_LABEL: Record<RunStage, string> = {
  generated: 'Generated',
  uploaded: 'Uploaded',
  'oi-uploaded': 'OI uploaded',
  reported: 'Reported',
};

const STAGE_COLOR: Record<RunStage, string> = {
  generated: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  uploaded: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  'oi-uploaded': 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  reported: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
};

interface Props {
  runs: SimulationRunSummary[];
  selectedRunId: string | null;
  onSelect: (runId: string | null) => void;
}

export function RunsList({ runs, selectedRunId, onSelect }: Props) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-400">
        No previous runs. Configure a new run to get started.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-700">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Previous runs
        </span>
        {selectedRunId && (
          <button
            onClick={() => onSelect(null)}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Clear selection
          </button>
        )}
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {runs.map((run) => {
          const isSelected = run.runId === selectedRunId;
          return (
            <li key={run.runId}>
              <button
                onClick={() => onSelect(run.runId)}
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition ${
                  isSelected
                    ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400'
                    : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs">{run.runId}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {run.options.size}
                    {run.options.fragment && ' · fragment'}
                    {run.options.duplicate && ' · duplicate'}
                    {run.options.fuzzy && ' · fuzzy'}
                  </span>
                </div>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STAGE_COLOR[run.stage]}`}>
                  {STAGE_LABEL[run.stage]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
