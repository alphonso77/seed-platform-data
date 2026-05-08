import { EnvironmentCheck, PlatformConfig } from '@/types';
import { DirtyContact, UploadMappingEntry } from '@/simulation/types';

export abstract class BaseUploader {
  constructor(protected config: PlatformConfig) {}

  abstract validateEnvironment(): Promise<EnvironmentCheck>;

  abstract upload(
    records: DirtyContact[],
    runId: string,
  ): Promise<{ mappings: UploadMappingEntry[]; errors: string[] }>;
}

/**
 * Run an async task per item with bounded concurrency.
 * Used by per-record uploaders (Stripe, Shopify) so a `large` run doesn't take 30 minutes.
 */
export async function promisePool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runner(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
  await Promise.all(runners);
  return results;
}
