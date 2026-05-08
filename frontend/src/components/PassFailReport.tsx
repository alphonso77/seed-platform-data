import { useMemo, useState } from 'react';
import type { MergeStatus, SimulationReport } from '../lib/types';

const STATUS_LABEL: Record<MergeStatus, string> = {
  fully_merged: 'Fully merged',
  under_merged: 'Under-merged',
  over_merged: 'Over-merged',
  missing: 'Missing',
};

const STATUS_COLOR: Record<MergeStatus, string> = {
  fully_merged: 'text-teal-600 dark:text-teal-400',
  under_merged: 'text-yellow-600 dark:text-yellow-400',
  over_merged: 'text-orange-600 dark:text-orange-400',
  missing: 'text-red-600 dark:text-red-400',
};

interface Props {
  report: SimulationReport;
}

type Filter = 'all' | MergeStatus | 'fail';

export function PassFailReport({ report }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const { summary, records } = report;

  const filtered = useMemo(() => {
    if (filter === 'all') return records;
    if (filter === 'fail') return records.filter((r) => !r.pass);
    return records.filter((r) => r.mergeStatus === filter);
  }, [records, filter]);

  const passRate = summary.recordsTotal === 0
    ? 0
    : (summary.recordsPassed / summary.recordsTotal) * 100;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pass rate" value={`${passRate.toFixed(1)}%`} accent="text-teal-600 dark:text-teal-400" />
        <Stat label="Records passed" value={`${summary.recordsPassed} / ${summary.recordsTotal}`} />
        <Stat label="Precision" value={summary.precision.toFixed(3)} />
        <Stat label="Recall" value={summary.recall.toFixed(3)} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Fully merged" value={summary.fullyMerged} accent={STATUS_COLOR.fully_merged} />
        <Stat label="Under-merged" value={summary.underMerged} accent={STATUS_COLOR.under_merged} />
        <Stat label="Over-merged" value={summary.overMerged} accent={STATUS_COLOR.over_merged} />
        <Stat label="Missing" value={summary.missing} accent={STATUS_COLOR.missing} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(['all', 'fail', 'fully_merged', 'under_merged', 'over_merged', 'missing'] as Filter[]).map(
          (f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 transition ${
                filter === f
                  ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
              }`}
            >
              {f === 'all'
                ? `All (${records.length})`
                : f === 'fail'
                  ? `Failing (${summary.recordsFailed})`
                  : STATUS_LABEL[f]}
            </button>
          ),
        )}
      </div>

      {/* Records table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2">Platform</th>
              <th className="px-3 py-2">External ID</th>
              <th className="px-3 py-2">Canonical</th>
              <th className="px-3 py-2">DNA record</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.map((r) => (
              <tr key={r.internalId} className="text-gray-700 dark:text-gray-300">
                <td className="px-3 py-2 capitalize">{r.platform}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.externalId}</td>
                <td className="px-3 py-2 font-mono text-xs opacity-70">
                  {r.canonicalId.slice(0, 8)}…
                </td>
                <td className="px-3 py-2 font-mono text-xs opacity-70">
                  {r.dnaRecordId ? `${r.dnaRecordId.slice(0, 8)}…` : '—'}
                </td>
                <td className={`px-3 py-2 font-medium ${STATUS_COLOR[r.mergeStatus]}`}>
                  {STATUS_LABEL[r.mergeStatus]}
                </td>
                <td className="px-3 py-2">
                  {r.pass ? (
                    <span className="rounded bg-teal-500/15 px-2 py-0.5 text-xs font-medium text-teal-600 dark:text-teal-400">
                      pass
                    </span>
                  ) : (
                    <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                      fail
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-400">
                  No records match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/50">
      <div className={`text-2xl font-bold ${accent ?? 'text-gray-900 dark:text-white'}`}>{value}</div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}
