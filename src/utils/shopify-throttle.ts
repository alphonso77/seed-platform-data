import logger from '@utils/logger';

/**
 * Shopify's REST Admin API on standard/development stores allows ~2 calls/sec
 * with a 40-call leaky bucket. Without pacing, large seeds (≥40 records) drain
 * the bucket and every subsequent call returns "Exceeded 2 calls per second".
 *
 * This module gives both the seeder and the simulation uploader a small,
 * shared throttle: a per-run pacer that spaces request *starts* at ≥550ms
 * (≈1.8/sec sustained), and a retry wrapper that backs off exponentially on
 * detected throttle errors.
 */

const MIN_REQUEST_INTERVAL_MS = 550;
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Detect Shopify's "leaky bucket exceeded" throttle errors. The
 * @shopify/shopify-api client surfaces these as Error instances whose message
 * contains "throttling" (HTTP 429 from the Shopify API). We match on message
 * text because the library's HttpThrottledError isn't always re-exported
 * cleanly across versions, and the message form is stable.
 */
export function isShopifyThrottleError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /throttl/i.test(message);
}

export interface ShopifyThrottle {
  /** Reserve and await the next request slot. Call before every REST call. */
  pace: () => Promise<void>;
  /** Wraps a REST call: paces, then retries on throttle with exponential backoff. */
  callWithRetry: <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * Build a fresh throttle for one logical "run" (one seed call, one upload).
 * Each run gets its own internal slot counter so parallel runs don't share
 * pacing state — Shopify's bucket is per-API-client, so this is per-process
 * but in practice we only run one Shopify operation at a time anyway.
 */
export function createShopifyThrottle(label = 'Shopify'): ShopifyThrottle {
  let nextSlotAt = 0;

  const pace = async (): Promise<void> => {
    const now = Date.now();
    const wait = Math.max(0, nextSlotAt - now);
    nextSlotAt = Math.max(now, nextSlotAt) + MIN_REQUEST_INTERVAL_MS;
    if (wait > 0) await sleep(wait);
  };

  const callWithRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    let attempt = 0;
    while (true) {
      await pace();
      try {
        return await fn();
      } catch (err) {
        if (!isShopifyThrottleError(err) || attempt >= MAX_RETRIES) throw err;
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt);
        logger.warn(
          `[${label}] throttled, backing off ${backoff}ms before retry ${attempt + 1}/${MAX_RETRIES}`,
        );
        await sleep(backoff);
        attempt += 1;
      }
    }
  };

  return { pace, callWithRetry };
}
