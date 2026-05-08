import { Platform } from '@/types';
import {
  CanonicalPerson,
  CanonicalResult,
  DnaBreakdownGroup,
  DnaBreakdownRecord,
  MergeStatus,
  OiResultRow,
  RecordResult,
  Report,
  UploadMappingEntry,
} from '@/simulation/types';

export interface GenerateReportInput {
  runId: string;
  answerKey: CanonicalPerson[];
  uploadMapping: UploadMappingEntry[];
  oiRows: OiResultRow[];
}

const PLATFORMS: Platform[] = ['stripe', 'hubspot', 'shopify'];

function platformKey(platform: string, externalId: string): string {
  return `${platform}::${externalId}`;
}

export function generateReport(input: GenerateReportInput): Report {
  const { runId, answerKey, uploadMapping, oiRows } = input;

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
      status = 'under_merged';
    } else {
      const dna = dnaIds[0];
      const sharedWith = canonicalsByDna.get(dna);
      const mergedWithOthers = sharedWith && sharedWith.size > 1;
      status = mergedWithOthers ? 'over_merged' : 'fully_merged';
    }

    const dnaBreakdown =
      status === 'under_merged' || status === 'over_merged'
        ? buildDnaBreakdown(expected, dnaByInternalId, oiByPlatformKey)
        : undefined;

    canonicals.push({
      canonicalId: person.canonicalId,
      mergeStatus: status,
      expectedRecords: expected.length,
      foundRecords: found.length,
      dnaRecordIds: dnaIds,
      ...(dnaBreakdown && dnaBreakdown.length > 0 ? { dnaBreakdown } : {}),
    });

    for (const m of expected) {
      records.push({
        canonicalId: m.canonicalId,
        internalId: m.internalId,
        platform: m.platform,
        externalId: m.externalId,
        dnaRecordId: dnaByInternalId.get(m.internalId) ?? null,
        pass: status === 'fully_merged',
        mergeStatus: status,
      });
    }
  }

  const summary = computeSummary(canonicals, records, uploadMapping, dnaByInternalId);

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
): Report['summary'] {
  const fullyMerged = canonicals.filter((c) => c.mergeStatus === 'fully_merged').length;
  const underMerged = canonicals.filter((c) => c.mergeStatus === 'under_merged').length;
  const overMerged = canonicals.filter((c) => c.mergeStatus === 'over_merged').length;
  const missing = canonicals.filter((c) => c.mergeStatus === 'missing').length;

  const recordsPassed = records.filter((r) => r.pass).length;
  const recordsFailed = records.length - recordsPassed;

  const { precision, recall } = pairwiseMetrics(mapping, dnaByInternalId);

  return {
    canonicalCount: canonicals.length,
    fullyMerged,
    underMerged,
    overMerged,
    missing,
    recordsTotal: records.length,
    recordsPassed,
    recordsFailed,
    precision,
    recall,
  };
}

function pairwiseMetrics(
  mapping: UploadMappingEntry[],
  dnaByInternalId: Map<string, string | null>,
): { precision: number; recall: number } {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (let i = 0; i < mapping.length; i++) {
    for (let j = i + 1; j < mapping.length; j++) {
      const a = mapping[i];
      const b = mapping[j];
      const sameCanonical = a.canonicalId === b.canonicalId;
      const dnaA = dnaByInternalId.get(a.internalId);
      const dnaB = dnaByInternalId.get(b.internalId);
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
    'platform',
    'internal_id',
    'external_id',
    'dna_record_id',
    'merge_status',
    'pass',
  ];
  const lines = [header.join(',')];
  for (const r of report.records) {
    lines.push(
      [
        r.canonicalId,
        r.platform,
        r.internalId,
        r.externalId,
        r.dnaRecordId ?? '',
        r.mergeStatus,
        r.pass ? 'pass' : 'fail',
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
