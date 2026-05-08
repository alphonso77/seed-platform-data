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
| `over_merged` | This canonical's DNA is shared with at least one other canonical | Resolver too aggressive; marker collision across people |
| `missing` | Canonical has 0 mapping entries, OR fewer records reached OI than were uploaded, OR none have a `dna_record_id` | Ingestion failure; resolver dropped the record |

For `under_merged` and `over_merged` canonicals, the report adds a `dnaBreakdown` field that groups the canonical's records by their landing DNA, with the email/phone markers extracted from each row's raw payload — so a reader can see which marker bridged each record without joining tables manually.

## Inputs the comparison consumes

- **`src/simulation/answer-key.ts`** — `generateAnswerKey()` builds the canonical persons.
- **`src/simulation/csv-parser.ts`** — `parseOiResultCsv()` turns the uploaded OI CSV into `OiResultRow[]`.
- **`src/simulation/uploaders/{stripe,hubspot,shopify}-uploader.ts`** — produce the upload mapping (canonicalId → internalId → externalId), persisted to `upload-result.json`.
- **`src/simulation/dirty.ts`** — `generateDirtyDatasets()` produces the per-platform fragmentation + duplication patterns the answer key gets exercised against. **HubSpot's duplicate emits a mutated email + matching phone** — that's the pattern that exposes cross-marker resolver bugs (resolver sees email_A→DNA-1, phone_X→DNA-2, and may silently pick one).

## Orchestration

- **`src/commands/simulate.ts`** — `runReport(runId)` loads `answerKey`, `upload-result.json`, and the OI CSV, calls `generateReport()`, persists `report.json` + `report.csv`.
- **`src/simulation/run-store.ts`** — file I/O for run artifacts (answer-key, dirty data, upload-result, oi-result, report).

## Types

- **`src/simulation/types.ts`** — `CanonicalPerson`, `UploadMappingEntry`, `OiResultRow`, `RecordResult`, `CanonicalResult`, `Report`, `MergeStatus`.

## Tests

- **`test/unit/simulation/report.test.ts`** — exercises `generateReport()` directly with crafted answer-key + mapping + OI input.
- **`test/unit/simulation/answer-key.test.ts`** — answer-key generation invariants.
- **`test/unit/simulation/csv-parser.test.ts`** — OI CSV parsing.
- **`test/unit/simulation/run-store.test.ts`** — artifact persistence.
- **`test/unit/simulation/commands.test.ts`** — end-to-end of `runGenerate` → `runUpload` → `runReport`.
