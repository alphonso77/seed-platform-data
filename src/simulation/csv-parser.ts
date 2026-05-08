import { parse } from 'csv-parse/sync';
import { OiResultRow } from '@/simulation/types';

const REQUIRED_COLUMNS = [
  'raw_record_id',
  'dna_record_id',
  'org_id',
  'source_platform',
  'source_object_type',
  'source_record_id',
  'ingested_at',
  'last_modified_at',
  'resolved_at',
  'raw_payload',
] as const;

interface RawRow {
  raw_record_id: string;
  dna_record_id: string;
  org_id: string;
  source_platform: string;
  source_object_type: string;
  source_record_id: string;
  ingested_at: string;
  last_modified_at: string;
  resolved_at: string;
  raw_payload: string;
}

export class OiCsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OiCsvParseError';
  }
}

export function parseOiResultCsv(input: Buffer | string): OiResultRow[] {
  let rows: RawRow[];
  try {
    rows = parse(input, {
      columns: true,
      skip_empty_lines: true,
      trim: false,
      relax_quotes: true,
    }) as RawRow[];
  } catch (error) {
    throw new OiCsvParseError(
      `Failed to parse OI CSV: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (rows.length === 0) return [];

  const missing = REQUIRED_COLUMNS.filter((col) => !(col in rows[0]));
  if (missing.length > 0) {
    throw new OiCsvParseError(`OI CSV is missing required columns: ${missing.join(', ')}`);
  }

  return rows.map((row, index) => {
    const ingestedAt = stripWrappingQuotes(row.ingested_at);
    const lastModifiedAt = stripWrappingQuotes(row.last_modified_at);
    const resolvedAt = stripWrappingQuotes(row.resolved_at);

    let rawPayload: Record<string, unknown>;
    try {
      rawPayload = row.raw_payload ? (JSON.parse(row.raw_payload) as Record<string, unknown>) : {};
    } catch (error) {
      throw new OiCsvParseError(
        `Row ${index + 1}: invalid JSON in raw_payload — ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      rawRecordId: row.raw_record_id,
      dnaRecordId: row.dna_record_id ? row.dna_record_id : null,
      orgId: row.org_id,
      sourcePlatform: row.source_platform,
      sourceObjectType: row.source_object_type,
      sourceRecordId: row.source_record_id,
      ingestedAt: ingestedAt || null,
      lastModifiedAt: lastModifiedAt || null,
      resolvedAt: resolvedAt || null,
      rawPayload,
    };
  });
}

// The example CSV wraps timestamp columns in extra double-quotes (e.g. `"""2026-05-08T..."""`).
// csv-parse strips one layer of CSV quoting; the JSON-style quoted ISO string remains.
function stripWrappingQuotes(value: string): string {
  if (!value) return value;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}
