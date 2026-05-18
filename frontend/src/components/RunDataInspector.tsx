import { useEffect, useMemo, useState } from 'react';
import { useInspectorDataset } from '../hooks/useSimulation';
import type {
  CanonicalPerson,
  DirtyContact,
  DirtyRecordTier,
  Platform,
} from '../lib/types';

interface Props {
  runId: string;
}

interface InspectorRow {
  key: string;
  tier: DirtyRecordTier;
  platform: Platform;
  platformEmail: string | null;
  platformName: string;
  platformPhone: string | null;
  diffs: string[];
}

interface InspectorGroup {
  canonicalId: string;
  canonicalEmail: string;
  canonicalName: string;
  records: InspectorRow[];
  tierCounts: Record<DirtyRecordTier, number>;
  hasFuzzy: boolean;
}

type Filter = 'all' | 'fuzzy' | Platform;

const TIER_ORDER: Record<DirtyRecordTier, number> = {
  fuzzy: 0,
  duplicate: 1,
  canonical: 2,
};

const TIER_BADGE: Record<DirtyRecordTier, string> = {
  fuzzy: 'bg-red-500/15 text-red-600 dark:text-red-400',
  duplicate: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  canonical: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

const TIER_LABEL: Record<DirtyRecordTier, string> = {
  fuzzy: 'Tier 2',
  duplicate: 'Tier 1 dup',
  canonical: 'canonical',
};

export function RunDataInspector({ runId }: Props) {
  const { data, isLoading, error } = useInspectorDataset(runId);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const groups: InspectorGroup[] = useMemo(() => {
    if (!data) return [];
    const canonicalById = new Map<string, CanonicalPerson>();
    for (const p of data.answerKey) canonicalById.set(p.canonicalId, p);

    const byCanonical = new Map<string, InspectorGroup>();
    for (const platform of ['stripe', 'hubspot', 'shopify'] as Platform[]) {
      for (const record of data[platform]) {
        const canonical = canonicalById.get(record.canonicalId);
        if (!canonical) continue;
        const row = toRow(platform, record, canonical);
        let group = byCanonical.get(record.canonicalId);
        if (!group) {
          group = {
            canonicalId: record.canonicalId,
            canonicalEmail: canonical.email,
            canonicalName: [canonical.firstName, canonical.lastName].filter(Boolean).join(' '),
            records: [],
            tierCounts: { canonical: 0, duplicate: 0, fuzzy: 0 },
            hasFuzzy: false,
          };
          byCanonical.set(record.canonicalId, group);
        }
        group.records.push(row);
        group.tierCounts[row.tier] += 1;
        if (row.tier === 'fuzzy') group.hasFuzzy = true;
      }
    }

    const out = Array.from(byCanonical.values());
    for (const g of out) {
      g.records.sort((a, b) => {
        const t = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
        if (t !== 0) return t;
        return a.platform.localeCompare(b.platform);
      });
    }
    out.sort((a, b) => {
      // Groups with fuzzy records first, then groups with duplicates, then canonical-only.
      const aRank = a.hasFuzzy ? 0 : a.tierCounts.duplicate > 0 ? 1 : 2;
      const bRank = b.hasFuzzy ? 0 : b.tierCounts.duplicate > 0 ? 1 : 2;
      if (aRank !== bRank) return aRank - bRank;
      return a.canonicalEmail.localeCompare(b.canonicalEmail);
    });
    return out;
  }, [data]);

  // First-load default-expand state: groups containing fuzzy records are expanded
  // so demo-relevant identities are visible without an extra click; canonical-only
  // groups stay collapsed to keep the page scannable. User toggles persist after.
  useEffect(() => {
    if (groups.length === 0) return;
    setExpanded((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next: Record<string, boolean> = {};
      for (const g of groups) next[g.canonicalId] = g.hasFuzzy;
      return next;
    });
  }, [groups]);

  const visibleGroups = useMemo(() => {
    if (filter === 'all') return groups;
    if (filter === 'fuzzy') return groups.filter((g) => g.hasFuzzy);
    return groups.filter((g) => g.records.some((r) => r.platform === filter));
  }, [groups, filter]);

  const totals = useMemo(() => {
    const recordCount = groups.reduce((n, g) => n + g.records.length, 0);
    const fuzzyGroups = groups.filter((g) => g.hasFuzzy).length;
    return { recordCount, fuzzyGroups, canonicalCount: groups.length };
  }, [groups]);

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function setAll(value: boolean) {
    const next: Record<string, boolean> = {};
    for (const g of visibleGroups) next[g.canonicalId] = value;
    setExpanded((prev) => ({ ...prev, ...next }));
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/30">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Generated data inspector</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {totals.canonicalCount} canonicals · {totals.recordCount} records · {totals.fuzzyGroups}{' '}
            with Tier 2 variants. Dirtiest first.
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          <button
            onClick={() => setAll(true)}
            className="rounded bg-gray-100 px-2 py-1 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Expand all
          </button>
          <button
            onClick={() => setAll(false)}
            className="rounded bg-gray-100 px-2 py-1 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Collapse all
          </button>
        </div>
      </div>

      {isLoading && <div className="py-6 text-center text-xs text-gray-400">Loading generated artifacts…</div>}
      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          {error.message}
        </div>
      )}

      {!isLoading && !error && (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            {(['all', 'fuzzy', 'stripe', 'hubspot', 'shopify'] as Filter[]).map((f) => {
              const count =
                f === 'all'
                  ? groups.length
                  : f === 'fuzzy'
                    ? totals.fuzzyGroups
                    : groups.filter((g) => g.records.some((r) => r.platform === f)).length;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3 py-1 capitalize transition ${
                    filter === f
                      ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                  }`}
                >
                  {f === 'all' ? `All (${count})` : f === 'fuzzy' ? `Tier 2 (${count})` : `${f} (${count})`}
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            {visibleGroups.map((g) => {
              const isExpanded = expanded[g.canonicalId] ?? false;
              return (
                <div
                  key={g.canonicalId}
                  className="rounded border border-gray-200 dark:border-gray-700"
                >
                  <button
                    type="button"
                    onClick={() => toggle(g.canonicalId)}
                    className="flex w-full items-center justify-between gap-3 bg-gray-50 px-3 py-2 text-left hover:bg-gray-100 dark:bg-gray-900/50 dark:hover:bg-gray-800/50"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-gray-400">{isExpanded ? '▾' : '▸'}</span>
                      <span className="font-mono text-xs text-gray-700 dark:text-gray-200">
                        {g.canonicalEmail}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{g.canonicalName}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(['fuzzy', 'duplicate', 'canonical'] as DirtyRecordTier[]).map((t) =>
                        g.tierCounts[t] > 0 ? (
                          <span
                            key={t}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TIER_BADGE[t]}`}
                          >
                            {TIER_LABEL[t]} ×{g.tierCounts[t]}
                          </span>
                        ) : null,
                      )}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-white text-[10px] uppercase tracking-wide text-gray-400 dark:bg-gray-900/30">
                          <tr>
                            <th className="px-2 py-1.5">Tier</th>
                            <th className="px-2 py-1.5">Plat</th>
                            <th className="px-2 py-1.5">Platform email</th>
                            <th className="px-2 py-1.5">Platform name</th>
                            <th className="px-2 py-1.5">Platform phone</th>
                            <th className="px-2 py-1.5">Diff highlights</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {g.records.map((r) => (
                            <tr key={r.key} className="text-gray-700 dark:text-gray-300">
                              <td className="px-2 py-1.5">
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TIER_BADGE[r.tier]}`}
                                >
                                  {TIER_LABEL[r.tier]}
                                </span>
                              </td>
                              <td className="px-2 py-1.5 capitalize">{r.platform}</td>
                              <td className="px-2 py-1.5 font-mono">
                                {r.platformEmail ?? <em className="text-gray-400">null</em>}
                              </td>
                              <td className="px-2 py-1.5">
                                {r.platformName || <em className="text-gray-400">null</em>}
                              </td>
                              <td className="px-2 py-1.5 font-mono">
                                {r.platformPhone ?? <em className="text-gray-400">null</em>}
                              </td>
                              <td className="px-2 py-1.5">
                                {r.diffs.length === 0 ? (
                                  <span className="text-gray-400">—</span>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {r.diffs.map((d) => (
                                      <span
                                        key={d}
                                        className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] text-orange-600 dark:text-orange-300"
                                      >
                                        {d}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
            {visibleGroups.length === 0 && (
              <div className="rounded border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-400 dark:border-gray-700">
                No canonicals match this filter.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function toRow(platform: Platform, record: DirtyContact, canonical: CanonicalPerson): InspectorRow {
  const platformName = [record.firstName, record.lastName].filter(Boolean).join(' ');
  const diffs: string[] = [];

  if (record.email === null) diffs.push('email: null');
  else if (record.email !== canonical.email) {
    const [canonLocal, canonDomain] = canonical.email.split('@');
    const [recLocal, recDomain] = record.email.split('@');
    if (canonDomain !== recDomain) diffs.push('email: new');
    else if (canonLocal !== recLocal) diffs.push('email: mutated');
  }

  if (record.phone === null && canonical.phone) diffs.push('phone: null');
  else if (record.phone && record.phone !== canonical.phone) diffs.push('phone: changed');

  if (record.firstName !== canonical.firstName || record.lastName !== canonical.lastName) {
    if (
      record.firstName?.toLowerCase() === canonical.lastName.toLowerCase() &&
      record.lastName?.toLowerCase() === canonical.firstName.toLowerCase()
    ) {
      diffs.push('name: reversed');
    } else if (record.firstName === null || record.lastName === null) {
      diffs.push('name: missing');
    } else {
      diffs.push('name: mutated');
    }
  }

  if (record.company === null && canonical.company) diffs.push('company: null');
  if (record.jobTitle === null && canonical.jobTitle) diffs.push('title: null');

  if (record.address === null || record.address?.street === null) {
    if (canonical.address?.street) diffs.push('address: null');
  } else if (record.address.street !== canonical.address.street) {
    diffs.push('street: changed');
  }

  return {
    key: `${platform}:${record.internalId}`,
    // Runs generated before the tier marker was added won't have this field —
    // fall back to 'canonical' so the inspector still renders historic data.
    tier: record.tier ?? 'canonical',
    platform,
    platformEmail: record.email,
    platformName,
    platformPhone: record.phone,
  diffs,
  };
}
