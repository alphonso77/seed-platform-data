export type Platform = 'stripe' | 'hubspot' | 'shopify';
export type DatasetSize = 'small' | 'medium' | 'large';

export interface PlatformStatus {
  platform: Platform;
  label: string;
  connected: boolean;
  environment: string;
}

export interface EnvironmentCheck {
  platform: Platform;
  isSandbox: boolean;
  overridden?: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

export interface SeedOptions {
  size: DatasetSize;
  emailDomains: string[];
  useRandomDomains: boolean;
  dryRun?: boolean;
  skipOrders?: boolean;
}

export interface SeedResult {
  platform: Platform;
  size: DatasetSize;
  created: {
    contacts: number;
    products: number;
    orders: number;
    [key: string]: number;
  };
  duration: number;
  errors: string[];
}

export interface CleanResult {
  platform: Platform;
  deleted: { [entity: string]: number };
  duration: number;
  errors: string[];
}

export const DATASET_SIZES: Record<DatasetSize, { contacts: number; products: number; orders: number }> = {
  small: { contacts: 25, products: 5, orders: 10 },
  medium: { contacts: 250, products: 25, orders: 100 },
  large: { contacts: 2500, products: 100, orders: 1000 },
};

export const PLATFORM_ICONS: Record<Platform, string> = {
  stripe: 'S',
  hubspot: 'H',
  shopify: 'Sh',
};

// ---- Simulation ----

export type RunStage = 'generated' | 'uploaded' | 'oi-uploaded' | 'reported';

export interface SimulationRunOptions {
  size: DatasetSize;
  fragment: boolean;
  duplicate: boolean;
  fuzzy: boolean;
  platforms?: Platform[];
}

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

export interface CanonicalPerson {
  canonicalId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  jobTitle: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
}

export interface CanonicalResult {
  canonicalId: string;
  mergeStatus: MergeStatus;
  expectedRecords: number;
  foundRecords: number;
  dnaRecordIds: string[];
}

export interface SimulationReport {
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

export interface SimulationRunState {
  summary: SimulationRunSummary;
  upload: UploadResult | null;
  report: SimulationReport | null;
}

export type ArtifactName =
  | 'meta.json'
  | 'answer-key.json'
  | 'stripe-dirty.json'
  | 'hubspot-dirty.json'
  | 'shopify-dirty.json'
  | 'upload-result.json'
  | 'oi-result.csv'
  | 'report.json'
  | 'report.csv';
