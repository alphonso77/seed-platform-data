# Session prompt: Tier 2 fuzzy dirty patterns

**Goal.** Extend the simulation's dirty-data generator with a `fuzzy: boolean` flag that produces **deliberate, reproducible** records exercising **Tier 2 fuzzy identity resolution** in the upstream FratelliSoftware (OI) resolver. Until this lands, the upstream **Checkpoint 1 smoke** for Tier 2 cannot run with inspectable, predictable inputs.

**Note on today's patterns.** The existing duplicate paths are *designed* to share an exact email or phone with the canonical (Tier 1 cases). However, fragmentation can independently strip the remaining Tier 1 marker — e.g. HubSpot's mutated-email duplicate variant has its phone nulled by a fragment ~20% of the time, leaving a record that misses Tier 1 on both lookups. So today's data does *accidentally* produce some Tier 2 inputs at low frequency (~1% of records in some platforms). This explains why pre-Session-3 grading runs sat at 94-96% rather than 100% — those records became `create-new` and showed up as `under_merged`. Post-Session-3 (Tier 2 wired) they may now be auto-merged by the fuzzy path, lifting the baseline score without any change here.

What this work is for: **the accidental Tier 2 cases are random, low-frequency, and likely to land in the auto-merge band (≥0.85) because name + email-domain overlap scores high.** Checkpoint 1 needs to verify the review-queue write path (0.5-0.85 band), which requires inputs deliberately tuned to that score band. That's what `fuzzy: true` provides.

This is a **single-session effort.** No coordination file needed; everything to execute is in this document.

---

## Context (read this before coding)

The upstream FratelliSoftware repo just landed **OI Phase 2 Session 3** — wiring Tier 2 fuzzy matching into the resolver cascade. Tier 2 is invoked **only on Tier 1 miss** (cost guarantee), and uses:

- **Trigram name-text match** (Jaro-Winkler on normalized `name_text`)
- **Trigram address-text match** (Jaccard on normalized `address_text`)
- **Email-domain block** (e.g. both records `*@acme.com` — even with different local parts)
- **Phone-prefix block** (first 7 digits — area code + exchange)

Then a Fellegi-Sunter scorer assigns a 0..1 confidence. Bands:

- **≥ 0.85** → auto-merge into the candidate DNA, ref tagged `tier: 2, confidence: <score>`.
- **0.5 ≤ s < 0.85** → write to `oi.match_review_queue` AND create a new DNA (never block ingestion).
- **< 0.5** → fall through to create-new.

**For a duplicate pair to exercise Tier 2, it MUST miss Tier 1.** That means: the two records cannot share an exact email OR an exact phone. They can share email *domain* (different local parts) without triggering Tier 1, and they can share phone *prefix* (different last 3-4 digits). What they MUST share is enough fuzzy signal — typo'd names, abbreviated addresses, etc. — to score above the floor.

The four cases the upstream Checkpoint 1 requires (per `in-flight-work/organic-intelligence-phase-2.md` in the upstream repo). The upstream doc's wording for (a) is imprecise — "Joe Smith / Joseph Smith differ by one character" is wrong (they differ by 4 characters; that's a nickname case, not a typo). The intent covers **two distinct sub-cases**, both of which `mutateName` should produce:

| # | Case | Examples | What it tests |
|---|---|---|---|
| (a1) | **Nickname variant** (multi-char delta, same person) | "Joe Smith" ↔ "Joseph Smith"; "Liz Brown" ↔ "Elizabeth Brown" | Jaro-Winkler fuzzy name match across a table-known nickname |
| (a2) | **Single-character typo** | "John Smith" ↔ "Jon Smith"; "Jane Smyth" ↔ "Jane Smith" | Jaro-Winkler fuzzy name match on Levenshtein-1 |
| (b)  | **Address abbreviation** | "123 Main Street" ↔ "123 Main St."; "456 Oak Avenue" ↔ "456 Oak Ave" | Trigram-Jaccard fuzzy address match across normalized abbreviations |
| (c)  | Clean Tier-1-matchable pair (same exact email) | — | Negative control — Tier 1 still works |
| (d)  | Clean no-match pair (different canonicals) | — | Negative control — resolver doesn't over-merge |

