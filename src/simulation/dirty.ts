import { v4 as uuidv4 } from 'uuid';
import { Platform } from '@/types';
import { CanonicalPerson, DirtyContact, DirtyDatasets, DirtyRecordTier } from '@/simulation/types';

export interface DirtyOptions {
  fragment: boolean;
  duplicate: boolean;
  fuzzy?: boolean;
  seed?: number;
  platforms?: Platform[];
}

interface PlatformConfig {
  fragment: (person: CanonicalPerson, rng: Rng) => Partial<DirtyContact>[];
  duplicate: (person: CanonicalPerson, rng: Rng) => Partial<DirtyContact>[];
  duplicateRate: number;
  /** Emits records that miss Tier 1 but share enough fuzzy signal for Tier 2. */
  fuzzyDuplicate: (person: CanonicalPerson, rng: Rng) => Partial<DirtyContact>[];
  fuzzyDuplicateRate: number;
  /**
   * Whether the destination platform enforces unique customer email at write
   * time. HubSpot uses email as the primary contact identifier; Shopify rejects
   * duplicate emails per store with a 422. Stripe allows duplicate emails.
   * When true, a final dedup pass mutates colliding emails so the upload
   * succeeds — within-canonical intentional duplicates aren't affected because
   * each platform's `duplicate` strategy already avoids same-email pairs.
   */
  requiresUniqueEmail: boolean;
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

function fullContact(person: CanonicalPerson): Omit<DirtyContact, 'canonicalId' | 'internalId' | 'tier'> {
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
  tier: DirtyRecordTier,
  overrides: Partial<DirtyContact>,
): DirtyContact {
  return {
    canonicalId: person.canonicalId,
    internalId: uuidv4(),
    tier,
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
    // Tier 2 address-abbreviation variant: same name + same email-domain
    // (different local part) + null phone + abbreviated street suffix.
    fuzzyDuplicate: (person, rng) => [
      {
        email: mutateEmail(person.email, rng),
        phone: null,
        address: abbreviateAddress(person.address, rng),
      },
    ],
    fuzzyDuplicateRate: 0.15,
    requiresUniqueEmail: true,
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
    // Tier 2 name-mutation variant: nickname swap or single-char typo,
    // same email-domain (different local part), null phone.
    fuzzyDuplicate: (person, rng) => {
      const mutated = mutateName(person.firstName, person.lastName, rng);
      return [
        {
          firstName: mutated.first,
          lastName: mutated.last,
          email: mutateEmail(person.email, rng),
          phone: null,
        },
      ];
    },
    fuzzyDuplicateRate: 0.15,
    requiresUniqueEmail: false,
  },
  shopify: {
    fragment: (person, rng) => [pick(rng, SHOPIFY_FRAGMENTS)()],
    // Shopify dedupes on phone+email; split-attribute records sneak through.
    duplicate: () => [
      { phone: null }, // email-only variant
      { email: null }, // phone-only variant
    ],
    duplicateRate: 0.1,
    // Tier 2 combined variant: 50% of the time use a reversed first/last
    // ordering (Tier 2 calibration target for the JW≈0.5 case — see
    // Session 6 tuning notes), 50% use nickname/typo mutation. Both
    // shapes pair with abbreviated address + different email entirely +
    // null phone, so neither side shares email-domain or phone-prefix.
    fuzzyDuplicate: (person, rng) => {
      const reverse = rng() < 0.5;
      const mutated = reverse
        ? reverseFirstLast(person.firstName, person.lastName)
        : mutateName(person.firstName, person.lastName, rng);
      const suffix = Math.floor(rng() * 10000);
      return [
        {
          firstName: mutated.first,
          lastName: mutated.last,
          email: `${mutated.first.toLowerCase()}.${suffix}@example.com`,
          phone: null,
          address: abbreviateAddress(person.address, rng),
        },
      ];
    },
    fuzzyDuplicateRate: 0.15,
    requiresUniqueEmail: true,
  },
};

/**
 * Ensure no two records in the array share an email (case-insensitive).
 * Records with a null email are left alone — they don't collide with anything.
 * The first occurrence of an email keeps it; later collisions get a
 * deterministic `.dedupN` suffix on the local part. The same `internalId` and
 * `canonicalId` are preserved, so the answer-key linkage stays intact.
 */
function enforceUniqueEmail(records: DirtyContact[]): DirtyContact[] {
  const seen = new Set<string>();
  let counter = 0;
  return records.map((record) => {
    if (!record.email) return record;
    const lower = record.email.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      return record;
    }
    const [local, domain] = record.email.split('@');
    let candidate = '';
    do {
      counter += 1;
      candidate = `${local}.dedup${counter}@${domain ?? 'example.com'}`;
    } while (seen.has(candidate.toLowerCase()));
    seen.add(candidate.toLowerCase());
    return { ...record, email: candidate };
  });
}

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

