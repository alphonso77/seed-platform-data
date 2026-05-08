import { expect } from 'chai';
import { DATASET_SIZES } from '../../src/config/datasets';

describe('Dataset Sizes', () => {
  it('should define small, medium, and large sizes', () => {
    expect(DATASET_SIZES).to.have.all.keys('small', 'medium', 'large');
  });

  it('should have correct small size', () => {
    expect(DATASET_SIZES.small).to.deep.equal({ contacts: 25, products: 5, orders: 10 });
  });

  it('should have correct medium size', () => {
    expect(DATASET_SIZES.medium).to.deep.equal({ contacts: 250, products: 25, orders: 100 });
  });

  it('should have correct large size', () => {
    expect(DATASET_SIZES.large).to.deep.equal({ contacts: 2500, products: 100, orders: 1000 });
  });

  it('should have progressively larger sizes', () => {
    expect(DATASET_SIZES.medium.contacts).to.be.greaterThan(DATASET_SIZES.small.contacts);
    expect(DATASET_SIZES.large.contacts).to.be.greaterThan(DATASET_SIZES.medium.contacts);
  });
});
