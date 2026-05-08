import { Platform, EnvironmentCheck } from '@/types';
import { createSeeder } from '@seeders/index';
import { getEnv } from '@config/env';
import logger from '@utils/logger';

export async function runValidate(platform: Platform): Promise<EnvironmentCheck> {
  logger.info(`Validating environment for ${platform}`);
  const seeder = createSeeder(platform);
  const check = await seeder.validateEnvironment();

  if (!check.isSandbox && isSandboxCheckSkipped(platform)) {
    return {
      ...check,
      isSandbox: true,
      overridden: true,
      reason: `Sandbox check override is active (SKIP_SANDBOX_CHECK_${platform.toUpperCase()}). Actual environment: ${check.reason}`,
    };
  }

  return check;
}

function isSandboxCheckSkipped(platform: Platform): boolean {
  const env = getEnv();
  if (env.NODE_ENV === 'production') return false;

  return {
    stripe: env.SKIP_SANDBOX_CHECK_STRIPE,
    hubspot: env.SKIP_SANDBOX_CHECK_HUBSPOT,
    shopify: env.SKIP_SANDBOX_CHECK_SHOPIFY,
  }[platform];
}
