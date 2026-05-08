import { Platform, CleanOptions, CleanResult } from '@/types';
import { createSeeder } from '@seeders/index';
import logger from '@utils/logger';

export async function runClean(platform: Platform, options: CleanOptions): Promise<CleanResult> {
  logger.info(`Starting clean for ${platform} (dryRun: ${options.dryRun ?? false})`);
  const seeder = createSeeder(platform);
  const result = await seeder.clean(options);
  logger.info(`Clean complete for ${platform}`, { deleted: result.deleted, duration: result.duration });
  return result;
}
