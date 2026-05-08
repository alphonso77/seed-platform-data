import { Platform } from '@/types';
import { createSeeder } from '@seeders/index';
import logger from '@utils/logger';

export async function runStatus(platform: Platform): Promise<{ connected: boolean; environment: string }> {
  logger.info(`Checking status for ${platform}`);
  const seeder = createSeeder(platform);
  return seeder.getStatus();
}
