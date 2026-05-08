import { expect } from 'chai';
import { generateAnswerKey } from '../../../src/simulation/answer-key';
import { generateDirtyDatasets } from '../../../src/simulation/dirty';
import { CanonicalPerson, DirtyContact } from '../../../src/simulation/types';

function recordsForCanonical(records: DirtyContact[], canonicalId: string): DirtyContact[] {
  return records.filter((r) => r.canonicalId === canonicalId);
}

function hasContactable(record: DirtyContact): boolean {
  return Boolean(record.email || record.phone);
}

describe('simulation/dirty', () => {
  let answerKey: CanonicalPerson[];

  beforeEach(() => {
    answerKey = generateAnswerKey('small');
  });

  it('produces one record per canonical per platform when neither flag is set', () => {
    const dirty = generateDirtyDatasets(answerKey, { fragment: false, duplicate: false, seed: 1 });
    expect(dirty.stripe).to.have.lengthOf(answerKey.length);
    expect(dirty.hubspot).to.have.lengthOf(answerKey.length);
    expect(dirty.shopify).to.have.lengthOf(answerKey.length);
  });

  it('always preserves at least one matchable identifier under fragmentation', () => {
    const dirty = generateDirtyDatasets(answerKey, { fragment: true, duplicate: false, seed: 1 });
    for (const platform of ['stripe', 'hubspot', 'shopify'] as const) {
      for (const record of dirty[platform]) {
        expect(hasContactable(record), `${platform} record ${record.internalId} has no email or phone`).to.be.true;
      }
    }
  });

  it('stamps a unique internalId on every record across all platforms', () => {
    const dirty = generateDirtyDatasets(answerKey, { fragment: true, duplicate: true, seed: 7 });
    const ids = [
      ...dirty.stripe.map((r) => r.internalId),
      ...dirty.hubspot.map((r) => r.internalId),
      ...dirty.shopify.map((r) => r.internalId),
    ];
    expect(new Set(ids).size).to.equal(ids.length);
  });

  it('Stripe duplicates share email and differ on company or address', () => {
    const dirty = generateDirtyDatasets(answerKey, { fragment: false, duplicate: true, seed: 42 });
    const duplicated = answerKey
      .map((p) => recordsForCanonical(dirty.stripe, p.canonicalId))
      .find((records) => records.length === 2);
    expect(duplicated, 'expected at least one Stripe duplicate pair').to.exist;
    if (!duplicated) return;
    const [a, b] = duplicated;
    expect(a.email).to.equal(b.email);
    const differs = a.company !== b.company || a.address?.street !== b.address?.street;
    expect(differs, 'Stripe duplicates must differ on company or address').to.be.true;
  });

  it('HubSpot duplicates share phone and differ on email', () => {
    // HubSpot duplicate rate is 10% — try a few seeds to find one with at least one dup.
    let dup: DirtyContact[] | undefined;
    for (let seed = 1; seed < 50 && !dup; seed++) {
      const dirty = generateDirtyDatasets(answerKey, {
        fragment: false,
        duplicate: true,
        seed,
      });
      dup = answerKey
        .map((p) => recordsForCanonical(dirty.hubspot, p.canonicalId))
        .find((records) => records.length === 2);
    }
    expect(dup, 'expected at least one HubSpot duplicate pair across seeds').to.exist;
    if (!dup) return;
    const [a, b] = dup;
    expect(a.phone).to.equal(b.phone);
    expect(a.email).to.not.equal(b.email);
  });

  it('Shopify duplicates split phone-only and email-only', () => {
    let dup: DirtyContact[] | undefined;
    for (let seed = 1; seed < 50 && !dup; seed++) {
      const dirty = generateDirtyDatasets(answerKey, {
        fragment: false,
        duplicate: true,
        seed,
      });
      dup = answerKey
        .map((p) => recordsForCanonical(dirty.shopify, p.canonicalId))
        .find((records) => records.length === 2);
    }
    expect(dup, 'expected at least one Shopify duplicate pair across seeds').to.exist;
    if (!dup) return;
    const variants = new Set(dup.map((r) => `${r.email ? 'E' : ''}${r.phone ? 'P' : ''}`));
    // One should be email-only ("E"), one should be phone-only ("P").
    expect(variants.has('E')).to.be.true;
    expect(variants.has('P')).to.be.true;
  });

  it('is reproducible with the same seed', () => {
    const a = generateDirtyDatasets(answerKey, { fragment: true, duplicate: true, seed: 99 });
    const b = generateDirtyDatasets(answerKey, { fragment: true, duplicate: true, seed: 99 });
    expect(b.stripe.length).to.equal(a.stripe.length);
    expect(b.hubspot.length).to.equal(a.hubspot.length);
    expect(b.shopify.length).to.equal(a.shopify.length);
  });
});
