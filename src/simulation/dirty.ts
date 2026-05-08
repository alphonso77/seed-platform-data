import { v4 as uuidv4 } from 'uuid';
import { Platform } from '@/types';
import { CanonicalPerson, DirtyContact, DirtyDatasets } from '@/simulation/types';

export interface DirtyOptions {
  fragment: boolean;
  duplicate: boolean;
  seed?: number;
  platforms?: Platform[];
}

interface PlatformConfig {
  fragment: (person: CanonicalPerson, rng: Rng) => Partial<DirtyContact>[];
  duplicate: (person: CanonicalPerson, rng: Rng) => Partial<DirtyContact>[];
  duplicateRate: number;
}

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: Rng, items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function emptyAddress(): DirtyContact['address'] {
  return { street: null, city: null, state: null, zip: null, country: null };
}

function fullContact(person: CanonicalPerson): Omit<DirtyContact, 'canonicalId' | 'internalId'> {
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    email: person.email,
    phone: person.phone,
    company: person.company,
    jobTitle: person.jobTitle,
    address: { ...person.address },
  };
}

function makeRecord(
  person: CanonicalPerson,
  overrides: Partial<DirtyContact>,
): DirtyContact {
  return {
    canonicalId: person.canonicalId,
    internalId: uuidv4(),
    ...fullContact(person),
    ...overrides,
  };
}

// HubSpot: typically the richest CRM. Most records keep email; phone often present.
const HUBSPOT_FRAGMENTS = [
  () => ({}),
  () => ({ company: null, jobTitle: null }),
  () => ({ phone: null }),
  () => ({ address: emptyAddress() }),
  () => ({ jobTitle: null, address: emptyAddress() }),
];

// Stripe: customer profile often partial — sometimes phone-only, sometimes email-only.
const STRIPE_FRAGMENTS = [
  () => ({}),
  () => ({ phone: null }),
  () => ({ email: null }),
  () => ({ jobTitle: null, company: null }),
  () => ({ address: emptyAddress(), jobTitle: null }),
];

// Shopify: storefront data — name + one contact channel is the common case.
const SHOPIFY_FRAGMENTS = [
  () => ({}),
  () => ({ company: null, jobTitle: null }),
  () => ({ phone: null, jobTitle: null }),
  () => ({ email: null, jobTitle: null }),
  () => ({ address: emptyAddress() }),
];

const PLATFORMS: Record<keyof DirtyDatasets, PlatformConfig> = {
  hubspot: {
    fragment: (person, rng) => [pick(rng, HUBSPOT_FRAGMENTS)()],
    // HubSpot dedupes on email; sneak a duplicate through with different email but same phone.
    duplicate: (person, rng) => [
      {},
      {
        email: mutateEmail(person.email, rng),
        // company/address jittered to make the dup more realistic
        address: { ...person.address, street: jitterStreet(person.address.street, rng) },
      },
    ],
    duplicateRate: 0.1,
  },
  stripe: {
    fragment: (person, rng) => [pick(rng, STRIPE_FRAGMENTS)()],
    // Stripe allows duplicate emails — same email, different company/address.
    duplicate: (person, rng) => [
      {},
      {
        company: mutateCompany(person.company, rng),
        address: { ...person.address, street: jitterStreet(person.address.street, rng) },
      },
    ],
    duplicateRate: 0.3,
  },
  shopify: {
    fragment: (person, rng) => [pick(rng, SHOPIFY_FRAGMENTS)()],
    // Shopify dedupes on phone+email; split-attribute records sneak through.
    duplicate: () => [
      { phone: null }, // email-only variant
      { email: null }, // phone-only variant
    ],
    duplicateRate: 0.1,
  },
};

function mutateEmail(email: string, rng: Rng): string {
  const [local, domain] = email.split('@');
  const suffix = Math.floor(rng() * 10000);
  return `${local}.${suffix}@${domain ?? 'example.com'}`;
}

function mutateCompany(company: string, rng: Rng): string {
  const variants = ['LLC', 'Inc', 'Group', 'Holdings', 'Co'];
  return `${company} ${variants[Math.floor(rng() * variants.length)]}`;
}

function jitterStreet(street: string | null, rng: Rng): string | null {
  if (!street) return street;
  const offset = Math.floor(rng() * 100) + 1;
  return `${offset} ${street}`;
}

function ensureContactable(
  base: DirtyContact,
  fallback: { email: string; phone: string },
): DirtyContact {
  // Fragmentation must always leave at least one matchable identifier.
  if (base.email || base.phone) return base;
  return { ...base, email: fallback.email };
}

function buildPlatformRecords(
  platform: keyof DirtyDatasets,
  answerKey: CanonicalPerson[],
  options: DirtyOptions,
  rng: Rng,
): DirtyContact[] {
  const config = PLATFORMS[platform];
  const out: DirtyContact[] = [];

  for (const person of answerKey) {
    const isDuplicated = options.duplicate && rng() < config.duplicateRate;
    const variants = isDuplicated
      ? config.duplicate(person, rng)
      : [{}];

    for (const variant of variants) {
      const fragment = options.fragment ? config.fragment(person, rng)[0] : {};
      // Variant overrides come second so duplication patterns (e.g. email mutation) win
      // over generic fragmentation drops.
      const record = makeRecord(person, { ...fragment, ...variant });
      out.push(ensureContactable(record, { email: person.email, phone: person.phone }));
    }
  }

  return out;
}

export function generateDirtyDatasets(
  answerKey: CanonicalPerson[],
  options: DirtyOptions,
): DirtyDatasets {
  const rng = mulberry32(options.seed ?? Date.now());
  const selected = options.platforms;
  const isSelected = (p: Platform) => !selected || selected.includes(p);
  return {
    stripe: isSelected('stripe') ? buildPlatformRecords('stripe', answerKey, options, rng) : [],
    hubspot: isSelected('hubspot') ? buildPlatformRecords('hubspot', answerKey, options, rng) : [],
    shopify: isSelected('shopify') ? buildPlatformRecords('shopify', answerKey, options, rng) : [],
  };
}