(c) and (d) are already produced by today's `dirty.ts` patterns and don't need new work. (a1) + (a2) + (b) are the gap — `mutateName` covers (a1) and (a2); `abbreviateAddress` covers (b).

---

## Scope

### Files you will modify

1. **`src/simulation/dirty.ts`** — add two pure helpers and a fuzzy-duplicate path per platform.
2. **`src/simulation/types.ts`** — extend `DirtyOptions` and `SimulationRunOptions` (the persisted-on-disk shape) with `fuzzy?: boolean`.
3. **`src/commands/simulate.ts`** — pass `fuzzy: options.fuzzy` from `SimulationRunOptions` through to `generateDirtyDatasets`.
4. **`src/routes/simulation.ts`** — extend the Zod `generateBody` schema with `fuzzy: z.boolean().default(false)`.
5. **`frontend/src/lib/types.ts`** — add `fuzzy: boolean` to the run-options type.
6. **`frontend/src/components/RunConfigForm.tsx`** — add a checkbox + state, mirror the existing `fragment` / `duplicate` checkboxes.
7. **`frontend/src/components/RunsList.tsx`** — append ` · fuzzy` when the flag is true (mirrors the existing `fragment` / `duplicate` display).
8. **`test/unit/simulation/dirty.test.ts`** — new test cases (see below).

### Files you will NOT touch

- **Grader code** (`src/simulation/report.ts`, `csv-parser.ts`, uploaders). Tier 2 outcomes naturally fold into the existing `MergeStatus` semantics — auto-merged Tier 2 → `fully_merged`, review-band Tier 2 → `under_merged` (correctly: the canonical's records are split across DNAs because human review hasn't happened). No grader changes needed.
- **CSV format.** `tier` / `confidence` live in JSONB on the upstream `oi.dna_records.raw_record_refs` — verified upstream via direct SQL inspection, not via this repo's grader.
- **`oi.match_review_queue`** is invisible to the grader by design. Upstream verifies queue rows via SQL.

---

## Design

### New helpers (in `src/simulation/dirty.ts`)

```ts
/**
 * Mutate a name to produce a Tier-2-fuzzy variant of the original.
 *
 * Strategy (random per rng draw):
 *   - Nickname swap: Joe ↔ Joseph, Liz ↔ Elizabeth, Bob ↔ Robert, etc.
 *     If the name is in the nickname table, swap to its partner.
 *   - Single-char Levenshtein typo: insert / delete / substitute one char.
 *     Used when no nickname match exists.
 *
 * Deterministic given the same rng state. Returns first OR last (whichever
 * was mutated) for telemetry; the caller composes the new first+last.
 */
function mutateName(
  first: string,
  last: string,
  rng: Rng,
): { first: string; last: string };

/**
 * Mutate an address to produce a Tier-2-fuzzy variant.
 *
 * Strategy: swap the street suffix between its long form and its
 * abbreviation. Street ↔ St., Avenue ↔ Ave., Boulevard ↔ Blvd.,
 * Drive ↔ Dr., Road ↔ Rd., Lane ↔ Ln., Court ↔ Ct.
 *
 * If the address has no recognizable suffix, falls back to dropping the
 * trailing period (or adding one) — still a trigram-perturbing mutation.
 * Other fields (city, state, zip) are preserved.
 */
function abbreviateAddress(
  addr: DirtyContact['address'],
  rng: Rng,
): DirtyContact['address'];
```

