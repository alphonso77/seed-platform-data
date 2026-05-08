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
