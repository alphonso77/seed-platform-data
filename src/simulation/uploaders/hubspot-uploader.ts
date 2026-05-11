import { Client } from '@hubspot/api-client';
import {
  CANONICAL_ID_TAG,
  EnvironmentCheck,
  PlatformConfig,
  SEEDED_AT_TAG,
  SEEDED_TAG,
  SIMULATION_INTERNAL_ID_TAG,
  SIMULATION_RUN_ID_TAG,
} from '@/types';
import { DirtyContact, UploadMappingEntry } from '@/simulation/types';
import { checkHubSpotEnvironment } from '@utils/safety';
import logger from '@utils/logger';
import { BaseUploader } from '@/simulation/uploaders/base-uploader';

const BATCH_SIZE = 100;

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
      { name: CANONICAL_ID_TAG, label: 'Canonical ID', type: 'string', fieldType: 'text' },
      { name: SIMULATION_INTERNAL_ID_TAG, label: 'Simulation Internal ID', type: 'string', fieldType: 'text' },
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

    const inputs = records.map((record) => ({
      record,
      input: buildContactInput(record, runId, seededAt),
    }));

    for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
      const slice = inputs.slice(i, i + BATCH_SIZE);
      // Index slice inputs by internalId so we can match each response back
      // unambiguously — HubSpot's batch create response is NOT guaranteed to
      // preserve input order.
      const sliceByInternalId = new Map(slice.map((s) => [s.record.internalId, s.record]));
      try {
        const response = await this.client.crm.contacts.batchApi.create({
          inputs: slice.map((s) => s.input),
        });
        for (const result of response.results) {
          const internalId = result.properties?.[SIMULATION_INTERNAL_ID_TAG];
          const record = internalId ? sliceByInternalId.get(internalId) : undefined;
          if (!record) {
            errors.push(
              `HubSpot contact (externalId ${result.id}): batch response missing or unmatched ${SIMULATION_INTERNAL_ID_TAG} — cannot map back to canonical`,
            );
            continue;
          }
          mappings.push({
            canonicalId: record.canonicalId,
            internalId: record.internalId,
            platform: 'hubspot',
            externalId: result.id,
          });
        }
      } catch (batchError) {
        logger.warn(
          `[HubSpot simulation] batch create failed at offset ${i}, falling back to per-record: ${batchError instanceof Error ? batchError.message : String(batchError)}`,
        );
        for (const { record, input } of slice) {
          try {
            const result = await this.client.crm.contacts.basicApi.create(input);
            mappings.push({
              canonicalId: record.canonicalId,
              internalId: record.internalId,
              platform: 'hubspot',
              externalId: result.id,
            });
          } catch (error) {
            errors.push(
              `HubSpot contact ${record.internalId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      logger.info(
        `[HubSpot simulation] contacts: ${mappings.length}/${inputs.length} created`,
      );
    }

    return { mappings, errors };
  }
}

function buildContactInput(record: DirtyContact, runId: string, seededAt: string): ContactInput {
  const properties: Record<string, string> = {
    [SEEDED_TAG]: 'true',
    [SEEDED_AT_TAG]: seededAt,
    [SIMULATION_RUN_ID_TAG]: runId,
    [CANONICAL_ID_TAG]: record.canonicalId,
    [SIMULATION_INTERNAL_ID_TAG]: record.internalId,
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
