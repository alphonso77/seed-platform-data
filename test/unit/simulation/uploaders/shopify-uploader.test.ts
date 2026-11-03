import { expect } from 'chai';
import { normalizeToE164, buildCustomerBody } from '../../../../src/simulation/uploaders/shopify-uploader';
import { isShopifyThrottleError } from '../../../../src/utils/shopify-throttle';

describe('utils/shopify-throttle isShopifyThrottleError', () => {
  it('matches the leaky-bucket throttle message', () => {
    expect(
      isShopifyThrottleError(
        new Error(
          'Shopify is throttling requests : "Exceeded 2 calls per second for api client. Reduce request rates to resume uninterrupted service."',
        ),
      ),
    ).to.be.true;
  });

  it('does not match the "email has already been taken" 422', () => {
    expect(
      isShopifyThrottleError(
        new Error(
          'Received an error response (422 Unprocessable Entity) from Shopify: { "email": [ "has already been taken" ] }',
        ),
      ),
    ).to.be.false;
  });

  it('handles non-Error throwables', () => {
    expect(isShopifyThrottleError('Shopify is throttling requests')).to.be.true;
    expect(isShopifyThrottleError(null)).to.be.false;
  });
});

describe('simulation/uploaders/shopify normalizeToE164', () => {
  it('formats a 10-digit US national number as +1XXXXXXXXXX', () => {
    expect(normalizeToE164('(708) 397-0264')).to.equal('+17083970264');
  });

  it('formats an 11-digit number starting with 1', () => {
    expect(normalizeToE164('1-415-555-1234')).to.equal('+14155551234');
  });

  it('passes a +-prefixed E.164 number through (digits only)', () => {
    expect(normalizeToE164('+1 (415) 555-1234')).to.equal('+14155551234');
  });

  it('returns null for empty or null input', () => {
    expect(normalizeToE164(null)).to.be.null;
    expect(normalizeToE164('')).to.be.null;
    expect(normalizeToE164('   ')).to.be.null;
  });

  it('returns null for inputs with too few digits', () => {
    expect(normalizeToE164('123')).to.be.null;
    expect(normalizeToE164('555-0100')).to.be.null;
  });

  it('returns null for non-1-prefixed 11-digit numbers (we only validate US-style)', () => {
    expect(normalizeToE164('20123456789')).to.be.null;
  });
});

describe('simulation/uploaders/shopify buildCustomerBody', () => {
  it('tags the run but writes no answer-key value (FS-361)', () => {
    const body = buildCustomerBody(
      {
        canonicalId: 'canon-xyz',
        internalId: 'int-xyz',
        tier: 'canonical',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        phone: null,
        company: null,
        jobTitle: null,
        address: null,
      },
      'run-9',
      '2026-10-29T00:00:00.000Z',
    );
    expect(body.tags).to.include('simulation_run_id:run-9');
    expect(JSON.stringify(body)).to.not.include('canon-xyz');
    expect(JSON.stringify(body)).to.not.include('int-xyz');
  });
});
