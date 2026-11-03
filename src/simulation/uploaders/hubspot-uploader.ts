import { Client } from '@hubspot/api-client';
import {
  EnvironmentCheck,
  PlatformConfig,
  SEEDED_AT_TAG,
  SEEDED_TAG,
  SIMULATION_RUN_ID_TAG,
} from '@/types';
import { DirtyContact, UploadMappingEntry } from '@/simulation/types';
import { checkHubSpotEnvironment } from '@utils/safety';
import logger from '@utils/logger';
import { BaseUploader, promisePool } from '@/simulation/uploaders/base-uploader';

// One contact per request, a few at a time (HubSpot allows 100 requests per
// 10 s). The batch API doesn't promise to answer in input order, and matching
// its results back would need a per-record tag, which FratelliSoftware copies
// into the Data Lake (FS-361).
const HUBSPOT_CONCURRENCY = 4;

interface ContactInput {
  properties: Record<string, string>;
  associations: never[];
}

export class HubSpotUploader extends BaseUploader {
  private client: Client;

  constructor(config: PlatformConfig) {
    super(config);
    if (!config.accessToken) {
      throw new Error('HubSpot access token is required');
    }
    this.client = new Client({ accessToken: config.accessToken });
  }

  async validateEnvironment(): Promise<EnvironmentCheck> {
    const check = checkHubSpotEnvironment();
    if (!check.isSandbox) return check;

    try {
      const response = await this.client.apiRequest({
        method: 'GET',
        path: '/account-info/v3/details',
      });
      const body = (await response.json()) as Record<string, unknown>;
      const accountType = body.accountType as string | undefined;
      const isSandbox = accountType === 'DEVELOPER_TEST' || accountType === 'SANDBOX';
      return {
        platform: 'hubspot',
        isSandbox,
        reason: isSandbox
          ? `Account type is ${accountType} — confirmed sandbox environment`
          : `Account type is ${accountType ?? 'unknown'} — only DEVELOPER_TEST or SANDBOX accounts are allowed`,
        details: { accountType, portalId: body.portalId },
      };
    } catch (error) {
      return {
        platform: 'hubspot',
        isSandbox: false,
        reason: `Failed to verify HubSpot environment: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async ensureCustomProperties(): Promise<void> {
    const propertyDefs = [
      { name: SEEDED_TAG, label: 'Seed Platform Seeded', type: 'string', fieldType: 'text' },
      { name: SEEDED_AT_TAG, label: 'Seed Platform Seeded At', type: 'string', fieldType: 'text' },
      { name: SIMULATION_RUN_ID_TAG, label: 'Simulation Run ID', type: 'string', fieldType: 'text' },
    ];

    for (const prop of propertyDefs) {
      const getResponse = await this.client.apiRequest({
        method: 'GET',
        path: `/crm/v3/properties/contacts/${prop.name}`,
      });
      if (getResponse.ok) continue;

      logger.info(`[HubSpot simulation] Creating custom property "${prop.name}" on contacts...`);
      const createResponse = await this.client.apiRequest({
        method: 'POST',
        path: '/crm/v3/properties/contacts',
        body: { ...prop, groupName: 'contactinformation' },
      });
      if (!createResponse.ok) {
        const body = await createResponse.text();
        throw new Error(
          `Cannot create required property "${prop.name}" on contacts: ${createResponse.status} ${body}`,
        );
      }
    }
  }

  async upload(
    records: DirtyContact[],
    runId: string,
  ): Promise<{ mappings: UploadMappingEntry[]; errors: string[] }> {
    await this.ensureCustomProperties();

    const seededAt = new Date().toISOString();
    const errors: string[] = [];
    const mappings: UploadMappingEntry[] = [];

    let created = 0;
    const outcomes = await promisePool(records, HUBSPOT_CONCURRENCY, async (record) => {
      try {
        const result = await this.client.crm.contacts.basicApi.create(buildContactInput(record, runId, seededAt));
        created++;
        if (created % 100 === 0) logger.info(`[HubSpot simulation] contacts: ${created}/${records.length} created`);
        return { ok: true as const, record, externalId: result.id };
      } catch (error) {
        return { ok: false as const, record, message: error instanceof Error ? error.message : String(error) };
      }
    });

    for (const outcome of outcomes) {
      if (outcome.ok) {
        mappings.push({
          canonicalId: outcome.record.canonicalId,
          internalId: outcome.record.internalId,
          platform: 'hubspot',
          externalId: outcome.externalId,
        });
      } else {
        errors.push(`HubSpot contact ${outcome.record.internalId}: ${outcome.message}`);
      }
    }
    logger.info(`[HubSpot simulation] contacts: ${mappings.length}/${records.length} created`);

    return { mappings, errors };
  }
}

function buildContactInput(record: DirtyContact, runId: string, seededAt: string): ContactInput {
  const properties: Record<string, string> = {
    [SEEDED_TAG]: 'true',
    [SEEDED_AT_TAG]: seededAt,
    [SIMULATION_RUN_ID_TAG]: runId,
  };
  if (record.firstName) properties.firstname = record.firstName;
  if (record.lastName) properties.lastname = record.lastName;
  if (record.email) properties.email = record.email;
  if (record.phone) properties.phone = record.phone;
  if (record.company) properties.company = record.company;
  if (record.jobTitle) properties.jobtitle = record.jobTitle;
  if (record.address) {
    if (record.address.street) properties.address = record.address.street;
    if (record.address.city) properties.city = record.address.city;
    if (record.address.state) properties.state = record.address.state;
    if (record.address.zip) properties.zip = record.address.zip;
    if (record.address.country) properties.country = record.address.country;
  }
  return { properties, associations: [] };
}
