import { DatasetSize, GeneratedContact, Platform } from '@/types';

export interface CanonicalPerson extends GeneratedContact {
  canonicalId: string;
}

/**
 * Provenance of a dirty record relative to its canonical person.
 * `canonical` — the base record (no duplicate / fuzzy mutation applied).
 * `duplicate` — a Tier-1 duplicate (shares exact email or phone with canonical).
 * `fuzzy`    — a Tier-2 fuzzy variant (nickname/typo name, abbreviated address,
 *              mutated or different email, null phone). Used by the inspector
 *              UI to sort dirtiest records first.
 */
export type DirtyRecordTier = 'canonical' | 'duplicate' | 'fuzzy';

export interface DirtyContact {
  canonicalId: string;
  internalId: string;
  tier: DirtyRecordTier;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  address: {
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    country: string | null;
  } | null;
}

export interface DirtyDatasets {
  stripe: DirtyContact[];
  hubspot: DirtyContact[];
  shopify: DirtyContact[];
}

export interface SimulationRunOptions {
  size: DatasetSize;
  fragment: boolean;
  duplicate: boolean;
  fuzzy?: boolean;
  platforms?: Platform[];
}

export type RunStage = 'generated' | 'uploaded' | 'oi-uploaded' | 'reported';

export interface SimulationRunSummary {
  runId: string;
  createdAt: string;
  options: SimulationRunOptions;
  stage: RunStage;
  counts: {
    answerKey: number;
    stripe: number;
    hubspot: number;
    shopify: number;
  };
}

export interface UploadMappingEntry {
  canonicalId: string;
  internalId: string;
  externalId: string;
  platform: Platform;
}

export interface UploadResult {
  runId: string;
  uploadedAt: string;
  mappings: UploadMappingEntry[];
  errors: string[];
}

export interface OiResultRow {
  rawRecordId: string;
  dnaRecordId: string | null;
  orgId: string;
  sourcePlatform: string;
  sourceObjectType: string;
  sourceRecordId: string;
  ingestedAt: string | null;
  lastModifiedAt: string | null;
  resolvedAt: string | null;
  rawPayload: Record<string, unknown>;
}

export type MergeStatus = 'fully_merged' | 'under_merged' | 'over_merged' | 'missing';

export interface RecordResult {
  canonicalId: string;
  canonicalEmail: string;
  internalId: string;
  platform: Platform;
  externalId: string;
  dnaRecordId: string | null;
  pass: boolean;
  mergeStatus: MergeStatus;
}

export interface DnaBreakdownRecord {
  platform: Platform;
  externalId: string;
  internalId: string;
  email: string | null;
  phone: string | null;
}

export interface DnaBreakdownGroup {
  dnaRecordId: string;
  records: DnaBreakdownRecord[];
}

export interface CanonicalResult {
  canonicalId: string;
  mergeStatus: MergeStatus;
  expectedRecords: number;
  foundRecords: number;
  dnaRecordIds: string[];
  /**
   * Populated only for `under_merged` and `over_merged` canonicals (kept off
   * `fully_merged` to keep clean reports compact). Groups the canonical's
   * records by their landing DNA, with markers extracted from the raw payload
   * so a reader can see which marker bridged each record without joining
   * tables manually.
   */
  dnaBreakdown?: DnaBreakdownGroup[];
}

export interface Report {
  runId: string;
  generatedAt: string;
  summary: {
    canonicalCount: number;
    fullyMerged: number;
    underMerged: number;
    overMerged: number;
    missing: number;
    recordsTotal: number;
    recordsPassed: number;
    recordsFailed: number;
    precision: number;
    recall: number;
  };
  canonicals: CanonicalResult[];
  records: RecordResult[];
}