// Small hand-curated nickname table for Tier 2 fuzzy-name cases. Bidirectional:
// if a key is found, swap to its partner. Not canonical — just enough variety
// to produce recognizable nickname duplicates for Checkpoint 1 inspection.
// Expanded in Session 6 (Gamma) to widen calibration coverage of the JW≈0.7-0.85
// nickname band — the band that distinguishes the FS_PARAMS tuning sweet spot.
const NICKNAMES: Record<string, string> = {
  joe: 'joseph', joseph: 'joe',
  liz: 'elizabeth', elizabeth: 'liz',
  bob: 'robert', robert: 'bob',
  tom: 'thomas', thomas: 'tom',
  bill: 'william', william: 'bill',
  dick: 'richard', richard: 'dick',
  jim: 'james', james: 'jim',
  mike: 'michael', michael: 'mike',
  dave: 'david', david: 'dave',
  chris: 'christopher', christopher: 'chris',
  // Session 6 additions — broaden first-name nickname coverage so the
  // calibration corpus exercises the JW≈0.7-0.85 band that distinguishes
  // the tuned FS_PARAMS sweet spot from looser/tighter configurations.
  steve: 'steven', steven: 'steve',
  matt: 'matthew', matthew: 'matt',
  ben: 'benjamin', benjamin: 'ben',
  sam: 'samuel', samuel: 'sam',
  alex: 'alexander', alexander: 'alex',
  kate: 'katherine', katherine: 'kate',
  pat: 'patrick', patrick: 'pat',
  nick: 'nicholas', nicholas: 'nick',
  dan: 'daniel', daniel: 'dan',
};

const STREET_TYPES: Array<[long: string, short: string]> = [
  ['street', 'st'],
  ['avenue', 'ave'],
  ['boulevard', 'blvd'],
  ['drive', 'dr'],
  ['road', 'rd'],
  ['lane', 'ln'],
  ['court', 'ct'],
];

