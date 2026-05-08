import { expect } from 'chai';
import { promisePool } from '../../../../src/simulation/uploaders/base-uploader';

describe('simulation/uploaders/promisePool', () => {
  it('processes every item exactly once with bounded concurrency', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;
    const seen = new Set<number>();

    const results = await promisePool(items, 5, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      seen.add(item);
      active -= 1;
      return item * 2;
    });

    expect(seen.size).to.equal(items.length);
    expect(maxActive).to.be.at.most(5);
    expect(results).to.deep.equal(items.map((i) => i * 2));
  });

  it('preserves result order even when workers finish out of order', async () => {
    const items = [50, 5, 30, 1, 20];
    const results = await promisePool(items, 3, async (item) => {
      await new Promise((r) => setTimeout(r, item));
      return item;
    });
    expect(results).to.deep.equal(items);
  });

  it('returns immediately on empty input', async () => {
    const results = await promisePool<number, number>([], 5, async () => 1);
    expect(results).to.deep.equal([]);
  });
});
