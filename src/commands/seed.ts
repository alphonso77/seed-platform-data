import { Platform, SeedOptions, SeedResult } from '@/types';
import { createSeeder } from '@seeders/index';
import logger from '@utils/logger';

export async function runSeed(platform: Platform, options: SeedOptions): Promise<SeedResult> {
  logger.info(`Starting seed for ${platform} (size: ${options.size}, dryRun: ${options.dryRun ?? false})`);
  const seeder = createSeeder(platform);
  const result = await seeder.seed(options);
  logger.info(`Seed complete for ${platform}`, { created: result.created, duration: result.duration });
  return result;
}
