import { Platform } from '@/types';
import { getPlatformConfig } from '@config/platforms';
import { BaseUploader } from '@/simulation/uploaders/base-uploader';
import { StripeUploader } from '@/simulation/uploaders/stripe-uploader';
import { HubSpotUploader } from '@/simulation/uploaders/hubspot-uploader';
import { ShopifyUploader } from '@/simulation/uploaders/shopify-uploader';

export function createUploader(platform: Platform): BaseUploader {
  const config = getPlatformConfig(platform);
  switch (platform) {
    case 'stripe':
      return new StripeUploader(config);
    case 'hubspot':
      return new HubSpotUploader(config);
    case 'shopify':
      return new ShopifyUploader(config);
  }
}

export { BaseUploader } from '@/simulation/uploaders/base-uploader';
