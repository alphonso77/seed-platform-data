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

export const SEEDED_TAG = 'seed_platform_seeded';
export const SEEDED_AT_TAG = 'seed_platform_seeded_at';
export const SIMULATION_RUN_ID_TAG = 'simulation_run_id';
export const CANONICAL_ID_TAG = 'canonical_id';
