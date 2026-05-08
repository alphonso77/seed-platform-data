import { expect } from 'chai';
import { checkStripeEnvironment, checkShopifyEnvironment, assertSandbox } from '../../src/utils/safety';
import { resetEnv } from '../../src/config/env';

describe('Safety Utils', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnv();
  });

  describe('checkStripeEnvironment', () => {
    it('should approve sk_test_ keys', () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
      const result = checkStripeEnvironment();
      expect(result.isSandbox).to.be.true;
      expect(result.reason).to.include('sk_test_');
    });

    it('should reject sk_live_ keys', () => {
      process.env.STRIPE_SECRET_KEY = 'sk_live_abc123';
      const result = checkStripeEnvironment();
      expect(result.isSandbox).to.be.false;
      expect(result.reason).to.include('sk_live_');
    });

    it('should reject missing keys', () => {
      delete process.env.STRIPE_SECRET_KEY;
      const result = checkStripeEnvironment();
      expect(result.isSandbox).to.be.false;
      expect(result.reason).to.include('not configured');
    });

    it('should reject unrecognized key prefixes', () => {
      process.env.STRIPE_SECRET_KEY = 'rk_random_abc123';
      const result = checkStripeEnvironment();
      expect(result.isSandbox).to.be.false;
      expect(result.reason).to.include('unrecognized');
    });
  });

  describe('checkShopifyEnvironment', () => {
    it('should approve .myshopify.com domains', () => {
      process.env.SHOPIFY_STORE_DOMAIN = 'test-store.myshopify.com';
      process.env.SHOPIFY_ACCESS_TOKEN = 'shpat_abc123';
      const result = checkShopifyEnvironment();
      expect(result.isSandbox).to.be.true;
    });

    it('should reject non-.myshopify.com domains', () => {
      process.env.SHOPIFY_STORE_DOMAIN = 'production-store.com';
      process.env.SHOPIFY_ACCESS_TOKEN = 'shpat_abc123';
      const result = checkShopifyEnvironment();
      expect(result.isSandbox).to.be.false;
    });

    it('should reject missing config', () => {
      delete process.env.SHOPIFY_STORE_DOMAIN;
      delete process.env.SHOPIFY_ACCESS_TOKEN;
      const result = checkShopifyEnvironment();
      expect(result.isSandbox).to.be.false;
    });
  });

  describe('assertSandbox', () => {
    it('should not throw for sandbox environments', () => {
      expect(() => assertSandbox({ platform: 'stripe', isSandbox: true, reason: 'test' })).not.to.throw();
    });

    it('should throw for non-sandbox environments', () => {
      expect(() => assertSandbox({ platform: 'stripe', isSandbox: false, reason: 'live key' })).to.throw('SAFETY');
    });
  });
});
