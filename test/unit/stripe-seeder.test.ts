import { expect } from 'chai';
import sinon from 'sinon';
import { StripeSeeder } from '../../src/seeders/stripe-seeder';
import { resetEnv } from '../../src/config/env';

describe('StripeSeeder', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnv();
    sinon.restore();
  });

  it('should throw if no API key provided', () => {
    expect(() => new StripeSeeder({ platform: 'stripe' })).to.throw('API key is required');
  });

  it('should create a seeder with a valid config', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
    const seeder = new StripeSeeder({ platform: 'stripe', apiKey: 'sk_test_abc123' });
    expect(seeder).to.be.instanceOf(StripeSeeder);
  });

  describe('validateEnvironment', () => {
    it('should reject live keys before making API calls', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_live_abc123';
      const seeder = new StripeSeeder({ platform: 'stripe', apiKey: 'sk_live_abc123' });
      const result = await seeder.validateEnvironment();
      expect(result.isSandbox).to.be.false;
      expect(result.reason).to.include('sk_live_');
    });
  });

  describe('seed (dry run)', () => {
    it('should return counts without creating data', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
      const seeder = new StripeSeeder({ platform: 'stripe', apiKey: 'sk_test_abc123' });

      // Stub validateEnvironment to skip API call
      sinon.stub(seeder, 'validateEnvironment').resolves({
        platform: 'stripe',
        isSandbox: true,
        reason: 'test',
      });

      const result = await seeder.seed({
        size: 'small',
        emailDomains: [],
        useRandomDomains: true,
        dryRun: true,
      });

      expect(result.platform).to.equal('stripe');
      expect(result.size).to.equal('small');
      expect(result.created.contacts).to.equal(25);
      expect(result.created.products).to.equal(5);
      expect(result.created.orders).to.equal(10);
      expect(result.errors).to.have.lengthOf(0);
    });
  });

  describe('clean', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function makeSeeder(): { seeder: StripeSeeder; stripe: any } {
      process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
      const seeder = new StripeSeeder({ platform: 'stripe', apiKey: 'sk_test_abc123' });
      sinon.stub(seeder, 'validateEnvironment').resolves({
        platform: 'stripe',
        isSandbox: true,
        reason: 'test',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stripe = (seeder as any).stripe;
      // Empty pages for the lists we don't care about in a given test.
      sinon.stub(stripe.products, 'list').resolves({ data: [], has_more: false });
      sinon.stub(stripe.customers, 'list').resolves({ data: [], has_more: false });
      return { seeder, stripe };
    }

    function seededInvoice(id: string, status: string): {
      id: string;
      status: string;
      metadata: Record<string, string>;
    } {
      return { id, status, metadata: { seed_platform_seeded: 'true' } };
    }

    it('voids open seeded invoices and does not call del', async () => {
      const { seeder, stripe } = makeSeeder();
      sinon.stub(stripe.invoices, 'list').resolves({
        data: [seededInvoice('inv_open', 'open')],
        has_more: false,
      });
      const voidInvoice = sinon.stub(stripe.invoices, 'voidInvoice').resolves();
      const del = sinon.stub(stripe.invoices, 'del').resolves();

      const result = await seeder.clean({ platform: 'stripe' });

      expect(voidInvoice.calledOnceWith('inv_open')).to.be.true;
      expect(del.called).to.be.false;
      expect(result.deleted.invoices).to.equal(1);
      expect(result.errors).to.have.lengthOf(0);
    });

    it('deletes draft seeded invoices', async () => {
      const { seeder, stripe } = makeSeeder();
      sinon.stub(stripe.invoices, 'list').resolves({
        data: [seededInvoice('inv_draft', 'draft')],
        has_more: false,
      });
      const voidInvoice = sinon.stub(stripe.invoices, 'voidInvoice').resolves();
      const del = sinon.stub(stripe.invoices, 'del').resolves();

      const result = await seeder.clean({ platform: 'stripe' });

      expect(del.calledOnceWith('inv_draft')).to.be.true;
      expect(voidInvoice.called).to.be.false;
      expect(result.deleted.invoices).to.equal(1);
    });

    it('skips already-void seeded invoices without API calls but still counts them', async () => {
      const { seeder, stripe } = makeSeeder();
      sinon.stub(stripe.invoices, 'list').resolves({
        data: [seededInvoice('inv_void', 'void')],
        has_more: false,
      });
      const voidInvoice = sinon.stub(stripe.invoices, 'voidInvoice').resolves();
      const del = sinon.stub(stripe.invoices, 'del').resolves();

      const result = await seeder.clean({ platform: 'stripe' });

      expect(voidInvoice.called).to.be.false;
      expect(del.called).to.be.false;
      expect(result.deleted.invoices).to.equal(1);
    });

    it('warns and skips paid seeded invoices', async () => {
      const { seeder, stripe } = makeSeeder();
      sinon.stub(stripe.invoices, 'list').resolves({
        data: [seededInvoice('inv_paid', 'paid')],
        has_more: false,
      });
      const voidInvoice = sinon.stub(stripe.invoices, 'voidInvoice').resolves();
      const del = sinon.stub(stripe.invoices, 'del').resolves();

      const result = await seeder.clean({ platform: 'stripe' });

      expect(voidInvoice.called).to.be.false;
      expect(del.called).to.be.false;
      expect(result.deleted.invoices).to.equal(0);
      expect(result.errors).to.have.lengthOf(0);
    });

    it('ignores invoices without the SEEDED_TAG metadata', async () => {
      const { seeder, stripe } = makeSeeder();
      sinon.stub(stripe.invoices, 'list').resolves({
        data: [{ id: 'inv_unowned', status: 'open', metadata: {} }],
        has_more: false,
      });
      const voidInvoice = sinon.stub(stripe.invoices, 'voidInvoice').resolves();
      const del = sinon.stub(stripe.invoices, 'del').resolves();

      const result = await seeder.clean({ platform: 'stripe' });

      expect(voidInvoice.called).to.be.false;
      expect(del.called).to.be.false;
      expect(result.deleted.invoices).to.equal(0);
    });
  });
});
