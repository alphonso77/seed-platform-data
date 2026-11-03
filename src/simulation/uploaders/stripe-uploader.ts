import Stripe from 'stripe';
import {
  EnvironmentCheck,
  PlatformConfig,
  SEEDED_AT_TAG,
  SEEDED_TAG,
  SIMULATION_RUN_ID_TAG,
} from '@/types';
import { DirtyContact, UploadMappingEntry } from '@/simulation/types';
import { checkStripeEnvironment } from '@utils/safety';
import logger from '@utils/logger';
import { BaseUploader, promisePool } from '@/simulation/uploaders/base-uploader';

const STRIPE_CONCURRENCY = 5;

export class StripeUploader extends BaseUploader {
  private stripe: Stripe;

  constructor(config: PlatformConfig) {
    super(config);
    if (!config.apiKey) {
      throw new Error('Stripe API key is required');
    }
    this.stripe = new Stripe(config.apiKey);
  }

  async validateEnvironment(): Promise<EnvironmentCheck> {
    const check = checkStripeEnvironment();
    if (!check.isSandbox) return check;

    try {
      const balance = await this.stripe.balance.retrieve();
      return {
        ...check,
        details: { livemode: balance.livemode },
        isSandbox: !balance.livemode,
        reason: balance.livemode
          ? 'Stripe API returned livemode=true — this is a production account'
          : 'Stripe API confirmed test mode (livemode=false)',
      };
    } catch (error) {
      return {
        platform: 'stripe',
        isSandbox: false,
        reason: `Failed to verify Stripe environment: ${error instanceof Error ? error.message : String(error)}`,
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

    const outcomes = await promisePool(records, STRIPE_CONCURRENCY, async (record) => {
      try {
        const customer = await this.stripe.customers.create(buildCustomerParams(record, runId, seededAt));
        return { ok: true as const, record, externalId: customer.id };
      } catch (error) {
        return {
          ok: false as const,
          record,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });

    for (const outcome of outcomes) {
      if (outcome.ok) {
        mappings.push({
          canonicalId: outcome.record.canonicalId,
          internalId: outcome.record.internalId,
          platform: 'stripe',
          externalId: outcome.externalId,
        });
      } else {
        errors.push(`Stripe customer ${outcome.record.internalId}: ${outcome.message}`);
      }
    }

    logger.info(`[Stripe simulation] Uploaded ${mappings.length}/${records.length} customers`);
    return { mappings, errors };
  }
}

function buildCustomerParams(
  record: DirtyContact,
  runId: string,
  seededAt: string,
): Stripe.CustomerCreateParams {
  const params: Stripe.CustomerCreateParams = {
    metadata: {
      [SEEDED_TAG]: 'true',
      [SEEDED_AT_TAG]: seededAt,
      [SIMULATION_RUN_ID_TAG]: runId,
      ...(record.company ? { company: record.company } : {}),
      ...(record.jobTitle ? { jobTitle: record.jobTitle } : {}),
    },
  };

  const fullName = [record.firstName, record.lastName].filter(Boolean).join(' ').trim();
  if (fullName) params.name = fullName;
  if (record.email) params.email = record.email;
  if (record.phone) params.phone = record.phone;

  if (record.address) {
    const address: Stripe.AddressParam = {};
    if (record.address.street) address.line1 = record.address.street;
    if (record.address.city) address.city = record.address.city;
    if (record.address.state) address.state = record.address.state;
    if (record.address.zip) address.postal_code = record.address.zip;
    if (record.address.country) address.country = record.address.country;
    if (Object.keys(address).length > 0) params.address = address;
  }

  return params;
}
