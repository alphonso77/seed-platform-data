import { Client } from '@hubspot/api-client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/contacts/models/Filter';
import { BaseSeeder } from '@seeders/base-seeder';
import {
  PlatformConfig,
  SeedOptions,
  SeedResult,
  CleanOptions,
  CleanResult,
  EnvironmentCheck,
  SEEDED_TAG,
  SEEDED_AT_TAG,
} from '@/types';
import { DATASET_SIZES } from '@config/datasets';
import { generateProducts } from '@generators/products';
import { generateOrders } from '@generators/orders';
import { checkHubSpotEnvironment, assertSandbox } from '@utils/safety';
import { loadOrGenerateContacts } from '@utils/dataset-cache';
import logger from '@utils/logger';

export class HubSpotSeeder extends BaseSeeder {
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
      const body = await response.json() as Record<string, unknown>;
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

  private async propertyExists(objectType: string, propertyName: string): Promise<boolean> {
    const response = await this.client.apiRequest({
      method: 'GET',
      path: `/crm/v3/properties/${objectType}/${propertyName}`,
    });
    return response.ok;
  }

  private async ensureCustomProperties(): Promise<void> {
    const objectTypes: { type: string; groupName: string }[] = [
      { type: 'contacts', groupName: 'contactinformation' },
      { type: 'companies', groupName: 'companyinformation' },
      { type: 'deals', groupName: 'dealinformation' },
    ];
    const propertyDefs = [
      { name: SEEDED_TAG, label: 'Seed Platform Seeded', type: 'string', fieldType: 'text' },
      { name: SEEDED_AT_TAG, label: 'Seed Platform Seeded At', type: 'string', fieldType: 'text' },
    ];

    for (const obj of objectTypes) {
      for (const prop of propertyDefs) {
        // Check if property exists
        const getResponse = await this.client.apiRequest({
          method: 'GET',
          path: `/crm/v3/properties/${obj.type}/${prop.name}`,
        });

        if (getResponse.ok) {
          logger.debug(`[HubSpot] Property "${prop.name}" already exists on ${obj.type}`);
          continue;
        }

        // Property doesn't exist — create it
        logger.info(`[HubSpot] Creating custom property "${prop.name}" on ${obj.type}...`);
        const createResponse = await this.client.apiRequest({
          method: 'POST',
          path: `/crm/v3/properties/${obj.type}`,
          body: { ...prop, groupName: obj.groupName },
        });

        if (!createResponse.ok) {
          const body = await createResponse.text();
          logger.error(`[HubSpot] Failed to create property "${prop.name}" on ${obj.type}: ${createResponse.status} ${body}`);
          throw new Error(`Cannot create required property "${prop.name}" on ${obj.type}: ${createResponse.status} ${body}`);
        }

        logger.info(`[HubSpot] Created custom property "${prop.name}" on ${obj.type}`);
      }
    }
  }