function capitalize(word: string): string {
  if (!word) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

function singleCharEdit(word: string, rng: Rng): string {
  if (!word) return word;
  const op = Math.floor(rng() * 3); // 0=substitute, 1=insert, 2=delete (skipped on len<=2)
  const pos = Math.floor(rng() * word.length);
  const letter = String.fromCharCode(97 + Math.floor(rng() * 26)); // a..z
  if (op === 2 && word.length > 2) {
    return word.slice(0, pos) + word.slice(pos + 1);
  }
  if (op === 1) {
    return word.slice(0, pos) + letter + word.slice(pos);
  }
  // substitute (also fallback when delete would shrink too far)
  return word.slice(0, pos) + letter + word.slice(pos + 1);
}

/**
 * Mutate a name to produce a Tier-2-fuzzy variant of the original. If the
 * first name has a nickname-table entry, swap to its partner; otherwise apply
 * a single-character edit (insert/delete/substitute) to one of the names.
 * Deterministic given the rng state.
 */
export function mutateName(
  first: string,
  last: string,
  rng: Rng,
): { first: string; last: string } {
  const firstLower = first.toLowerCase();
  const lastLower = last.toLowerCase();
  if (NICKNAMES[firstLower]) {
    return { first: capitalize(NICKNAMES[firstLower]), last };
  }
  if (NICKNAMES[lastLower]) {
    return { first, last: capitalize(NICKNAMES[lastLower]) };
  }
  // No nickname hit — apply a single-char Levenshtein-1 edit. Pick first or
  // last to mutate based on the next rng draw.
  const mutateFirst = rng() < 0.5;
  if (mutateFirst) {
    return { first: capitalize(singleCharEdit(firstLower, rng)), last };
  }
  return { first, last: capitalize(singleCharEdit(lastLower, rng)) };
}

/**
 * Reverse first/last name fields to produce a Tier-2-fuzzy variant where the
 * upstream CRM filled "first_name" with the surname (or vice versa). Common in
 * messy SMB data — a sales rep types the name backwards once and the row
 * persists. Jaro-Winkler on the normalized concatenated name lands ~0.5 on the
 * reversed pair (verified in the Session 6 tuning script), which puts the pair
 * in the review band when combined with shared email_domain + phone_prefix.
 */
export function reverseFirstLast(
  first: string,
  last: string,
): { first: string; last: string } {
  return { first: last, last: first };
}

/**
 * Mutate an address to produce a Tier-2-fuzzy variant by swapping the street
 * suffix between its long form and its abbreviation (Street ↔ St, Avenue ↔
 * Ave, etc.). If no suffix is recognized, toggles the trailing period as a
 * fallback trigram-perturbing mutation. Other fields are preserved.
 */
export function abbreviateAddress(
  addr: DirtyContact['address'],
  rng: Rng,
): DirtyContact['address'] {
  if (!addr || !addr.street) return addr;
  const street = addr.street;
  const trailingPeriod = /\.$/.test(street);
  const stripped = trailingPeriod ? street.slice(0, -1) : street;
  // Match the final token (case-insensitive). Swap to its partner if known.
  const match = stripped.match(/^(.*?)(\s+)(\S+)$/);
  if (match) {
    const [, prefix, sep, token] = match;
    const tokenLower = token.toLowerCase();
    for (const [long, short] of STREET_TYPES) {
      if (tokenLower === long) {
        return { ...addr, street: `${prefix}${sep}${capitalize(short)}` };
      }
      if (tokenLower === short) {
        return { ...addr, street: `${prefix}${sep}${capitalize(long)}` };
      }
    }
  }
  // Fallback: toggle trailing period to still perturb the trigram set. Use
  // rng to keep the call deterministic relative to the rng stream even when
  // the branch isn't strictly needed.
  rng();
  return { ...addr, street: trailingPeriod ? stripped : `${stripped}.` };
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

    // Fuzzy duplicates run independently of the Tier-1 duplicate path: a
    // canonical can produce a Tier-1-style dup (same exact email) AND a
    // Tier-2-style fuzzy dup (mutated name / address, different exact email)
    // in the same run.
    const fuzzyVariants =
      options.fuzzy && rng() < config.fuzzyDuplicateRate
        ? config.fuzzyDuplicate(person, rng)
        : [];

    // Tier labels: when duplicate() fires it returns [{}, ...realDups] — the
    // first entry is the canonical base and any subsequent entries are Tier-1
    // duplicates. Fuzzy variants are always Tier-2.
    variants.forEach((variant, idx) => {
      const tier: DirtyRecordTier = isDuplicated && idx > 0 ? 'duplicate' : 'canonical';
      const fragment = options.fragment ? config.fragment(person, rng)[0] : {};
      const record = makeRecord(person, tier, { ...fragment, ...variant });
      out.push(ensureContactable(record, { email: person.email, phone: person.phone }));
    });
    for (const variant of fuzzyVariants) {
      const fragment = options.fragment ? config.fragment(person, rng)[0] : {};
      const record = makeRecord(person, 'fuzzy', { ...fragment, ...variant });
      out.push(ensureContactable(record, { email: person.email, phone: person.phone }));
    }
  }

  return config.requiresUniqueEmail ? enforceUniqueEmail(out) : out;
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
