import { Platform } from '@/types';
import {
  CanonicalPerson,
  CanonicalResult,
  DnaBreakdownGroup,
  DnaBreakdownRecord,
  MergeStatus,
  OiResultRow,
  RecordResolution,
  RecordResult,
  Report,
  ReviewQueueEdge,
  UploadMappingEntry,
} from '@/simulation/types';

export interface GenerateReportInput {
  runId: string;
  answerKey: CanonicalPerson[];
  uploadMapping: UploadMappingEntry[];
  oiRows: OiResultRow[];
  /**
   * `oi.match_review_queue` rows for the run's org. Omit when the queue was
   * not checked; split canonicals then grade `under_merged` as before.
   */
  reviewQueue?: ReviewQueueEdge[];
  /** Per raw_record_id resolution outcome (DB columns or worker-log import). */
  resolutions?: Record<string, RecordResolution>;
}

const PLATFORMS: Platform[] = ['stripe', 'hubspot', 'shopify'];

function platformKey(platform: string, externalId: string): string {
  return `${platform}::${externalId}`;
}

export function generateReport(input: GenerateReportInput): Report {
  const { runId, answerKey, uploadMapping, oiRows, reviewQueue, resolutions } = input;

  // Index canonical email by canonicalId so each RecordResult carries the
  // canonical's email — used by the report UI to let a demo'er paste the
  // email straight into the upstream OI lookup.
  const emailByCanonical = new Map<string, string>();
  for (const p of answerKey) emailByCanonical.set(p.canonicalId, p.email);

  // Index uploaded records by platform+externalId for O(1) join with OI rows.
  const mappingByExternal = new Map<string, UploadMappingEntry>();
  for (const m of uploadMapping) {
    mappingByExternal.set(platformKey(m.platform, m.externalId), m);
  }

  // Index OI rows by the same key for per-canonical marker lookup.
  const oiByPlatformKey = new Map<string, OiResultRow>();
  for (const row of oiRows) {
    oiByPlatformKey.set(platformKey(row.sourcePlatform, row.sourceRecordId), row);
  }

  // For each upload mapping entry, find its dna_record_id (or null if OI dropped it).
  const dnaByInternalId = new Map<string, string | null>();
  // Track which OI rows we matched so we can detect orphans.
  const matchedRawRecordIds = new Set<string>();

  for (const row of oiRows) {
    const m = mappingByExternal.get(platformKey(row.sourcePlatform, row.sourceRecordId));
    if (!m) continue;
    matchedRawRecordIds.add(row.rawRecordId);
    // If a record appears multiple times, prefer the first non-null dna_record_id.
    const existing = dnaByInternalId.get(m.internalId);
    if (existing == null) dnaByInternalId.set(m.internalId, row.dnaRecordId);
  }

  // Build canonical → expected mapping entries.
  const mappingsByCanonical = new Map<string, UploadMappingEntry[]>();
  for (const m of uploadMapping) {
    const list = mappingsByCanonical.get(m.canonicalId) ?? [];
    list.push(m);
    mappingsByCanonical.set(m.canonicalId, list);
  }

  // For each dna_record_id, which canonicals does it touch?
  const canonicalsByDna = new Map<string, Set<string>>();
  for (const m of uploadMapping) {
    const dna = dnaByInternalId.get(m.internalId);
    if (!dna) continue;
    const set = canonicalsByDna.get(dna) ?? new Set<string>();
    set.add(m.canonicalId);
    canonicalsByDna.set(dna, set);
  }

  // Each queue row links the DNA its raw record landed in with the candidate
  // DNA it was scored against. Pending and approved rows count as a deferred
  // merge; rejected rows are only reported.
  const dnaByRawRecordId = new Map<string, string>();
  for (const row of oiRows) {
    if (row.dnaRecordId) dnaByRawRecordId.set(row.rawRecordId, row.dnaRecordId);
  }
  const queueLinks = (reviewQueue ?? [])
    .map((edge) => ({ edge, rawDna: dnaByRawRecordId.get(edge.rawRecordId) }))
    .filter((l): l is { edge: ReviewQueueEdge; rawDna: string } => l.rawDna != null);
  const deferredUnion = new UnionFind();
  for (const { edge, rawDna } of queueLinks) {
    // A null candidate (DNA deleted) would join every such row through one
    // shared node; the loader filters these out, this guards other sources.
    if (edge.status !== 'rejected' && edge.candidateDnaRecordId != null) {
      deferredUnion.union(rawDna, edge.candidateDnaRecordId);
    }
  }

  const canonicals: CanonicalResult[] = [];
  const records: RecordResult[] = [];

  for (const person of answerKey) {
    const expected = mappingsByCanonical.get(person.canonicalId) ?? [];
    const found = expected.filter((m) => dnaByInternalId.has(m.internalId));
    const dnaIds = unique(found.map((m) => dnaByInternalId.get(m.internalId)).filter(isNonNull));

    let status: MergeStatus;
    if (expected.length === 0 || found.length < expected.length || dnaIds.length === 0) {
      status = 'missing';
    } else if (dnaIds.length > 1) {
      const roots = new Set(dnaIds.map((d) => deferredUnion.find(d)));
      status = roots.size === 1 ? 'deferred_review' : 'under_merged';
    } else {
      const dna = dnaIds[0];
      const sharedWith = canonicalsByDna.get(dna);
      const mergedWithOthers = sharedWith && sharedWith.size > 1;
      status = mergedWithOthers ? 'over_merged' : 'fully_merged';
    }

    const isSplit = status === 'under_merged' || status === 'deferred_review';
    const dnaBreakdown =
      isSplit || status === 'over_merged'
        ? buildDnaBreakdown(expected, dnaByInternalId, oiByPlatformKey)
        : undefined;
    const ownDnas = new Set(dnaIds);
    const reviewPairs = isSplit
      ? queueLinks
          .filter(({ edge, rawDna }) =>
            edge.candidateDnaRecordId != null &&
            rawDna !== edge.candidateDnaRecordId &&
            ownDnas.has(rawDna) &&
            ownDnas.has(edge.candidateDnaRecordId))
          .map(({ edge }) => edge)
      : [];

    canonicals.push({
      canonicalId: person.canonicalId,
      mergeStatus: status,
      expectedRecords: expected.length,
      foundRecords: found.length,
      dnaRecordIds: dnaIds,
      ...(dnaBreakdown && dnaBreakdown.length > 0 ? { dnaBreakdown } : {}),
      ...(reviewPairs.length > 0 ? { reviewPairs } : {}),
    });

    for (const m of expected) {
      const row = oiByPlatformKey.get(platformKey(m.platform, m.externalId));
      const resolution = row ? resolutions?.[row.rawRecordId] : undefined;
      records.push({
        canonicalId: m.canonicalId,
        canonicalEmail: emailByCanonical.get(m.canonicalId) ?? '',
        internalId: m.internalId,
        platform: m.platform,
        externalId: m.externalId,
        dnaRecordId: dnaByInternalId.get(m.internalId) ?? null,
        rawRecordId: row?.rawRecordId ?? null,
        resolvedAt: row?.resolvedAt ?? null,
        ...(resolution ? { resolution } : {}),
        pass: status === 'fully_merged',
        mergeStatus: status,
      });
    }
  }

  const summary = computeSummary(
    canonicals,
    records,
    uploadMapping,
    dnaByInternalId,
    deferredUnion,
    reviewQueue !== undefined,
  );

  return {
    runId,
    generatedAt: new Date().toISOString(),
    summary,
    canonicals,
    records,
  };
}

