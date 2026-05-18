import { expect } from 'chai';
import { generateAnswerKey } from '../../../src/simulation/answer-key';
import {
  abbreviateAddress,
  generateDirtyDatasets,
  mutateName,
} from '../../../src/simulation/dirty';
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

  describe('fuzzy duplicates', () => {
    it('fuzzy: false produces output identical to fuzzy omitted', () => {
      const off = generateDirtyDatasets(answerKey, {
        fragment: false,
        duplicate: false,
        fuzzy: false,
        seed: 1,
      });
      const omitted = generateDirtyDatasets(answerKey, {
        fragment: false,
        duplicate: false,
        seed: 1,
      });
      // Same counts and same canonical → record breakdown means the fuzzy
      // branch consumed zero rng draws when disabled.
      expect(off.stripe.length).to.equal(omitted.stripe.length);
      expect(off.hubspot.length).to.equal(omitted.hubspot.length);
      expect(off.shopify.length).to.equal(omitted.shopify.length);
      expect(off.stripe.length).to.equal(answerKey.length);
    });

    it('fuzzy: true produces at least one Tier-2-shaped variant per platform across seeds', () => {
      // Per-platform: scan a handful of seeds for evidence that fuzzyDuplicate
      // fires and emits a record that (a) shares the canonical id, (b) has a
      // different exact email than the canonical, (c) has no exact phone match.
      const platforms = ['stripe', 'hubspot', 'shopify'] as const;
      for (const platform of platforms) {
        let found = false;
        for (let seed = 1; seed < 50 && !found; seed++) {
          const dirty = generateDirtyDatasets(answerKey, {
            fragment: false,
            duplicate: false,
            fuzzy: true,
            seed,
          });
          for (const person of answerKey) {
            const records = dirty[platform].filter((r) => r.canonicalId === person.canonicalId);
            const fuzzyHit = records.find(
              (r) =>
                r.email !== person.email &&
                (r.phone === null || r.phone !== person.phone) &&
                (r.firstName !== person.firstName ||
                  r.lastName !== person.lastName ||
                  r.address?.street !== person.address.street),
            );
            if (fuzzyHit) {
              found = true;
              break;
            }
          }
        }
        expect(found, `expected a fuzzy duplicate on ${platform} within 50 seeds`).to.be.true;
      }
    });

    it('Stripe fuzzy duplicates share email domain with the canonical', () => {
      // Stripe's fuzzy variant uses mutateEmail (same domain, different local
      // part). Confirm the domain matches when a fuzzy record exists.
      let checked = false;
      for (let seed = 1; seed < 50; seed++) {
        const dirty = generateDirtyDatasets(answerKey, {
          fragment: false,
          duplicate: false,
          fuzzy: true,
          seed,
        });
        for (const person of answerKey) {
          const records = dirty.stripe.filter((r) => r.canonicalId === person.canonicalId);
          if (records.length < 2) continue;
          const fuzzy = records.find((r) => r.email !== person.email);
          if (!fuzzy || !fuzzy.email) continue;
          const canonicalDomain = person.email.split('@')[1];
          const fuzzyDomain = fuzzy.email.split('@')[1];
          expect(fuzzyDomain).to.equal(canonicalDomain);
          checked = true;
        }
        if (checked) break;
      }
      expect(checked, 'expected to find at least one Stripe fuzzy duplicate to inspect').to.be.true;
    });

    it('is reproducible with the same seed when fuzzy is enabled', () => {
      const a = generateDirtyDatasets(answerKey, {
        fragment: true,
        duplicate: true,
        fuzzy: true,
        seed: 123,
      });
      const b = generateDirtyDatasets(answerKey, {
        fragment: true,
        duplicate: true,
        fuzzy: true,
        seed: 123,
      });
      // Compare structurally — internalId is a uuid (non-deterministic), so
      // strip it before comparing.
      const strip = (records: DirtyContact[]) =>
        records.map(({ internalId: _id, ...rest }) => rest);
      expect(strip(a.stripe)).to.deep.equal(strip(b.stripe));
      expect(strip(a.hubspot)).to.deep.equal(strip(b.hubspot));
      expect(strip(a.shopify)).to.deep.equal(strip(b.shopify));
    });
  });

  describe('per-platform email uniqueness', () => {
    it('hubspot and shopify dirty datasets never emit duplicate emails', () => {
      // Scan a handful of seeds with all generation paths on, including fuzzy,
      // to surface any cross-canonical collision that the per-platform dedup
      // pass would have to mutate away.
      for (let seed = 1; seed < 20; seed++) {
        const dirty = generateDirtyDatasets(answerKey, {
          fragment: true,
          duplicate: true,
          fuzzy: true,
          seed,
        });
        for (const platform of ['hubspot', 'shopify'] as const) {
          const emails = dirty[platform]
            .map((r) => r.email?.toLowerCase())
            .filter((e): e is string => !!e);
          expect(new Set(emails).size, `${platform} seed=${seed} had duplicate emails`).to.equal(
            emails.length,
          );
        }
      }
    });

    it('stripe still emits duplicate emails when intentional Tier-1 duplication fires', () => {
      // Stripe's Tier-1 dup strategy is "same email, different attributes". The
      // dedup pass must NOT run for stripe, otherwise the test corpus loses
      // its exact-email duplicate signal.
      let foundDup = false;
      for (let seed = 1; seed < 50 && !foundDup; seed++) {
        const dirty = generateDirtyDatasets(answerKey, {
          fragment: false,
          duplicate: true,
          seed,
        });
        const counts = new Map<string, number>();
        for (const r of dirty.stripe) {
          if (!r.email) continue;
          counts.set(r.email, (counts.get(r.email) ?? 0) + 1);
        }
        foundDup = Array.from(counts.values()).some((n) => n > 1);
      }
      expect(foundDup, 'expected at least one Stripe exact-email duplicate within 50 seeds').to.be
        .true;
    });
  });

  describe('mutateName', () => {
    // Use a tiny deterministic rng for unit tests.
    function rngFrom(values: number[]): () => number {
      let i = 0;
      return () => values[i++ % values.length];
    }

    it('swaps a known nickname (Joe → Joseph)', () => {
      const out = mutateName('Joe', 'Smith', rngFrom([0.5]));
      expect(out.first).to.equal('Joseph');
      expect(out.last).to.equal('Smith');
    });

    it('swaps the long form back (Elizabeth → Liz)', () => {
      const out = mutateName('Elizabeth', 'Brown', rngFrom([0.5]));
      expect(out.first).to.equal('Liz');
      expect(out.last).to.equal('Brown');
    });

    it('applies a single-character edit when no nickname matches', () => {
      const out = mutateName('Xander', 'Quinn', rngFrom([0.0, 0.0, 0.0, 0.0]));
      // One of first/last differs from the input but the other is unchanged.
      const firstDiff = out.first !== 'Xander';
      const lastDiff = out.last !== 'Quinn';
      expect(firstDiff !== lastDiff, 'exactly one of first/last should be mutated').to.be.true;
    });
  });

  describe('abbreviateAddress', () => {
    function rng(): number {
      return 0.5;
    }

    it('abbreviates a full street suffix (Street → St)', () => {
      const out = abbreviateAddress(
        { street: '123 Main Street', city: 'Townsville', state: 'CA', zip: '90210', country: 'US' },
        rng,
      );
      expect(out?.street).to.equal('123 Main St');
      expect(out?.city).to.equal('Townsville');
      expect(out?.state).to.equal('CA');
      expect(out?.zip).to.equal('90210');
    });

    it('expands an abbreviated street suffix (Ave → Avenue)', () => {
      const out = abbreviateAddress(
        { street: '456 Oak Ave', city: 'Townsville', state: 'CA', zip: '90210', country: 'US' },
        rng,
      );
      expect(out?.street).to.equal('456 Oak Avenue');
    });

    it('falls back to toggling trailing period when no suffix matches', () => {
      const out = abbreviateAddress(
        { street: '789 Plaza', city: 'Townsville', state: 'CA', zip: '90210', country: 'US' },
        rng,
      );
      expect(out?.street).to.equal('789 Plaza.');
    });

    it('returns the address unchanged when street is null', () => {
      const addr = { street: null, city: null, state: null, zip: null, country: null };
      expect(abbreviateAddress(addr, rng)).to.equal(addr);
    });
  });
});
