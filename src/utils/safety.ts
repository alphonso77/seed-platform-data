import { Platform, EnvironmentCheck } from '@/types';
import { getEnv } from '@config/env';
import logger from '@utils/logger';

function isSandboxCheckSkipped(platform: Platform): boolean {
  const env = getEnv();
  if (env.NODE_ENV === 'production') return false;

  const flag = {
    stripe: env.SKIP_SANDBOX_CHECK_STRIPE,
    hubspot: env.SKIP_SANDBOX_CHECK_HUBSPOT,
    shopify: env.SKIP_SANDBOX_CHECK_SHOPIFY,
  }[platform];

  if (flag) {
    logger.warn(`[SAFETY] Sandbox check SKIPPED for ${platform} (SKIP_SANDBOX_CHECK_${platform.toUpperCase()}=true)`);
  }
  return flag;
}

export function checkStripeEnvironment(): EnvironmentCheck {
  const key = getEnv().STRIPE_SECRET_KEY;

  if (!key) {
    return {
      platform: 'stripe',
      isSandbox: false,
      reason: 'STRIPE_SECRET_KEY is not configured',
    };
  }

  if (key.startsWith('sk_live_')) {
    return {
      platform: 'stripe',
      isSandbox: false,
      reason: 'API key starts with sk_live_ — this is a production key. Only sk_test_ keys are allowed.',
    };
  }

  if (key.startsWith('sk_test_')) {
    return {
      platform: 'stripe',
      isSandbox: true,
      reason: 'API key starts with sk_test_ — confirmed test environment',
    };
  }

  return {
    platform: 'stripe',
    isSandbox: false,
    reason: `API key has unrecognized prefix — expected sk_test_*`,
  };
}

export function checkHubSpotEnvironment(): EnvironmentCheck {
  const token = getEnv().HUBSPOT_ACCESS_TOKEN;

  if (!token) {
    return {
      platform: 'hubspot',
      isSandbox: false,
      reason: 'HUBSPOT_ACCESS_TOKEN is not configured',
    };
  }

  // HubSpot sandbox detection is done at runtime via API call in the seeder.
  // This static check just confirms the token is present.
  return {
    platform: 'hubspot',
    isSandbox: true,
    reason: 'Access token is configured — sandbox verification will be done via API',
  };
}

export function checkShopifyEnvironment(): EnvironmentCheck {
  const domain = getEnv().SHOPIFY_STORE_DOMAIN;
  const token = getEnv().SHOPIFY_ACCESS_TOKEN;

  if (!domain || !token) {
    return {
      platform: 'shopify',
      isSandbox: false,
      reason: 'SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN is not configured',
    };
  }

  if (!domain.endsWith('.myshopify.com')) {
    return {
      platform: 'shopify',
      isSandbox: false,
      reason: `Store domain "${domain}" does not end with .myshopify.com`,
    };
  }

  // Further dev store verification done via API in the seeder
  return {
    platform: 'shopify',
    isSandbox: true,
    reason: 'Store domain ends with .myshopify.com — dev store verification will be done via API',
  };
}

export function checkEnvironment(platform: Platform): EnvironmentCheck {
  switch (platform) {
    case 'stripe':
      return checkStripeEnvironment();
    case 'hubspot':
      return checkHubSpotEnvironment();
    case 'shopify':
      return checkShopifyEnvironment();
  }
}

export function assertSandbox(check: EnvironmentCheck): void {
  if (!check.isSandbox) {
    if (isSandboxCheckSkipped(check.platform)) {
      return;
    }
    throw new Error(
      `SAFETY: ${check.platform} environment check failed — ${check.reason}. ` +
      `Seeding is only allowed in sandbox/test environments. ` +
      `To override in development, set SKIP_SANDBOX_CHECK_${check.platform.toUpperCase()}=true`
    );
  }
}