  async seed(options: SeedOptions): Promise<SeedResult> {
    const envCheck = await this.validateEnvironment();
    assertSandbox(envCheck);

    await this.ensureCustomProperties();

    const start = Date.now();
    const sizes = DATASET_SIZES[options.size];
    const errors: string[] = [];
    const created = { contacts: 0, products: 0, orders: 0, companies: 0 };
    const seededAt = new Date().toISOString();
    const BATCH_SIZE = 100;

    const contacts = await loadOrGenerateContacts(sizes.contacts, options, 'hubspot');
    const products = generateProducts(sizes.products);
    const orders = generateOrders(sizes.orders, contacts.length, products.length);

    if (options.dryRun) {
      logger.info('[HubSpot] Dry run — would create:', {
        contacts: contacts.length,
        products: products.length,
        orders: orders.length,
      });
      return {
        platform: 'hubspot',
        size: options.size,
        created: { contacts: contacts.length, products: products.length, orders: orders.length },
        duration: Date.now() - start,
        errors: [],
      };
    }

    // contactIds / companyIds are tracked for future seed-time association support — currently unused.
    // TODO: wire associations once seed-time deal↔contact↔company linking is needed.
    const contactIds: string[] = [];
    const contactInputs = contacts.map((contact) => ({
      properties: {
        firstname: contact.firstName,
        lastname: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        company: contact.company,
        jobtitle: contact.jobTitle,
        address: contact.address.street,
        city: contact.address.city,
        state: contact.address.state,
        zip: contact.address.zip,
        country: contact.address.country,
        [SEEDED_TAG]: 'true',
        [SEEDED_AT_TAG]: seededAt,
      },
      associations: [],
    }));
    for (let i = 0; i < contactInputs.length; i += BATCH_SIZE) {
      const batch = contactInputs.slice(i, i + BATCH_SIZE);
      try {
        const response = await this.client.crm.contacts.batchApi.create({ inputs: batch });
        for (const obj of response.results) contactIds.push(obj.id);
        created.contacts += response.results.length;
      } catch (batchError) {
        logger.warn(
          `[HubSpot] contacts batch create failed at offset ${i}, falling back to per-record: ${batchError instanceof Error ? batchError.message : String(batchError)}`,
        );
        for (let j = 0; j < batch.length; j++) {
          try {
            const result = await this.client.crm.contacts.basicApi.create(batch[j]);
            contactIds.push(result.id);
            created.contacts++;
          } catch (error) {
            const contact = contacts[i + j];
            errors.push(`Contact ${contact.email}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      logger.info(`[HubSpot] contacts: ${created.contacts}/${contactInputs.length} created`);
    }

    // Create companies (derive unique companies from contacts)
    const uniqueCompanies = [...new Set(contacts.map((c) => c.company))];
    const companyIds: Map<string, string> = new Map();
    const companyInputs = uniqueCompanies.map((companyName) => ({
      properties: {
        name: companyName,
        [SEEDED_TAG]: 'true',
        [SEEDED_AT_TAG]: seededAt,
      },
      associations: [],
    }));
    for (let i = 0; i < companyInputs.length; i += BATCH_SIZE) {
      const batch = companyInputs.slice(i, i + BATCH_SIZE);
      const namesInBatch = uniqueCompanies.slice(i, i + BATCH_SIZE);
      try {
        const response = await this.client.crm.companies.batchApi.create({ inputs: batch });
        // HubSpot batch responses are NOT guaranteed to preserve input order — match by
        // the `name` property echoed back in each result.
        for (const result of response.results) {
          const name = result.properties?.name;
          if (name) companyIds.set(name, result.id);
        }
        created.companies += response.results.length;
      } catch (batchError) {
        logger.warn(
          `[HubSpot] companies batch create failed at offset ${i}, falling back to per-record: ${batchError instanceof Error ? batchError.message : String(batchError)}`,
        );
        for (let j = 0; j < batch.length; j++) {
          try {
            const result = await this.client.crm.companies.basicApi.create(batch[j]);
            companyIds.set(namesInBatch[j], result.id);
            created.companies++;
          } catch (error) {
            errors.push(`Company ${namesInBatch[j]}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      logger.info(`[HubSpot] companies: ${created.companies}/${companyInputs.length} created`);
    }

    // Create deals (representing orders)
    const dealInputs = orders.map((order) => {
      const contact = contacts[order.contactIndex];
      const totalAmount = order.productIndices.reduce((sum, pIdx, j) => {
        return sum + products[pIdx].price * order.quantities[j];
      }, 0);
      return {
        properties: {
          dealname: `Seed Order - ${contact.firstName} ${contact.lastName}`,
          amount: totalAmount.toFixed(2),
          dealstage: order.status === 'completed' ? 'closedwon' : 'appointmentscheduled',
          pipeline: 'default',
          closedate: order.createdAt.toISOString(),
          [SEEDED_TAG]: 'true',
          [SEEDED_AT_TAG]: seededAt,
        },
        associations: [],
      };
    });
    for (let i = 0; i < dealInputs.length; i += BATCH_SIZE) {
      const batch = dealInputs.slice(i, i + BATCH_SIZE);
      try {
        const response = await this.client.crm.deals.batchApi.create({ inputs: batch });
        created.orders += response.results.length;
      } catch (batchError) {
        logger.warn(
          `[HubSpot] deals batch create failed at offset ${i}, falling back to per-record: ${batchError instanceof Error ? batchError.message : String(batchError)}`,
        );
        for (let j = 0; j < batch.length; j++) {
          try {
            await this.client.crm.deals.basicApi.create(batch[j]);
            created.orders++;
          } catch (error) {
            errors.push(`Deal: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      logger.info(`[HubSpot] deals: ${created.orders}/${dealInputs.length} created`);
    }

    logger.info(`[HubSpot] Seeding complete`, created);
    return {
      platform: 'hubspot',
      size: options.size,
      created,
      duration: Date.now() - start,
      errors,
    };
  }

  async clean(options: CleanOptions): Promise<CleanResult> {
    const envCheck = await this.validateEnvironment();
    assertSandbox(envCheck);

    const start = Date.now();
    const errors: string[] = [];
    const deleted: Record<string, number> = { contacts: 0, companies: 0, deals: 0 };

    if (options.dryRun) {
      logger.info('[HubSpot] Dry run — scanning for seeded data...');
    }

    // Search and delete seeded deals
    if (!(await this.propertyExists('deals', SEEDED_TAG))) {
      logger.warn(
        `[HubSpot] Property "${SEEDED_TAG}" missing on deals — skipping tagged-record search. Run a seed first to recreate the property, or use --orphans for deals.`,
      );
    } else {
      try {
        let after: string | undefined;
        let hasMore = true;
        while (hasMore) {
          const response = await this.client.crm.deals.searchApi.doSearch({
            filterGroups: [
              {
                filters: [
                  { propertyName: SEEDED_TAG, operator: FilterOperatorEnum.Eq, value: 'true' },
                ],
              },
            ],
            sorts: [],
            properties: [],
            limit: 100,
            after: after ?? '0',
          });
          const ids = response.results.map((d) => d.id);
          if (ids.length > 0 && !options.dryRun) {
            await this.client.crm.deals.batchApi.archive({ inputs: ids.map((id) => ({ id })) });
          }
          deleted.deals += ids.length;
          logger.info(`[HubSpot] deals: ${deleted.deals} archived`);
          hasMore = !!response.paging?.next;
          after = response.paging?.next?.after;
        }
      } catch (error) {
        errors.push(`Deals: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Search and delete seeded companies
    if (!(await this.propertyExists('companies', SEEDED_TAG))) {
      logger.warn(
        `[HubSpot] Property "${SEEDED_TAG}" missing on companies — skipping tagged-record search. Run a seed first to recreate the property, or use --orphans for deals.`,
      );
    } else {
      try {
        let after: string | undefined;
        let hasMore = true;
        while (hasMore) {
          const response = await this.client.crm.companies.searchApi.doSearch({
            filterGroups: [
              {
                filters: [
                  { propertyName: SEEDED_TAG, operator: FilterOperatorEnum.Eq, value: 'true' },
                ],
              },
            ],
            sorts: [],
            properties: [],
            limit: 100,
            after: after ?? '0',
          });
          const ids = response.results.map((c) => c.id);
          if (ids.length > 0 && !options.dryRun) {
            await this.client.crm.companies.batchApi.archive({ inputs: ids.map((id) => ({ id })) });
          }
          deleted.companies += ids.length;
          logger.info(`[HubSpot] companies: ${deleted.companies} archived`);
          hasMore = !!response.paging?.next;
          after = response.paging?.next?.after;
        }
      } catch (error) {
        errors.push(`Companies: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Search and delete seeded contacts
    if (!(await this.propertyExists('contacts', SEEDED_TAG))) {
      logger.warn(
        `[HubSpot] Property "${SEEDED_TAG}" missing on contacts — skipping tagged-record search. Run a seed first to recreate the property, or use --orphans for deals.`,
      );
    } else {
      try {
        let after: string | undefined;
        let hasMore = true;
        while (hasMore) {
          const response = await this.client.crm.contacts.searchApi.doSearch({
            filterGroups: [
              {
                filters: [
                  { propertyName: SEEDED_TAG, operator: FilterOperatorEnum.Eq, value: 'true' },
                ],
              },
            ],
            sorts: [],
            properties: [],
            limit: 100,
            after: after ?? '0',
          });
          const ids = response.results.map((c) => c.id);
          if (ids.length > 0 && !options.dryRun) {
            await this.client.crm.contacts.batchApi.archive({ inputs: ids.map((id) => ({ id })) });
          }
          deleted.contacts += ids.length;
          logger.info(`[HubSpot] contacts: ${deleted.contacts} archived`);
          hasMore = !!response.paging?.next;
          after = response.paging?.next?.after;
        }
      } catch (error) {
        errors.push(`Contacts: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (options.orphans) {
      logger.warn('[HubSpot] Orphan recovery is deals-only — contacts and companies have no reliable name-based signal');
      try {
        let after: string | undefined;
        let hasMore = true;
        while (hasMore) {
          const response = await this.client.crm.deals.searchApi.doSearch({
            filterGroups: [
              {
                filters: [
                  { propertyName: 'dealname', operator: FilterOperatorEnum.ContainsToken, value: 'Seed Order' },
                ],
              },
            ],
            sorts: [],
            properties: [],
            limit: 100,
            after: after ?? '0',
          });
          const ids = response.results.map((d) => d.id);
          if (ids.length > 0 && !options.dryRun) {
            await this.client.crm.deals.batchApi.archive({ inputs: ids.map((id) => ({ id })) });
          }
          deleted.deals += ids.length;
          logger.info(`[HubSpot] orphan deals: ${deleted.deals} archived (running total)`);
          hasMore = !!response.paging?.next;
          after = response.paging?.next?.after;
        }
      } catch (error) {
        errors.push(`Orphan deals: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    logger.info(`[HubSpot] Clean complete`, deleted);
    return {
      platform: 'hubspot',
      deleted,
      duration: Date.now() - start,
      errors,
    };
  }

  async getStatus(): Promise<{ connected: boolean; environment: string }> {
    try {
      const response = await this.client.apiRequest({
        method: 'GET',
        path: '/account-info/v3/details',
      });
      const body = await response.json() as Record<string, unknown>;
      return {
        connected: true,
        environment: (body.accountType as string) ?? 'unknown',
      };
    } catch {
      return { connected: false, environment: 'unknown' };
    }
  }
}
