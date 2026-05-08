import Stripe from 'stripe';
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
import { checkStripeEnvironment, assertSandbox } from '@utils/safety';
import { loadOrGenerateContacts } from '@utils/dataset-cache';
import logger from '@utils/logger';

export class StripeSeeder extends BaseSeeder {
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

  async seed(options: SeedOptions): Promise<SeedResult> {
    const envCheck = await this.validateEnvironment();
    assertSandbox(envCheck);

    const start = Date.now();
    const sizes = DATASET_SIZES[options.size];
    const errors: string[] = [];
    const created = { contacts: 0, products: 0, orders: 0, prices: 0 };
    const seededAt = new Date().toISOString();

    const contacts = await loadOrGenerateContacts(sizes.contacts, options, 'stripe');
    const products = generateProducts(sizes.products);
    const orders = generateOrders(sizes.orders, contacts.length, products.length);

    if (options.dryRun) {
      logger.info('[Stripe] Dry run — would create:', {
        contacts: contacts.length,
        products: products.length,
        orders: orders.length,
      });
      return {
        platform: 'stripe',
        size: options.size,
        created: { contacts: contacts.length, products: products.length, orders: orders.length },
        duration: Date.now() - start,
        errors: [],
      };
    }

    // Create customers
    const customerIds: string[] = [];
    for (const contact of contacts) {
      try {
        const customer = await this.stripe.customers.create({
          email: contact.email,
          name: `${contact.firstName} ${contact.lastName}`,
          phone: contact.phone,
          address: {
            line1: contact.address.street,
            city: contact.address.city,
            state: contact.address.state,
            postal_code: contact.address.zip,
            country: contact.address.country,
          },
          metadata: {
            [SEEDED_TAG]: 'true',
            [SEEDED_AT_TAG]: seededAt,
            company: contact.company,
            jobTitle: contact.jobTitle,
          },
        });
        customerIds.push(customer.id);
        created.contacts++;
      } catch (error) {
        errors.push(`Customer ${contact.email}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Create products + prices
    const priceIds: string[] = [];
    for (const product of products) {
      try {
        const stripeProduct = await this.stripe.products.create({
          name: product.name,
          description: product.description,
          images: product.images,
          metadata: {
            [SEEDED_TAG]: 'true',
            [SEEDED_AT_TAG]: seededAt,
            sku: product.sku,
            category: product.category,
          },
        });
        const price = await this.stripe.prices.create({
          product: stripeProduct.id,
          unit_amount: Math.round(product.price * 100),
          currency: product.currency,
          metadata: {
            [SEEDED_TAG]: 'true',
            [SEEDED_AT_TAG]: seededAt,
          },
        });
        priceIds.push(price.id);
        created.products++;
        created.prices++;
      } catch (error) {
        errors.push(`Product ${product.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Create invoices (representing orders)
    for (const order of orders) {
      try {
        const customerId = customerIds[order.contactIndex];
        if (!customerId) continue;

        const invoice = await this.stripe.invoices.create({
          customer: customerId,
          metadata: {
            [SEEDED_TAG]: 'true',
            [SEEDED_AT_TAG]: seededAt,
          },
          auto_advance: false,
        });

        for (let j = 0; j < order.productIndices.length; j++) {
          const priceId = priceIds[order.productIndices[j]];
          if (!priceId) continue;
          await this.stripe.invoiceItems.create({
            customer: customerId,
            invoice: invoice.id,
            price: priceId,
            quantity: order.quantities[j],
          });
        }

        await this.stripe.invoices.finalizeInvoice(invoice.id);
        created.orders++;
      } catch (error) {
        errors.push(`Order: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    logger.info(`[Stripe] Seeding complete`, created);
    return {
      platform: 'stripe',
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
    const deleted: Record<string, number> = { customers: 0, products: 0, invoices: 0 };

    if (options.dryRun) {
      logger.info('[Stripe] Dry run — scanning for seeded data...');
    }

    // Delete invoices with seeded metadata
    try {
      let hasMore = true;
      let startingAfter: string | undefined;
      while (hasMore) {
        const invoices = await this.stripe.invoices.list({
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        for (const invoice of invoices.data) {
          if (invoice.metadata?.[SEEDED_TAG] !== 'true') continue;

          if (invoice.status === 'paid') {
            logger.warn(
              `[Stripe] Invoice ${invoice.id} is paid — leaving in place; refund manually if needed.`,
            );
            continue;
          }

          if (invoice.status === 'draft') {
            if (!options.dryRun) {
              await this.stripe.invoices.del(invoice.id);
            }
            deleted.invoices++;
          } else if (invoice.status === 'open' || invoice.status === 'uncollectible') {
            if (!options.dryRun) {
              await this.stripe.invoices.voidInvoice(invoice.id);
            }
            deleted.invoices++;
          } else if (invoice.status === 'void') {
            deleted.invoices++;
          }
        }
        hasMore = invoices.has_more;
        if (invoices.data.length > 0) {
          startingAfter = invoices.data[invoices.data.length - 1].id;
        }
      }
    } catch (error) {
      errors.push(`Invoices: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Delete products with seeded metadata
    try {
      let hasMore = true;
      let startingAfter: string | undefined;
      while (hasMore) {
        const products = await this.stripe.products.list({
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        for (const product of products.data) {
          if (product.metadata?.[SEEDED_TAG] === 'true') {
            if (!options.dryRun) {
              await this.stripe.products.update(product.id, { active: false });
            }
            deleted.products++;
          }
        }
        hasMore = products.has_more;
        if (products.data.length > 0) {
          startingAfter = products.data[products.data.length - 1].id;
        }
      }
    } catch (error) {
      errors.push(`Products: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Delete customers with seeded metadata
    try {
      let hasMore = true;
      let startingAfter: string | undefined;
      while (hasMore) {
        const customers = await this.stripe.customers.list({
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        for (const customer of customers.data) {
          if (!customer.deleted && customer.metadata?.[SEEDED_TAG] === 'true') {
            if (!options.dryRun) {
              await this.stripe.customers.del(customer.id);
            }
            deleted.customers++;
          }
        }
        hasMore = customers.has_more;
        if (customers.data.length > 0) {
          startingAfter = customers.data[customers.data.length - 1].id;
        }
      }
    } catch (error) {
      errors.push(`Customers: ${error instanceof Error ? error.message : String(error)}`);
    }

    logger.info(`[Stripe] Clean complete`, deleted);
    return {
      platform: 'stripe',
      deleted,
      duration: Date.now() - start,
      errors,
    };
  }

  async getStatus(): Promise<{ connected: boolean; environment: string }> {
    try {
      const balance = await this.stripe.balance.retrieve();
      return {
        connected: true,
        environment: balance.livemode ? 'live' : 'test',
      };
    } catch {
      return { connected: false, environment: 'unknown' };
    }
  }
}
