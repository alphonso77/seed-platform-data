# Simulation grading pipeline

A map of the files involved in checking simulation results against the answer key, in the order data flows through them.

## Core grading logic

The actual comparison happens here:

- **`src/simulation/report.ts`** — `generateReport()` is the comparison engine. Joins three things:
  - `answerKey` (canonical persons — the ground truth)
  - `uploadMapping` (what was sent to platforms, with externalIds tied to canonicalIds)
  - `oiRows` (parsed OI CSV with externalId → dnaRecordId)

  Decides per-canonical `MergeStatus` (`fully_merged` / `under_merged` / `over_merged` / `missing`) and per-record pass/fail.

If you want to understand the grading, **start here**. Every other file feeds inputs into it or persists its output.

`summary.precision` and `summary.recall` are pairwise metrics over upload mappings: for each pair of records, the grader scores agreement between same-canonical and same-DNA. Useful for tracking aggregate resolver quality across runs even when individual canonicals' statuses haven't changed.

## `MergeStatus` semantics

| Status | Meaning | Typical resolver bug class |
|---|---|---|
| `fully_merged` | All of a canonical's records share one DNA, and no other canonical shares it | — |
| `under_merged` | A canonical's records are split across >1 DNA | Resolver too conservative; missed a marker; cross-marker conflict (FS-7) |
| `deferred_review` | Split across >1 DNA, but every split is joined by an `oi.match_review_queue` row that is `pending` or `approved` (either direction: a raw record in one DNA queued against another of the canonical's DNAs). Not a pass and not a fail; reported as "deferred". Needs enrichment (below) | Tier 2 score landed in the review band instead of auto-merge |
| `over_merged` | This canonical's DNA is shared with at least one other canonical | Resolver too aggressive; marker collision across people |
| `missing` | Canonical has 0 mapping entries, OR fewer records reached OI than were uploaded, OR none have a `dna_record_id` | Ingestion failure; resolver dropped the record |

A split whose only queue row was `rejected` stays `under_merged`; the row is still listed in `reviewPairs` so a reader can see the pair was queued and turned down. `summary.recall` is strict; `summary.recallWithDeferred` counts pending/approved queue pairs as merged. `summary.reviewQueueChecked` is false when the run has no enrichment, and `deferredReview` is then always 0.

For `under_merged`, `deferred_review` and `over_merged` canonicals, the report adds a `dnaBreakdown` field that groups the canonical's records by their landing DNA, with the email/phone markers extracted from each row's raw payload — so a reader can see which marker bridged each record without joining tables manually.

## Inputs the comparison consumes

- **`src/simulation/answer-key.ts`** — `generateAnswerKey()` builds the canonical persons.
- **`src/simulation/csv-parser.ts`** — `parseOiResultCsv()` turns the uploaded OI CSV into `OiResultRow[]`.
- **`src/simulation/uploaders/{stripe,hubspot,shopify}-uploader.ts`** — produce the upload mapping (canonicalId → internalId → externalId), persisted to `upload-result.json`. The mapping is the only place the answer key meets platform records: records carry the run id and seeded tags, never a canonical or internal id, because FratelliSoftware copies Stripe metadata, HubSpot custom properties and Shopify tags into the Data Lake (FS-361). Records seeded before this change still carry `canonical_id` until they are cleaned and seeded again. HubSpot contacts are created one per request (four at a time) since the batch API's answers can't be matched back without such a tag.
- **`src/simulation/dirty.ts`** — `generateDirtyDatasets()` produces the per-platform fragmentation + duplication patterns the answer key gets exercised against. **HubSpot's duplicate emits a mutated email + matching phone** — that's the pattern that exposes cross-marker resolver bugs (resolver sees email_A→DNA-1, phone_X→DNA-2, and may silently pick one).

## Reading results: email domains are stronger evidence here than in production

The answer key gives every person their own random domain (`firstname.lastname@{8 hex of a uuid}.example.com`), and every canonical and Tier 1 record keeps it, so outside fuzzy duplicates no two people in a run share an email domain. (Shopify fuzzy duplicates use plain `example.com`, which they share across people; Stripe and HubSpot fuzzy duplicates keep the person's domain.) In the sim, `email_domain` agreement therefore identifies a person almost on its own. In production a shared domain usually means "same company" (or a free-mail provider) and says little about identity. A merge in the sim that rests mainly on domain agreement (e.g. a Tier 2 fuzzy record with a mutated local part, no phone and no address) is weak evidence that the resolver would make the same call correctly on real data.

## Enrichment: review queue and resolution reasons

The OI CSV does not carry review-queue rows or why each record landed where it did. `npm run cli -- simulate-enrich <runId> [--logs <file>]` fetches both, saves them as `oi-enrichment.json` in the run folder (data only, never connection details), and regenerates the report. Later report runs, including from the UI, reuse the saved file.

- **Review queue + resolution columns (DB).** Read from the FratelliSoftware dev Postgres. Inject the URL per invocation; it must not be stored in `.env` (the command refuses if it is):

  ```bash
  # from a directory linked to the FratelliSoftware Railway project
  railway run -s Postgres -e development -- sh -c \
    'cd ~/seed-platform-data && OI_DATABASE_URL="$DATABASE_PUBLIC_URL" npm run cli -- simulate-enrich <runId>'
  ```

  `src/simulation/oi-db.ts` refuses any host:port not in `DEV_OI_DATABASE_HOSTS` (an allowlist, not a "not production" check), runs every query inside `BEGIN TRANSACTION READ ONLY` that is always rolled back, and scopes queries to the CSV's org_id and the run's raw/DNA ids. Per-record resolutions come from `oi.raw_records.first_resolution_*` / `last_resolution_*` / `resolution_count` when those columns exist.
- **Resolution reasons (worker logs, fallback).** For runs before those columns existed, save the workers' `oi.resolution.resolved` events and pass them with `--logs`:

  ```bash
  railway logs -s workers -e development --filter oi.resolution.resolved -n 3000 > resolved.log
  ```

  The log must reach back to the run's first resolutions. OI re-resolves records on later polls (and resets `resolved_at` when it does), so the importer takes each record's **earliest** event as the placing resolution and the last as its current state; it does not use the event nearest the CSV's `resolved_at`. DB values win over log values for the same record.

The report shows each record's first resolution (tier, action, and `via` / `reason` / score), its `resolved_at`, and how many times OI resolved it. Sorting a split canonical's records by `resolved_at` shows ordering effects, e.g. a fuzzy record resolving with `no_candidates` before any sibling existed.

## Orchestration

- **`src/commands/simulate.ts`** — `runReport(runId)` loads `answerKey`, `upload-result.json`, the OI CSV and `oi-enrichment.json` (if present), calls `generateReport()`, persists `report.json` + `report.csv`. `runEnrich(runId, …)` builds `oi-enrichment.json` and then calls `runReport`.
- **`src/simulation/run-store.ts`** — file I/O for run artifacts (answer-key, dirty data, upload-result, oi-result, report).

## Types

- **`src/simulation/types.ts`** — `CanonicalPerson`, `UploadMappingEntry`, `OiResultRow`, `RecordResult`, `CanonicalResult`, `Report`, `MergeStatus`.

## Tests

- **`test/unit/simulation/report.test.ts`** — exercises `generateReport()` directly with crafted answer-key + mapping + OI input, including review-queue grading.
- **`test/unit/simulation/oi-db.test.ts`** — dev-host allowlist.
- **`test/unit/simulation/resolution-log.test.ts`** — worker-log parsing and first/latest selection.
- **`test/unit/simulation/answer-key.test.ts`** — answer-key generation invariants.
- **`test/unit/simulation/csv-parser.test.ts`** — OI CSV parsing.
- **`test/unit/simulation/run-store.test.ts`** — artifact persistence.
- **`test/unit/simulation/commands.test.ts`** — end-to-end of `runGenerate` → `runUpload` → `runReport`.
