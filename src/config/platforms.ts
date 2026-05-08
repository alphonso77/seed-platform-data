import { Platform, PlatformConfig } from '@/types';
import { getEnv } from '@config/env';

export const PLATFORMS: Platform[] = ['stripe', 'hubspot', 'shopify'];

export const PLATFORM_LABELS: Record<Platform, string> = {
  stripe: 'Stripe',
  hubspot: 'HubSpot',
  shopify: 'Shopify',
};

export function getPlatformConfig(platform: Platform): PlatformConfig {
  const env = getEnv();

  switch (platform) {
    case 'stripe':
      return {
        platform: 'stripe',
        apiKey: env.STRIPE_SECRET_KEY,
      };
    case 'hubspot':
      return {
        platform: 'hubspot',
        accessToken: env.HUBSPOT_ACCESS_TOKEN,
      };
    case 'shopify':
      return {
        platform: 'shopify',
        accessToken: env.SHOPIFY_ACCESS_TOKEN,
        storeDomain: env.SHOPIFY_STORE_DOMAIN,
      };
  }
}
