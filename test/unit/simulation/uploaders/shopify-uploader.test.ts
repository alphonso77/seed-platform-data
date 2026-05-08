import { expect } from 'chai';
import { normalizeToE164 } from '../../../../src/simulation/uploaders/shopify-uploader';

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
