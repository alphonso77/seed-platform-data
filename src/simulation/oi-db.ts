import { Client } from 'pg';
import { parse as parsePgConnectionString } from 'pg-connection-string';
import { RecordResolution, ResolutionOutcome, ReviewQueueEdge } from '@/simulation/types';

/**
 * The only databases the harness may read: the FratelliSoftware dev Postgres
 * public proxy (Railway `Postgres` service, `development` environment). An
 * allowlist rather than a "not production" check, so a new or renamed host
 * is refused until someone adds it here on purpose.
 */
export const DEV_OI_DATABASE_HOSTS: readonly string[] = ['shinkansen.proxy.rlwy.net:29513'];

export class OiDatabaseRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OiDatabaseRefusedError';
  }
}

/**
 * Throws unless `url` points at an allowlisted dev host. Never echoes
 * credentials. The allowlist runs on what pg will actually connect to
 * (pg-connection-string's parse), not the URL authority: pg lets `?host=` /
 * `?port=` override the authority, so any query string is refused outright.
 */
export function assertDevOiDatabaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OiDatabaseRefusedError('OI_DATABASE_URL is not a valid URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new OiDatabaseRefusedError(`OI_DATABASE_URL must be a postgres URL (got ${parsed.protocol})`);
  }
  if (parsed.search !== '') {
    throw new OiDatabaseRefusedError('OI_DATABASE_URL must not carry query parameters');
  }
  let target: ReturnType<typeof parsePgConnectionString>;
  try {
    target = parsePgConnectionString(url);
  } catch {
    // Its TypeError carries the full input (password included) in `input`.
    throw new OiDatabaseRefusedError('OI_DATABASE_URL could not be parsed as a connection string');
  }
  const hostPort = `${target.host ?? ''}:${target.port || '5432'}`;
  if (!DEV_OI_DATABASE_HOSTS.includes(hostPort)) {
    throw new OiDatabaseRefusedError(
      `Refusing OI database ${hostPort}: not in the dev allowlist (${DEV_OI_DATABASE_HOSTS.join(', ')})`,
    );
  }
}

export interface OiDatabaseSnapshot {
  reviewQueue: ReviewQueueEdge[];
  /** Null when `oi.raw_records` has no resolution_* columns yet. */
  resolutions: Record<string, RecordResolution> | null;
}

const OUTCOME_FIELDS = ['tier', 'action', 'via', 'reason', 'score'] as const;
// first_* is written once (the placing resolution), last_* on every resolve.
const RESOLUTION_COLUMNS = [
  ...OUTCOME_FIELDS.map((f) => `first_resolution_${f}`),
  'first_resolved_at',
  ...OUTCOME_FIELDS.map((f) => `last_resolution_${f}`),
  'resolution_count',
];

/**
 * Read the review-queue rows and (when the columns exist) persisted
 * resolution outcomes for one run's records. Runs inside a READ ONLY
 * transaction that is always rolled back, so a bug here cannot write.
 */
export async function fetchOiDatabaseSnapshot(
  url: string,
  scope: { orgId: string; rawRecordIds: string[]; dnaRecordIds: string[] },
): Promise<OiDatabaseSnapshot> {
  assertDevOiDatabaseUrl(url);
  // Fail rather than hang the surrounding `railway run` if the proxy is down.
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  try {
    await client.connect();
  } catch (error) {
    // pg's connect errors can carry the connection target; keep only the code.
    const code = (error as { code?: string }).code ?? 'unknown';
    throw new Error(`Could not connect to the OI dev database (code ${code})`);
  }
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');

    const queue = await client.query(
      `SELECT id, raw_record_id, candidate_dna_record_id, score, marker_breakdown,
              status, suggested_at, decided_at
         FROM oi.match_review_queue
        WHERE org_id = $1
          AND candidate_dna_record_id IS NOT NULL
          AND (raw_record_id = ANY($2::uuid[]) OR candidate_dna_record_id = ANY($3::uuid[]))`,
      [scope.orgId, scope.rawRecordIds, scope.dnaRecordIds],
    );
    const reviewQueue: ReviewQueueEdge[] = queue.rows.map((r) => ({
      queueId: r.id,
      rawRecordId: r.raw_record_id,
      candidateDnaRecordId: r.candidate_dna_record_id,
      score: Number(r.score),
      markerBreakdown: r.marker_breakdown ?? {},
      status: r.status,
      suggestedAt: toIso(r.suggested_at) ?? '',
      decidedAt: toIso(r.decided_at),
    }));

    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'oi' AND table_name = 'raw_records' AND column_name = ANY($1::text[])`,
      [RESOLUTION_COLUMNS],
    );
    let resolutions: Record<string, RecordResolution> | null = null;
    if (cols.rows.length === RESOLUTION_COLUMNS.length) {
      const res = await client.query(
        `SELECT id, resolved_at, ${RESOLUTION_COLUMNS.join(', ')}
           FROM oi.raw_records
          WHERE org_id = $1 AND id = ANY($2::uuid[]) AND first_resolution_action IS NOT NULL`,
        [scope.orgId, scope.rawRecordIds],
      );
      resolutions = {};
      for (const r of res.rows) {
        const count = r.resolution_count == null ? null : Number(r.resolution_count);
        resolutions[r.id] = {
          source: 'db',
          first: outcome(r, 'first', r.first_resolved_at),
          latest: count != null && count > 1 ? outcome(r, 'last', r.resolved_at) : null,
          count,
        };
      }
    }

    return { reviewQueue, resolutions };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

function outcome(row: Record<string, unknown>, prefix: 'first' | 'last', at: unknown): ResolutionOutcome {
  const col = (f: string) => row[`${prefix}_resolution_${f}`];
  const num = (v: unknown) => (v == null ? null : Number(v));
  const str = (v: unknown) => (v == null ? null : String(v));
  return {
    tier: num(col('tier')),
    action: str(col('action')),
    via: str(col('via')),
    reason: str(col('reason')),
    score: num(col('score')),
    at: toIso(at),
  };
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
