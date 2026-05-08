import { expect } from 'chai';
import { generateAnswerKey } from '../../../src/simulation/answer-key';
import { DATASET_SIZES } from '../../../src/config/datasets';

describe('simulation/answer-key', () => {
  it('produces the expected count for each size', () => {
    for (const size of ['small', 'medium'] as const) {
      const key = generateAnswerKey(size);
      expect(key).to.have.lengthOf(DATASET_SIZES[size].contacts);
    }
  });

  it('stamps a unique canonicalId on every person', () => {
    const key = generateAnswerKey('small');
    const ids = new Set(key.map((p) => p.canonicalId));
    expect(ids.size).to.equal(key.length);
    for (const id of ids) {
      expect(id).to.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
  });

  it('preserves the underlying contact shape (firstName, email, phone, address)', () => {
    const [person] = generateAnswerKey('small');
    expect(person.firstName).to.be.a('string').and.not.empty;
    expect(person.lastName).to.be.a('string').and.not.empty;
    expect(person.email).to.match(/@/);
    expect(person.phone).to.be.a('string').and.not.empty;
    expect(person.address.country).to.equal('US');
  });
});
