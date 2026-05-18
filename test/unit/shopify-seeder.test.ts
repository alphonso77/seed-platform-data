import { expect } from 'chai';
import { parseShopifyNextPageInfo } from '../../src/seeders/shopify-seeder';

describe('parseShopifyNextPageInfo', () => {
  it('returns undefined for an empty / missing header', () => {
    expect(parseShopifyNextPageInfo(undefined)).to.be.undefined;
    expect(parseShopifyNextPageInfo('')).to.be.undefined;
  });

  it('extracts the next cursor when the header only has rel="next"', () => {
    const header =
      '<https://shop.myshopify.com/admin/api/2026-01/customers.json?limit=250&page_info=NEXT_CURSOR>; rel="next"';
    expect(parseShopifyNextPageInfo(header)).to.equal('NEXT_CURSOR');
  });

  it('extracts the next cursor when "previous" appears first', () => {
    // Reproduces the latent bug: the old regex grabbed the first page_info= it
    // saw (PREV_CURSOR) and walked backwards. The fixed parser must follow
    // rel="next" specifically.
    const header =
      '<https://shop.myshopify.com/admin/api/2026-01/customers.json?limit=250&page_info=PREV_CURSOR>; rel="previous", ' +
      '<https://shop.myshopify.com/admin/api/2026-01/customers.json?limit=250&page_info=NEXT_CURSOR>; rel="next"';
    expect(parseShopifyNextPageInfo(header)).to.equal('NEXT_CURSOR');
  });

  it('returns undefined on the last page (only rel="previous")', () => {
    const header =
      '<https://shop.myshopify.com/admin/api/2026-01/customers.json?limit=250&page_info=PREV_CURSOR>; rel="previous"';
    expect(parseShopifyNextPageInfo(header)).to.be.undefined;
  });

  it('tolerates unquoted rel value and extra whitespace', () => {
    const header =
      '<https://shop.myshopify.com/admin/api/customers.json?page_info=ABC&limit=250> ; rel=next';
    expect(parseShopifyNextPageInfo(header)).to.equal('ABC');
  });

  it('handles page_info as the first query parameter', () => {
    const header =
      '<https://shop.myshopify.com/admin/api/customers.json?page_info=XYZ&limit=250>; rel="next"';
    expect(parseShopifyNextPageInfo(header)).to.equal('XYZ');
  });
});
