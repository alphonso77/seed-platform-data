import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
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
import { checkShopifyEnvironment, assertSandbox } from '@utils/safety';
import { loadOrGenerateContacts } from '@utils/dataset-cache';
import logger from '@utils/logger';

export class ShopifySeeder extends BaseSeeder {
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

  async seed(options: SeedOptions): Promise<SeedResult> {
    const envCheck = await this.validateEnvironment();
    assertSandbox(envCheck);

    const start = Date.now();
    const sizes = DATASET_SIZES[options.size];
    const errors: string[] = [];
    const created = { contacts: 0, products: 0, orders: 0 };
    const seededAt = new Date().toISOString();

    const contacts = await loadOrGenerateContacts(sizes.contacts, options, 'shopify');
    const products = generateProducts(sizes.products);
    const orders = generateOrders(sizes.orders, contacts.length, products.length);

    if (options.dryRun) {
      logger.info('[Shopify] Dry run — would create:', {
        contacts: contacts.length,
        products: products.length,
        orders: orders.length,
      });
      return {
        platform: 'shopify',
        size: options.size,
        created: { contacts: contacts.length, products: products.length, orders: orders.length },
        duration: Date.now() - start,
        errors: [],
      };
    }

    const client = new this.shopify.clients.Rest({ session: this.session });

    // Create customers
    const customerIds: number[] = [];
    for (const contact of contacts) {
      try {
        const response = await client.post({
          path: 'customers',
          data: {
            customer: {
              first_name: contact.firstName,
              last_name: contact.lastName,
              email: contact.email,
              phone: contact.phone,
              addresses: [
                {
                  address1: contact.address.street,
                  city: contact.address.city,
                  province: contact.address.state,
                  zip: contact.address.zip,
                  country: contact.address.country,
                  first_name: contact.firstName,
                  last_name: contact.lastName,
                },
              ],
              tags: `${SEEDED_TAG},${SEEDED_AT_TAG}:${seededAt}`,
              note: `Seeded test data — ${seededAt}`,
            },
          },
        });
        const customer = (response.body as Record<string, Record<string, unknown>>).customer;
        customerIds.push(customer.id as number);
        created.contacts++;
      } catch (error) {
        errors.push(`Customer ${contact.email}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Create products
    const variantIds: number[] = [];
    for (const product of products) {
      try {
        const response = await client.post({
          path: 'products',
          data: {
            product: {
              title: product.name,
              body_html: `<p>${product.description}</p>`,
              vendor: 'Seed Platform Data',
              product_type: product.category,
              tags: `${SEEDED_TAG},${SEEDED_AT_TAG}:${seededAt}`,
              variants: [
                {
                  price: product.price.toFixed(2),
                  sku: product.sku,
                  inventory_management: null,
                },
              ],
            },
          },
        });
        const shopifyProduct = (response.body as Record<string, Record<string, unknown>>).product;
        const variants = shopifyProduct.variants as Array<Record<string, unknown>>;
        if (variants?.[0]) {
          variantIds.push(variants[0].id as number);
        }
        created.products++;
      } catch (error) {
        errors.push(`Product ${product.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Create draft orders
    for (const order of orders) {
      try {
        const customerId = customerIds[order.contactIndex];
        if (!customerId) continue;

        const lineItems = order.productIndices
          .map((pIdx, j) => {
            const variantId = variantIds[pIdx];
            if (!variantId) return null;
            return { variant_id: variantId, quantity: order.quantities[j] };
          })
          .filter(Boolean);

        if (lineItems.length === 0) continue;

        await client.post({
          path: 'draft_orders',
          data: {
            draft_order: {
              line_items: lineItems,
              customer: { id: customerId },
              note: `Seeded test data — ${seededAt}`,
              tags: `${SEEDED_TAG},${SEEDED_AT_TAG}:${seededAt}`,
            },
          },
        });
        created.orders++;
      } catch (error) {
        errors.push(`Order: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    logger.info(`[Shopify] Seeding complete`, created);
    return {
      platform: 'shopify',
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
    const deleted: Record<string, number> = { customers: 0, products: 0, draft_orders: 0 };

    if (options.dryRun) {
      logger.info('[Shopify] Dry run — scanning for seeded data...');
    }

    const client = new this.shopify.clients.Rest({ session: this.session });

    // Delete seeded draft orders
    try {
      let pageInfo: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const params: Record<string, string | number> = { limit: 250 };
        if (pageInfo) params.page_info = pageInfo;

        const response = await client.get({ path: 'draft_orders', query: params });
        const draftOrders = (response.body as Record<string, unknown[]>).draft_orders ?? [];

        for (const draftOrder of draftOrders) {
          const order = draftOrder as Record<string, unknown>;
          const tags = (order.tags as string) ?? '';
          if (tags.includes(SEEDED_TAG)) {
            if (!options.dryRun) {
              await client.delete({ path: `draft_orders/${order.id}` });
            }
            deleted.draft_orders++;
          }
        }

        const headers = response.headers as Record<string, string | string[]> | undefined;
        const link = (typeof headers?.link === 'string' ? headers.link : '') ?? '';
        const nextMatch = link.match(/page_info=([^>&]*)/);
        hasMore = !!nextMatch && draftOrders.length === 250;
        pageInfo = nextMatch?.[1];
      }
    } catch (error) {
      errors.push(`Draft orders: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Delete seeded products
    try {
      let pageInfo: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const params: Record<string, string | number> = { limit: 250 };
        if (pageInfo) params.page_info = pageInfo;

        const response = await client.get({ path: 'products', query: params });
        const shopifyProducts = (response.body as Record<string, unknown[]>).products ?? [];

        for (const product of shopifyProducts) {
          const p = product as Record<string, unknown>;
          const tags = (p.tags as string) ?? '';
          if (tags.includes(SEEDED_TAG)) {
            if (!options.dryRun) {
              await client.delete({ path: `products/${p.id}` });
            }
            deleted.products++;
          }
        }

        const headers = response.headers as Record<string, string | string[]> | undefined;
        const link = (typeof headers?.link === 'string' ? headers.link : '') ?? '';
        const nextMatch = link.match(/page_info=([^>&]*)/);
        hasMore = !!nextMatch && shopifyProducts.length === 250;
        pageInfo = nextMatch?.[1];
      }
    } catch (error) {
      errors.push(`Products: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Delete seeded customers
    try {
      let pageInfo: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const params: Record<string, string | number> = { limit: 250 };
        if (pageInfo) params.page_info = pageInfo;

        const response = await client.get({ path: 'customers', query: params });
        const customers = (response.body as Record<string, unknown[]>).customers ?? [];

        for (const customer of customers) {
          const c = customer as Record<string, unknown>;
          const tags = (c.tags as string) ?? '';
          if (tags.includes(SEEDED_TAG)) {
            if (!options.dryRun) {
              await client.delete({ path: `customers/${c.id}` });
            }
            deleted.customers++;
          }
        }

        const headers = response.headers as Record<string, string | string[]> | undefined;
        const link = (typeof headers?.link === 'string' ? headers.link : '') ?? '';
        const nextMatch = link.match(/page_info=([^>&]*)/);
        hasMore = !!nextMatch && customers.length === 250;
        pageInfo = nextMatch?.[1];
      }
    } catch (error) {
      errors.push(`Customers: ${error instanceof Error ? error.message : String(error)}`);
    }

    logger.info(`[Shopify] Clean complete`, deleted);
    return {
      platform: 'shopify',
      deleted,
      duration: Date.now() - start,
      errors,
    };
  }

  async getStatus(): Promise<{ connected: boolean; environment: string }> {
    try {
      const client = new this.shopify.clients.Rest({ session: this.session });
      const response = await client.get({ path: 'shop' });
      const shop = (response.body as Record<string, Record<string, unknown>>).shop;
      return {
        connected: true,
        environment: (shop.plan_name as string) ?? 'unknown',
      };
    } catch {
      return { connected: false, environment: 'unknown' };
    }
  }
}
