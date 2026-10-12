import { RecordResolution, ResolutionOutcome } from '@/simulation/types';

const EVENT = 'oi.resolution.resolved';
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const LINE_TIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/;

interface ResolvedEvent {
  rawRecordId: string;
  outcome: ResolutionOutcome;
  /** Railway's ingest time (ms) from `--json` lines; only breaks same-second ties. */
  ingestedAt: string | null;
}

/**
 * Parse saved worker logs (`railway logs -s workers -e development --filter
 * oi.resolution.resolved`, plain or `--json`) into resolution events. Lines
 * that are not `oi.resolution.resolved` events are skipped.
 */
export function parseResolutionLog(text: string): ResolvedEvent[] {
  const events: ResolvedEvent[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    // `--json` lines wrap the message and add Railway's ingest timestamp.
    let wrapperTime: string | null = null;
    if (line.startsWith('{')) {
      try {
        const wrapped = JSON.parse(line) as { message?: unknown; timestamp?: unknown };
        if (typeof wrapped.message !== 'string') continue;
        line = wrapped.message;
        if (typeof wrapped.timestamp === 'string' && !Number.isNaN(Date.parse(wrapped.timestamp))) {
          wrapperTime = new Date(wrapped.timestamp).toISOString();
        }
      } catch {
        continue;
      }
    }
    line = line.replace(ANSI, '');
    const idx = line.indexOf(`${EVENT} {`);
    if (idx < 0) continue;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(line.slice(idx + EVENT.length + 1)) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof payload.raw_record_id !== 'string') continue;
    // Event time is the workers' logger stamp (UTC, second precision). The
    // wrapper's timestamp is ingest time, seconds later, so it only orders
    // events that share a second.
    const time = LINE_TIME.exec(line);
    const at = time ? `${time[1]}T${time[2]}Z` : null;
    events.push({
      rawRecordId: payload.raw_record_id,
      outcome: {
        tier: typeof payload.tier === 'number' ? payload.tier : null,
        action: typeof payload.action === 'string' ? payload.action : null,
        via: typeof payload.via === 'string' ? payload.via : null,
        reason: typeof payload.tier2_reason === 'string' ? payload.tier2_reason : null,
        score: typeof payload.score === 'number' ? payload.score : null,
        at,
      },
      ingestedAt: wrapperTime,
    });
  }
  return events;
}

/**
 * Per raw record in the run, take the earliest event as the placing
 * resolution and the last as the current state. Not "the event nearest the
 * CSV's resolved_at": OI resets resolved_at whenever it re-polls a record, so
 * a CSV exported after a poll points at a later Tier 1 self-match. The log
 * must still reach back to the run's first resolution; if retention has
 * dropped it, `first` is wrong, which a `count` of 1 cannot reveal.
 */
export function pickResolutions(
  events: ResolvedEvent[],
  runRawRecordIds: Set<string>,
): Record<string, RecordResolution> {
  const byRecord = new Map<string, ResolvedEvent[]>();
  for (const e of events) {
    if (!runRawRecordIds.has(e.rawRecordId)) continue;
    const list = byRecord.get(e.rawRecordId) ?? [];
    list.push(e);
    byRecord.set(e.rawRecordId, list);
  }
  const out: Record<string, RecordResolution> = {};
  for (const [rawRecordId, recordEvents] of byRecord) {
    // Event second first, then ingest time. Stable sort: plain lines in the
    // same second keep log order, and lines with no timestamp at all ('' sorts
    // first) degrade to log order as well.
    const sorted = [...recordEvents]
      .sort(
        (a, b) =>
          (a.outcome.at ?? '').localeCompare(b.outcome.at ?? '') ||
          (a.ingestedAt ?? '').localeCompare(b.ingestedAt ?? ''),
      )
      .map((e) => e.outcome);
    out[rawRecordId] = {
      source: 'log',
      first: sorted[0],
      latest: sorted.length > 1 ? sorted[sorted.length - 1] : null,
      count: sorted.length,
    };
  }
  return out;
}