function computeSummary(
  canonicals: CanonicalResult[],
  records: RecordResult[],
  mapping: UploadMappingEntry[],
  dnaByInternalId: Map<string, string | null>,
  deferredUnion: UnionFind,
  reviewQueueChecked: boolean,
): Report['summary'] {
  const fullyMerged = canonicals.filter((c) => c.mergeStatus === 'fully_merged').length;
  const underMerged = canonicals.filter((c) => c.mergeStatus === 'under_merged').length;
  const deferredReview = canonicals.filter((c) => c.mergeStatus === 'deferred_review').length;
  const overMerged = canonicals.filter((c) => c.mergeStatus === 'over_merged').length;
  const missing = canonicals.filter((c) => c.mergeStatus === 'missing').length;

  const recordsPassed = records.filter((r) => r.pass).length;
  // Deferred records are neither passed nor failed.
  const recordsDeferred = records.filter((r) => r.mergeStatus === 'deferred_review').length;
  const recordsFailed = records.length - recordsPassed - recordsDeferred;

  const { precision, recall } = pairwiseMetrics(mapping, (id) => dnaByInternalId.get(id));
  const { recall: recallWithDeferred } = pairwiseMetrics(mapping, (id) => {
    const dna = dnaByInternalId.get(id);
    return dna == null ? dna : deferredUnion.find(dna);
  });

  return {
    canonicalCount: canonicals.length,
    fullyMerged,
    underMerged,
    deferredReview,
    overMerged,
    missing,
    recordsTotal: records.length,
    recordsPassed,
    recordsFailed,
    recordsDeferred,
    precision,
    recall,
    recallWithDeferred,
    reviewQueueChecked,
  };
}

