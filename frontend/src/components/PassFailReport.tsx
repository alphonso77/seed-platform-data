import { useMemo, useState } from 'react';
import type { MergeStatus, RecordResolution, ResolutionOutcome, SimulationReport } from '../lib/types';

const STATUS_LABEL: Record<MergeStatus, string> = {
  fully_merged: 'Fully merged',
  under_merged: 'Under-merged',
  deferred_review: 'Deferred to review',
  over_merged: 'Over-merged',
  missing: 'Missing',
};

const STATUS_COLOR: Record<MergeStatus, string> = {
  fully_merged: 'text-teal-600 dark:text-teal-400',
  under_merged: 'text-yellow-600 dark:text-yellow-400',
  deferred_review: 'text-sky-600 dark:text-sky-400',
  over_merged: 'text-orange-600 dark:text-orange-400',
  missing: 'text-red-600 dark:text-red-400',
};

interface Props {
  report: SimulationReport;
}

type Filter = 'all' | MergeStatus | 'fail';

export function PassFailReport({ report }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const { summary, records, canonicals } = report;
  const queued = canonicals.filter((c) => c.reviewPairs && c.reviewPairs.length > 0);

  const filtered = useMemo(() => {
    if (filter === 'all') return records;
    if (filter === 'fail') return records.filter((r) => !r.pass && r.mergeStatus !== 'deferred_review');
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
        <Stat
          label={summary.recallWithDeferred != null ? `Recall (${summary.recallWithDeferred.toFixed(3)} with deferred)` : 'Recall'}
          value={summary.recall.toFixed(3)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Fully merged" value={summary.fullyMerged} accent={STATUS_COLOR.fully_merged} />
        <Stat label="Under-merged" value={summary.underMerged} accent={STATUS_COLOR.under_merged} />
        <Stat
          label={summary.reviewQueueChecked ? 'Deferred to review' : 'Deferred (queue not checked)'}
          value={summary.deferredReview ?? 0}
          accent={STATUS_COLOR.deferred_review}
        />
        <Stat label="Over-merged" value={summary.overMerged} accent={STATUS_COLOR.over_merged} />
        <Stat label="Missing" value={summary.missing} accent={STATUS_COLOR.missing} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(['all', 'fail', 'fully_merged', 'under_merged', 'deferred_review', 'over_merged', 'missing'] as Filter[]).map(
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
              <th className="px-3 py-2">Canonical email</th>
              <th className="px-3 py-2">DNA record</th>
              <th className="px-3 py-2">Resolved</th>
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
                <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">
                  {r.canonicalEmail || '—'}
                </td>
                <td className="px-3 py-2 font-mono text-xs opacity-70">
                  {r.dnaRecordId ? `${r.dnaRecordId.slice(0, 8)}…` : '—'}
                </td>
                <td className="px-3 py-2 text-xs">
                  <ResolutionCell resolution={r.resolution} resolvedAt={r.resolvedAt ?? null} />
                </td>
                <td className={`px-3 py-2 font-medium ${STATUS_COLOR[r.mergeStatus]}`}>
                  {STATUS_LABEL[r.mergeStatus]}
                </td>
                <td className="px-3 py-2">
                  {r.pass ? (
                    <span className="rounded bg-teal-500/15 px-2 py-0.5 text-xs font-medium text-teal-600 dark:text-teal-400">
                      pass
                    </span>
                  ) : r.mergeStatus === 'deferred_review' ? (
                    <span className="rounded bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400">
                      deferred
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
                <td colSpan={8} className="px-3 py-6 text-center text-xs text-gray-400">
                  No records match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Review-queue rows joining split canonicals */}
      {queued.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Review queue pairs</h3>
          {queued.map((c) => (
            <div key={c.canonicalId} className="rounded-lg border border-gray-200 p-3 text-xs dark:border-gray-700">
              <div className="mb-2 font-mono text-gray-500 dark:text-gray-400">
                {c.canonicalId.slice(0, 8)}… · <span className={STATUS_COLOR[c.mergeStatus]}>{STATUS_LABEL[c.mergeStatus]}</span>
              </div>
              {c.reviewPairs!.map((q) => (
                <div key={q.queueId} className="flex flex-wrap gap-x-4 gap-y-1 text-gray-700 dark:text-gray-300">
                  <span className="font-mono">{q.queueId.slice(0, 8)}…</span>
                  <span>
                    raw <span className="font-mono">{q.rawRecordId.slice(0, 8)}…</span> → DNA{' '}
                    <span className="font-mono">{q.candidateDnaRecordId ? `${q.candidateDnaRecordId.slice(0, 8)}…` : 'deleted'}</span>
                  </span>
                  <span>score {q.score.toFixed(3)}</span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {Object.entries(q.markerBreakdown).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ')}
                  </span>
                  <span className={q.status === 'rejected' ? 'text-red-600 dark:text-red-400' : 'text-sky-600 dark:text-sky-400'}>
                    {q.status}
                    {q.decidedAt ? ` ${q.decidedAt.slice(11, 19)}Z` : ''}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function describeOutcome(o: ResolutionOutcome): string {
  const detail = o.via ?? o.reason ?? (o.score != null ? o.score.toFixed(3) : null);
  return `T${o.tier ?? '?'} ${o.action ?? '?'}${detail ? ` (${detail})` : ''}`;
}

function ResolutionCell({ resolution, resolvedAt }: { resolution?: RecordResolution; resolvedAt: string | null }) {
  const time = resolvedAt ? resolvedAt.slice(11, 23) : null;
  if (!resolution) return <span className="font-mono text-gray-400">{time ?? '—'}</span>;
  return (
    <div>
      <div className="text-gray-700 dark:text-gray-300">{describeOutcome(resolution.first)}</div>
      <div className="font-mono text-gray-400">
        {time ?? '—'}
        {resolution.count != null && resolution.count > 1 ? ` · resolved ×${resolution.count}` : ''}
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
