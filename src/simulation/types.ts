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

export type MergeStatus = 'fully_merged' | 'under_merged' | 'deferred_review' | 'over_merged' | 'missing';

/**
 * One `oi.match_review_queue` row as the grader needs it: the raw record that
 * was queued, the DNA it was queued against, and the resolver's score. The
 * grader is source-agnostic; the loader that fills these is separate.
 */
export interface ReviewQueueEdge {
  queueId: string;
  rawRecordId: string;
  candidateDnaRecordId: string;
  score: number;
  markerBreakdown: Record<string, number>;
  status: 'pending' | 'approved' | 'rejected';
  suggestedAt: string;
  decidedAt: string | null;
}

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
  /**
   * Populated for split canonicals when review-queue rows link two of their
   * DNAs. On `deferred_review` these include the pending/approved rows that
   * join the split; rejected rows are listed too (on `under_merged` as well)
   * so a reader can see a pair was queued and turned down.
   */
  reviewPairs?: ReviewQueueEdge[];
}

export interface Report {
  runId: string;
  generatedAt: string;
  summary: {
    canonicalCount: number;
    fullyMerged: number;
    underMerged: number;
    /** Split canonicals whose DNAs are joined by pending/approved review-queue rows. */
    deferredReview: number;
    overMerged: number;
    missing: number;
    recordsTotal: number;
    recordsPassed: number;
    recordsFailed: number;
    precision: number;
    recall: number;
    /** Pairwise recall counting pairs joined by pending/approved review-queue rows as merged. */
    recallWithDeferred: number;
    /** False when no review-queue data was supplied; `deferredReview` is then always 0. */
    reviewQueueChecked: boolean;
  };
  canonicals: CanonicalResult[];
  records: RecordResult[];
}
