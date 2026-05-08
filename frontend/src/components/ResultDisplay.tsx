import type { SeedResult, CleanResult } from '../lib/types';

interface SeedResultProps {
  type: 'seed';
  result: SeedResult;
}

interface CleanResultProps {
  type: 'clean';
  result: CleanResult;
}

type ResultDisplayProps = SeedResultProps | CleanResultProps;

export function ResultDisplay(props: ResultDisplayProps) {
  const hasErrors = props.type === 'seed'
    ? props.result.errors.length > 0
    : props.result.errors.length > 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-100/50 p-6 dark:border-gray-700 dark:bg-gray-800/50">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">
          {props.type === 'seed' ? 'Seed' : 'Clean'} Result — {props.result.platform}
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {(props.result.duration / 1000).toFixed(1)}s
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {props.type === 'seed'
          ? Object.entries(props.result.created).map(([key, count]) => (
              <div key={key} className="rounded-lg bg-white p-3 dark:bg-gray-900/50">
                <div className="text-2xl font-bold text-teal-600 dark:text-teal-400">{count}</div>
                <div className="text-xs capitalize text-gray-500 dark:text-gray-400">{key}</div>
              </div>
            ))
          : Object.entries(props.result.deleted).map(([key, count]) => (
              <div key={key} className="rounded-lg bg-white p-3 dark:bg-gray-900/50">
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">{count}</div>
                <div className="text-xs capitalize text-gray-500 dark:text-gray-400">{key} deleted</div>
              </div>
            ))}
      </div>

      {hasErrors && (
        <div className="mt-4">
          <h4 className="mb-2 text-sm font-medium text-red-600 dark:text-red-400">Errors</h4>
          <ul className="space-y-1 text-xs text-red-600 dark:text-red-300">
            {(props.type === 'seed' ? props.result.errors : props.result.errors).map((err, i) => (
              <li key={i} className="rounded bg-red-500/10 px-2 py-1">{err}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