**Nickname table (use a small, hand-curated set; pull from the v3 doc's `§2.7` reference):**

```ts
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
  // Keep this small. We're not trying to be canonical — we're trying to
  // produce a recognizable nickname case for Checkpoint 1 inspection.
};
```

The lookup is case-insensitive but the returned name preserves the original casing pattern (capitalize first letter).

**Street-type table:**

```ts
const STREET_TYPES: Array<[long: string, short: string]> = [
  ['street', 'st'],
  ['avenue', 'ave'],
  ['boulevard', 'blvd'],
  ['drive', 'dr'],
  ['road', 'rd'],
  ['lane', 'ln'],
  ['court', 'ct'],
];
```

The mutator detects either form (with or without trailing period) and swaps to the other.

### Per-platform fuzzy duplicate slots

Extend `PlatformConfig` with a third optional generator:

```ts
interface PlatformConfig {
  fragment: (person: CanonicalPerson, rng: Rng) => Partial<DirtyContact>[];
  duplicate: (person: CanonicalPerson, rng: Rng) => Partial<DirtyContact>[];
  duplicateRate: number;
  /** New (this session). Only invoked when DirtyOptions.fuzzy is true. */
  fuzzyDuplicate: (person: CanonicalPerson, rng: Rng) => Partial<DirtyContact>[];
  /** New. Probability a record gets a fuzzy duplicate when fuzzy is enabled. */
  fuzzyDuplicateRate: number;
}
```

**The contract for `fuzzyDuplicate`:** emits one duplicate record that **misses Tier 1** (different exact email + different exact phone from the original) and **shares enough fuzzy signal** to land in the Tier 2 bands. Each platform's variant picks ONE of the two mutation strategies (name OR address) so the grader's `dnaBreakdown` clearly shows what bridged the records.

Suggested per-platform shape (you can refine — these are the simplest defensible defaults):

```ts
// Stripe — name-typo variant. Same email domain, different local part;
// drop phone so Tier 1 can't match by phone either.
stripe.fuzzyDuplicate = (person, rng) => {
  const mutated = mutateName(person.firstName, person.lastName, rng);
  return [
    {
      firstName: mutated.first,
      lastName: mutated.last,
      email: mutateEmailLocalPart(person.email, rng), // same @domain
      phone: null,
    },
  ];
};

// HubSpot — address-abbreviation variant. Same email domain, different
// local part; same name; address suffix mutated.
hubspot.fuzzyDuplicate = (person, rng) => ({
  email: mutateEmailLocalPart(person.email, rng),
  phone: null,
  address: abbreviateAddress(person.address, rng),
});

// Shopify — combined: name nickname AND address abbreviation. Different
// email entirely (different domain), no phone.
shopify.fuzzyDuplicate = (person, rng) => {
  const mutated = mutateName(person.firstName, person.lastName, rng);
  return [
    {
      firstName: mutated.first,
      lastName: mutated.last,
      email: `${mutated.first.toLowerCase()}.${rng() * 10000 | 0}@example.com`,
      phone: null,
      address: abbreviateAddress(person.address, rng),
    },
  ];
};
```

**Helper you'll need:** `mutateEmailLocalPart(email, rng)` — splits on `@`, appends a numeric suffix to the local part, preserves the domain. Distinct from the existing `mutateEmail` (which appends a suffix but keeps the domain — exactly what we want; verify in `dirty.ts` and reuse if possible). On inspection it looks like the existing `mutateEmail` already does the right thing — same domain, mutated local part. Reuse it.

### Wiring

In `buildPlatformRecords`, after the existing `isDuplicated` block, add a parallel `isFuzzyDuplicated` block:

```ts
for (const person of answerKey) {
  const isDuplicated = options.duplicate && rng() < config.duplicateRate;
  const variants = isDuplicated ? config.duplicate(person, rng) : [{}];

  // NEW: fuzzy duplicates run independently of the existing duplicate
  // path. A record can be both — same canonical, two duplicate variants:
  // one Tier-1-style (same exact email), one Tier-2-style (fuzzy).
  const fuzzyVariants =
    options.fuzzy && rng() < config.fuzzyDuplicateRate
      ? config.fuzzyDuplicate(person, rng)
      : [];

  for (const variant of [...variants, ...fuzzyVariants]) {
    const fragment = options.fragment ? config.fragment(person, rng)[0] : {};
    const record = makeRecord(person, { ...fragment, ...variant });
    out.push(ensureContactable(record, { email: person.email, phone: person.phone }));
  }
}
```

**Note on `ensureContactable`:** today it backfills email when both email and phone are null. After this change, a fuzzy duplicate that nulls phone but has a valid (mutated-local-part) email is fine — `ensureContactable` won't touch it. Verify by reading the function before shipping.

**`fuzzyDuplicateRate` default**: 0.15 per platform is reasonable. At `small` dataset size (10 canonicals), that yields ~1-2 fuzzy duplicates per platform — enough to trigger Tier 2 in the upstream smoke without flooding the queue.

### Persisting the flag

`SimulationRunOptions` is persisted to `meta.json` so the run is reproducible. Add `fuzzy?: boolean` there too. Existing runs without the flag continue to work — treat absent as `false`.

### Frontend

Mirror the `fragment` / `duplicate` patterns exactly. New `fuzzy` checkbox in `RunConfigForm.tsx` (defaults to `false` for backward compat; the user opts in for Tier-2 smoke runs). `RunsList.tsx` displays ` · fuzzy` if true. Frontend types get the bool.

---

## Tests (in `test/unit/simulation/dirty.test.ts`)

Add a new `describe('fuzzy duplicates')` block. Mirror the existing `duplicate` test shapes:

1. **`fuzzy: false` produces zero fuzzy variants.** Generate with `fuzzy: false`, fixed seed. Assert the output is identical to a `fuzzy: undefined` run.
2. **`fuzzy: true` produces fuzzy variants for some canonicals.** Generate with `fuzzy: true`, fixed seed. Assert at least one record exists where:
   - `email` differs from the canonical's email but shares the `@domain`
   - `phone` is null OR differs from the canonical's phone
   - At least one of: `firstName` differs from canonical, OR `lastName` differs, OR `address.street` differs
3. **Determinism with seed.** Two runs with the same seed produce identical fuzzy outputs.
4. **Helpers tested in isolation:**
   - `mutateName('Joe', 'Smith', rng)` returns a recognizable variant. Test the nickname-table hits (Joe → Joseph) and a typo case (input not in nickname table — produces a single-character edit).
   - `abbreviateAddress({street: '123 Main Street', ...})` produces `'123 Main St'` (or `'123 Main St.'`); the reverse direction works too. Other fields (city, state, zip) are untouched.

Keep the test count modest — these are deterministic helpers, not stochastic search. ~5-7 new tests total is right.

---

## Constraints & conventions

- **CJS-compatible code** — see `CLAUDE.md` in this repo. Don't import ESM-only libs.
- **No new npm dependencies** — `mutateName` and `abbreviateAddress` are pure-TS. If you're tempted to pull in a nickname or Levenshtein library, don't; hand-roll it.
- **Deterministic given `rng`** — every new helper threads through the `mulberry32` Rng. No `Math.random()`, no `Date.now()` in helper logic.
- **Mocha + Chai** for tests — match the existing test style in `dirty.test.ts`.
- **Path aliases** — use `@/` etc. consistent with the codebase.
- **TypeScript strict** — no `any` in production code.

---

## Sanity checks before reporting done

1. `npm run typecheck` exits 0.
2. `npm run lint` exits 0 with no new warnings.
3. `npm test` passes (existing 51+ tests stay green; new tests pass).
4. `npm run build` exits 0 (tsc + tsc-alias).
5. `npm run build:frontend` exits 0.
6. Spot-check the round-trip: start the dev server, generate a `small` run with `fuzzy: true` checked, inspect `simulation-runs/<runId>/stripe-dirty.json` and `hubspot-dirty.json` for canonicals with multiple records where the second has same-domain different-local-part email + mutated name or address.

---

## What's NOT in scope (don't drift)

- **Tier 3 cases** (RAG / pgvector / LLM judgment) — separate phase upstream. No work here.
- **Grader changes** — Tier 2 grades naturally via the existing `MergeStatus` machinery.
- **CSV format extensions** — `tier` / `confidence` are inspected via direct SQL upstream.
- **Review-queue visibility** — `oi.match_review_queue` is a separate concern; upstream verifies via SQL.
- **Tuning the Tier 2 score thresholds** — those live in the upstream `tier-2-fuzzy.ts`. This session produces inputs; tuning is upstream's Session 6.
- **Mitosis fixtures** — deferred upstream.

---

## When you're done

Reply with:
- Files modified (paths).
- Test count delta (before / after).
- Any deviations from this prompt (with rationale).
- A 3-line "how to verify" recipe Johnny can run to confirm the fuzzy flag produces the intended shapes.

No commit, no push — Johnny handles those.
