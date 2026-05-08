# Grading update spec

Minimal updates the grader needs after an E2E test against fratellisoftware exposed a
real OI resolver bug (cross-marker conflict — see fratellisoftware Jira FS-7) that the
current report flags as `under_merged` but offers no diagnostic detail to confirm.

The grader already produces the right verdict on this bug. The gaps are: (a) `docs/grading.md`
is out of date and (b) the report doesn't include the one piece of evidence a human needs
to recognize *why* a canonical under-merged.

Two changes. Stay minimal.

---

## 1. Refresh `docs/grading.md`

Current state: the doc lists `report.ts`, `answer-key.ts`, `csv-parser.ts`, `uploaders/`,
`simulate.ts`, `run-store.ts`, `types.ts`. It does NOT mention `dirty.ts`, the four
`MergeStatus` values, or the precision/recall pairwise metric.

Add the following (inline edits, not a rewrite):

- Under **Inputs the comparison consumes**, add a bullet:
  > **`src/simulation/dirty.ts`** — `generateDirtyDatasets()` produces the per-platform
  > fragmentation + duplication patterns the answer key gets exercised against.
  > **HubSpot's duplicate emits a mutated email + matching phone** — that's the pattern
  > that exposes cross-marker resolver bugs (resolver sees email_A→DNA-1, phone_X→DNA-2,
  > and may silently pick one).

- New section after **Core grading logic**, **`MergeStatus` semantics**:
  > | Status | Meaning | Typical resolver bug class |
  > |---|---|---|
  > | `fully_merged` | All of a canonical's records share one DNA, and no other canonical shares it | — |
  > | `under_merged` | A canonical's records are split across >1 DNA | Resolver too conservative; missed a marker; cross-marker conflict (FS-7) |
  > | `over_merged` | This canonical's DNA is shared with at least one other canonical | Resolver too aggressive; marker collision across people |
  > | `missing` | Canonical has 0 mapping entries, OR fewer records reached OI than were uploaded, OR none have a `dna_record_id` | Ingestion failure; resolver dropped the record |

- New paragraph at the end of **Core grading logic**:
  > `summary.precision` and `summary.recall` are pairwise metrics over upload mappings:
  > for each pair of records, the grader scores agreement between same-canonical and
  > same-DNA. Useful for tracking aggregate resolver quality across runs even when
  > individual canonicals' statuses haven't changed.

That's the entire doc update.

---

## 2. Add `dnaBreakdown` to non-passing canonicals in the report

**Why:** a canonical reported as `under_merged` currently gives you `dnaRecordIds: [d1, d2]`
and a flat `records[]` list. To diagnose, a human has to manually group records by
`dnaRecordId` and look up their markers. The data is all there in `OiResultRow.rawPayload`
(already parsed by `csv-parser.ts`); just fold it into the report.

### Type change — `src/simulation/types.ts`

Extend `CanonicalResult`:

```typescript
export interface DnaBreakdownRecord {
  platform: Platform;
  externalId: string;
  internalId: string;
  email: string | null;
  phone: string | null;
}

export interface DnaBreakdownGroup {
  dnaRecordId: string;
  records: DnaBreakdownRecord[];
}

export interface CanonicalResult {
  canonicalId: string;
  mergeStatus: MergeStatus;
  expectedRecords: number;
  foundRecords: number;
  dnaRecordIds: string[];
  /**
   * Populated only for `under_merged` and `over_merged` canonicals (kept off
   * `fully_merged` to keep clean reports compact). Groups the canonical's records
   * by their landing DNA, with markers extracted from the raw payload so a reader
   * can see which marker bridged each record without joining tables manually.
   */
  dnaBreakdown?: DnaBreakdownGroup[];
}
```

### Implementation — `src/simulation/report.ts`

Inside `generateReport()`, build a `Map<string, OiResultRow>` keyed by
`platformKey(sourcePlatform, sourceRecordId)` once (alongside the existing
`mappingByExternal`). Then for every canonical whose `status` is `under_merged` or
`over_merged`, walk its `expected` mapping list, look up the OI row per record,
group by `dnaRecordId`, and extract `email` / `phone` from the row's `rawPayload`
using a small per-platform marker accessor:

```typescript
function extractMarkers(platform: Platform, payload: Record<string, unknown>): { email: string | null; phone: string | null } {
  if (platform === 'hubspot') {
    const props = (payload.properties ?? {}) as Record<string, unknown>;
    return {
      email: stringOrNull(props.email),
      phone: stringOrNull(props.phone) ?? stringOrNull(props.mobilephone),
    };
  }
  // stripe + shopify: top-level email/phone
  return {
    email: stringOrNull(payload.email),
    phone: stringOrNull(payload.phone),
  };
}
```

Mirror the **shape of** fratellisoftware's `src/services/oi/resolution/marker-map.ts`
on the read side — same field paths the resolver uses to extract markers. If the
production marker map widens (a new vendor field), this accessor needs the same
addition. Acceptable maintenance cost given the diagnostic value.

Skip `dnaBreakdown` for canonicals where it would be empty (no found records, or
status is `fully_merged` / `missing` with zero DNAs).

### CSV — no change

The CSV is per-record; the breakdown is per-canonical. Leaving the CSV as-is keeps
its row contract stable. The breakdown lives in `report.json` only.

### Tests — `test/unit/simulation/report.test.ts`

Add one fixture covering the cross-marker conflict pattern (the FS-7 scenario):

- Three uploaded records for one canonical:
  - record A: `email: "a@x.com"`, no phone
  - record B: `email: "b@x.com"` (different), `phone: "+15551234"`
  - record C: `email: "a@x.com"`, `phone: "+15551234"`
- OI rows place A+C on `dna-1`, B on `dna-2`
- Assert: `mergeStatus === 'under_merged'`, `dnaRecordIds.length === 2`,
  `dnaBreakdown` has two groups, each group's records carry the right
  `(email, phone)` pair.

Add one fixture for over_merged with the breakdown populated, and one for
fully_merged that confirms `dnaBreakdown` is `undefined`.

---

## Out of scope (deferred, do not implement here)

- Per-platform breakdown of under/over merges in `Report['summary']`.
- A `reason` column in `report.csv`.
- Deterministic bug-pattern injection in `dirty.ts` (e.g., a "scenarios" mode that
  guarantees at least one cross-marker conflict per run regardless of RNG seed).
- Exporting resolver decision metadata (`tier`, `via`, `ambiguous`) into the OI CSV
  — that's a fratellisoftware-side change, not a grader change.

These each have value but expand the surface area beyond what the FS-7 finding requires.

---

## Acceptance

- `npm run typecheck` and `npm test` pass.
- New fixture in `report.test.ts` exercises the cross-marker pattern and asserts the
  shape of `dnaBreakdown`.
- `docs/grading.md` mentions `dirty.ts`, the four `MergeStatus` values, and the
  precision/recall metric.
- A real run against fratellisoftware dev with the FS-7 bug present produces a
  `report.json` whose `under_merged` canonical clearly shows two DNA groups in
  `dnaBreakdown`, with the conflicting markers visible per-record.