// `dnaOf` maps a record to the DNA it is grouped under; passing the deferred
// union's root instead of the raw DNA gives recall with deferred pairs merged.
function pairwiseMetrics(
  mapping: UploadMappingEntry[],
  dnaOf: (internalId: string) => string | null | undefined,
): { precision: number; recall: number } {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (let i = 0; i < mapping.length; i++) {
    for (let j = i + 1; j < mapping.length; j++) {
      const a = mapping[i];
      const b = mapping[j];
      const sameCanonical = a.canonicalId === b.canonicalId;
      const dnaA = dnaOf(a.internalId);
      const dnaB = dnaOf(b.internalId);
      const sameDna = dnaA != null && dnaA === dnaB;

      if (sameCanonical && sameDna) truePositives += 1;
      else if (!sameCanonical && sameDna) falsePositives += 1;
      else if (sameCanonical && !sameDna) falseNegatives += 1;
    }
  }

  const precision = truePositives + falsePositives === 0
    ? 1
    : truePositives / (truePositives + falsePositives);
  const recall = truePositives + falseNegatives === 0
    ? 1
    : truePositives / (truePositives + falseNegatives);
  return { precision, recall };
}

export function reportToCsv(report: Report): string {
  const header = [
    'canonical_id',
    'canonical_email',
    'platform',
    'internal_id',
    'external_id',
    'dna_record_id',
    'merge_status',
    'pass',
    'raw_record_id',
    'resolved_at',
    'resolution_tier',
    'resolution_action',
    'resolution_via',
    'resolution_reason',
    'resolution_score',
    'resolution_count',
    'latest_resolution_action',
    'latest_resolution_via',
  ];
  const lines = [header.join(',')];
  for (const r of report.records) {
    lines.push(
      [
        r.canonicalId,
        r.canonicalEmail,
        r.platform,
        r.internalId,
        r.externalId,
        r.dnaRecordId ?? '',
        r.mergeStatus,
        r.pass ? 'pass' : r.mergeStatus === 'deferred_review' ? 'deferred' : 'fail',
        r.rawRecordId ?? '',
        r.resolvedAt ?? '',
        r.resolution?.first.tier == null ? '' : String(r.resolution.first.tier),
        r.resolution?.first.action ?? '',
        r.resolution?.first.via ?? '',
        r.resolution?.first.reason ?? '',
        r.resolution?.first.score == null ? '' : String(r.resolution.first.score),
        r.resolution?.count == null ? '' : String(r.resolution.count),
        r.resolution?.latest?.action ?? '',
        r.resolution?.latest?.via ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(id: string): string {
    let root = id;
    while (this.parent.has(root) && this.parent.get(root) !== root) {
      root = this.parent.get(root) as string;
    }
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function isNonNull<T>(value: T | null | undefined): value is T {
  return value != null;
}

function buildDnaBreakdown(
  expected: UploadMappingEntry[],
  dnaByInternalId: Map<string, string | null>,
  oiByPlatformKey: Map<string, OiResultRow>,
): DnaBreakdownGroup[] {
  const groups = new Map<string, DnaBreakdownRecord[]>();
  for (const m of expected) {
    const dna = dnaByInternalId.get(m.internalId);
    if (!dna) continue;
    const row = oiByPlatformKey.get(platformKey(m.platform, m.externalId));
    const markers = row ? extractMarkers(m.platform, row.rawPayload) : { email: null, phone: null };
    const list = groups.get(dna) ?? [];
    list.push({
      platform: m.platform,
      externalId: m.externalId,
      internalId: m.internalId,
      email: markers.email,
      phone: markers.phone,
    });
    groups.set(dna, list);
  }
  return Array.from(groups.entries()).map(([dnaRecordId, records]) => ({ dnaRecordId, records }));
}

function extractMarkers(
  platform: Platform,
  payload: Record<string, unknown>,
): { email: string | null; phone: string | null } {
  if (platform === 'hubspot') {
    const props = (payload.properties ?? {}) as Record<string, unknown>;
    return {
      email: stringOrNull(props.email),
      phone: stringOrNull(props.phone) ?? stringOrNull(props.mobilephone),
    };
  }
  return {
    email: stringOrNull(payload.email),
    phone: stringOrNull(payload.phone),
  };
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// Re-export to help routes typecheck — referenced platforms list.
export const SUPPORTED_PLATFORMS = PLATFORMS;
