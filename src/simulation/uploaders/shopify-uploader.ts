import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import {
  CANONICAL_ID_TAG,
  EnvironmentCheck,
  PlatformConfig,
  SEEDED_AT_TAG,
  SEEDED_TAG,
  SIMULATION_RUN_ID_TAG,
} from '@/types';
import { DirtyContact, UploadMappingEntry } from '@/simulation/types';
import { checkShopifyEnvironment } from '@utils/safety';
import logger from '@utils/logger';
import { createShopifyThrottle } from '@utils/shopify-throttle';
import { BaseUploader, promisePool } from '@/simulation/uploaders/base-uploader';

const SHOPIFY_CONCURRENCY = 2;

export class ShopifyUploader extends BaseUploader {
  private session: Session;
  private shopify: ReturnType<typeof shopifyApi>;

  constructor(config: PlatformConfig) {
    super(config);
    if (!config.accessToken || !config.storeDomain) {
      throw new Error('Shopify access token and store domain are required');
    }

    this.shopify = shopifyApi({
      apiKey: 'placeholder',
      apiSecretKey: 'placeholder',
      scopes: [],
      hostName: config.storeDomain,
      apiVersion: LATEST_API_VERSION,
      isCustomStoreApp: true,
      isEmbeddedApp: false,
      adminApiAccessToken: config.accessToken,
    });

    this.session = this.shopify.session.customAppSession(config.storeDomain);
    this.session.accessToken = config.accessToken;
  }

  async validateEnvironment(): Promise<EnvironmentCheck> {
    const check = checkShopifyEnvironment();
    if (!check.isSandbox) return check;

    try {
      const client = new this.shopify.clients.Rest({ session: this.session });
      const response = await client.get({ path: 'shop' });
      const shop = (response.body as Record<string, Record<string, unknown>>).shop;
      const shopName = (shop.name as string) ?? '';
      const planName = (shop.plan_name as string) ?? '';

      const isDev =
        planName === 'partner_test' ||
        planName === 'affiliate' ||
        shopName.toLowerCase().includes('development');

      return {
        platform: 'shopify',
        isSandbox: isDev,
        reason: isDev
          ? `Shop plan is "${planName}" — confirmed development store`
          : `Shop plan is "${planName}" — only development/partner_test stores are allowed`,
        details: { shopName, planName, domain: shop.domain },
      };
    } catch (error) {
      return {
        platform: 'shopify',
        isSandbox: false,
        reason: `Failed to verify Shopify environment: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async upload(
    records: DirtyContact[],
    runId: string,
  ): Promise<{ mappings: UploadMappingEntry[]; errors: string[] }> {
    const seededAt = new Date().toISOString();
    const errors: string[] = [];
    const mappings: UploadMappingEntry[] = [];
    const client = new this.shopify.clients.Rest({ session: this.session });

    const { callWithRetry } = createShopifyThrottle('Shopify simulation');

    const outcomes = await promisePool(records, SHOPIFY_CONCURRENCY, async (record) => {
      const post = (includePhone: boolean) =>
        callWithRetry(() =>
          client.post({
            path: 'customers',
            data: { customer: buildCustomerBody(record, runId, seededAt, includePhone) },
          }),
        );

      try {
        const response = await post(true);
        const body = response.body as Record<string, Record<string, unknown>>;
        return { ok: true as const, record, externalId: String(body.customer.id), retried: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isPhoneInvalidError(message) && record.email) {
          try {
            const response = await post(false);
            const body = response.body as Record<string, Record<string, unknown>>;
            return { ok: true as const, record, externalId: String(body.customer.id), retried: true };
          } catch (retryError) {
            return {
              ok: false as const,
              record,
              message: retryError instanceof Error ? retryError.message : String(retryError),
            };
          }
        }
        return { ok: false as const, record, message };
      }
    });

    let phoneRetries = 0;
    for (const outcome of outcomes) {
      if (outcome.ok) {
        if (outcome.retried) phoneRetries++;
        mappings.push({
          canonicalId: outcome.record.canonicalId,
          internalId: outcome.record.internalId,
          platform: 'shopify',
          externalId: outcome.externalId,
        });
      } else {
        errors.push(`Shopify customer ${outcome.record.internalId}: ${outcome.message}`);
      }
    }

    logger.info(`[Shopify simulation] Uploaded ${mappings.length}/${records.length} customers`);
    if (phoneRetries > 0) {
      logger.info(`[Shopify simulation] ${phoneRetries}/${records.length} customers had phone rejected, retried without phone`);
    }
    return { mappings, errors };
  }
}

function isPhoneInvalidError(message: string): boolean {
  return /"phone"\s*:\s*\[\s*"is invalid"/.test(message);
}

function buildCustomerBody(
  record: DirtyContact,
  runId: string,
  seededAt: string,
  includePhone = true,
): Record<string, unknown> {
  const tags = [
    SEEDED_TAG,
    `${SEEDED_AT_TAG}:${seededAt}`,
    `${SIMULATION_RUN_ID_TAG}:${runId}`,
    `${CANONICAL_ID_TAG}:${record.canonicalId}`,
  ].join(',');

  const customer: Record<string, unknown> = {
    tags,
    note: `Simulation run ${runId} — ${seededAt}`,
  };

  if (record.firstName) customer.first_name = record.firstName;
  if (record.lastName) customer.last_name = record.lastName;
  if (record.email) customer.email = record.email;

  if (includePhone) {
    const phone = normalizeToE164(record.phone);
    if (phone) customer.phone = phone;
  }

  if (record.address) {
    const address: Record<string, unknown> = {};
    if (record.address.street) address.address1 = record.address.street;
    if (record.address.city) address.city = record.address.city;
    if (record.address.state) address.province = record.address.state;
    if (record.address.zip) address.zip = record.address.zip;
    if (record.address.country) address.country = record.address.country;
    if (record.firstName) address.first_name = record.firstName;
    if (record.lastName) address.last_name = record.lastName;
    if (Object.keys(address).length > 0) customer.addresses = [address];
  }

  return customer;
}

/**
 * Convert a faker-generated US phone (e.g. "(708) 397-0264", "+16008014209")
 * to E.164 (e.g. "+17083970264"). Returns null when the input has no digits
 * or doesn't look like a valid US/international phone — Shopify rejects malformed numbers.
 */
export function normalizeToE164(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '');
    return digits.length >= 8 ? `+${digits}` : null;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
