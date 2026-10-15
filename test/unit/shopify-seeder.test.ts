import { expect } from 'chai';
import {
  assertNoUserErrors,
  buildProductSetInput,
  parseShopifyNextPageInfo,
} from '../../src/seeders/shopify-seeder';
import { GeneratedProduct, SEEDED_AT_TAG, SEEDED_TAG } from '../../src/types';

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

describe('buildProductSetInput', () => {
  const product: GeneratedProduct = {
    name: 'Rustic Steel Chair',
    description: 'A sturdy chair.',
    price: 42.5,
    currency: 'usd',
    sku: 'SKU-ABCD1234',
    category: 'Home & Garden',
    images: [],
  };
  const seededAt = '2026-10-15T15:42:25.511Z';

  it('tags the product with SEEDED_TAG and a seeded-at tag as a list', () => {
    const input = buildProductSetInput(product, seededAt);
    expect(input.tags).to.deep.equal([SEEDED_TAG, `${SEEDED_AT_TAG}:${seededAt}`]);
  });

  it('maps the REST product fields to their GraphQL names', () => {
    const input = buildProductSetInput(product, seededAt);
    expect(input).to.include({
      title: 'Rustic Steel Chair',
      descriptionHtml: '<p>A sturdy chair.</p>',
      vendor: 'Seed Platform Data',
      productType: 'Home & Garden',
      status: 'ACTIVE',
    });
  });

  it('creates one default variant with a 2-decimal price, the SKU, and untracked inventory', () => {
    const input = buildProductSetInput(product, seededAt);
    expect(input.productOptions).to.deep.equal([{ name: 'Title', values: [{ name: 'Default Title' }] }]);
    expect(input.variants).to.deep.equal([
      {
        optionValues: [{ optionName: 'Title', name: 'Default Title' }],
        price: '42.50',
        sku: 'SKU-ABCD1234',
        inventoryItem: { tracked: false },
      },
    ]);
  });
});

describe('assertNoUserErrors', () => {
  it('does nothing for an empty or missing list', () => {
    expect(() => assertNoUserErrors('productSet', [])).not.to.throw();
    expect(() => assertNoUserErrors('productSet', undefined)).not.to.throw();
  });

  it('throws with the operation name, field path and message', () => {
    expect(() =>
      assertNoUserErrors('productSet', [
        { field: ['input', 'variants', '0', 'price'], message: 'is invalid' },
        { field: null, message: 'Something else' },
      ]),
    ).to.throw('productSet failed: input.variants.0.price: is invalid; Something else');
  });
});
