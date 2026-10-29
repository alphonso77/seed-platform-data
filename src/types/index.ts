export type Platform = 'stripe' | 'hubspot' | 'shopify';
export type DatasetSize = 'small' | 'medium' | 'large';

export interface PlatformConfig {
  platform: Platform;
  apiKey?: string;
  accessToken?: string;
  storeDomain?: string;
}

export interface SeedOptions {
  size: DatasetSize;
  emailDomains: string[];
  useRandomDomains: boolean;
  dryRun?: boolean;
  reuse?: boolean;
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

export interface CleanOptions {
  platform: Platform;
  dryRun?: boolean;
  orphans?: boolean;
}

export interface CleanResult {
  platform: Platform;
  deleted: { [entity: string]: number };
  duration: number;
  errors: string[];
}

export interface EnvironmentCheck {
  platform: Platform;
  isSandbox: boolean;
  overridden?: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

export interface GeneratedContact {
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

export interface GeneratedProduct {
  name: string;
  description: string;
  price: number;
  currency: string;
  sku: string;
  category: string;
  images: string[];
}

export interface GeneratedOrder {
  contactIndex: number;
  productIndices: number[];
  quantities: number[];
  status: string;
  createdAt: Date;
  notes: string;
}

// The only tags a seeded record carries: what cleanup needs. Never add an
// answer-key value (canonical id, internal id): FratelliSoftware copies Stripe
// metadata, HubSpot custom properties and Shopify tags into the Data Lake, so
// FSOI could grade itself against its own answer key (FS-361). Grading joins
// records to people through upload-result.json instead.
export const SEEDED_TAG = 'seed_platform_seeded';
export const SEEDED_AT_TAG = 'seed_platform_seeded_at';
export const SIMULATION_RUN_ID_TAG = 'simulation_run_id';
