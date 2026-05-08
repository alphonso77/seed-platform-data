import { Platform } from '@/types';
import { getPlatformConfig } from '@config/platforms';
import { BaseSeeder } from '@seeders/base-seeder';
import { StripeSeeder } from '@seeders/stripe-seeder';
import { HubSpotSeeder } from '@seeders/hubspot-seeder';
import { ShopifySeeder } from '@seeders/shopify-seeder';

export function createSeeder(platform: Platform): BaseSeeder {
  const config = getPlatformConfig(platform);

  switch (platform) {
    case 'stripe':
      return new StripeSeeder(config);
    case 'hubspot':
      return new HubSpotSeeder(config);
    case 'shopify':
      return new ShopifySeeder(config);
  }
}
