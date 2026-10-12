import { RecordResolution, ResolutionOutcome } from '@/simulation/types';

const EVENT = 'oi.resolution.resolved';
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const LINE_TIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/;

interface ResolvedEvent {
  rawRecordId: string;
  outcome: ResolutionOutcome;
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
    if (line.startsWith('{')) {
      try {
        const wrapped = JSON.parse(line) as { message?: unknown };
        if (typeof wrapped.message !== 'string') continue;
        line = wrapped.message;
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
    // The workers' logger stamps lines in UTC without a zone marker.
    const time = LINE_TIME.exec(line);
    events.push({
      rawRecordId: payload.raw_record_id,
      outcome: {
        tier: typeof payload.tier === 'number' ? payload.tier : null,
        action: typeof payload.action === 'string' ? payload.action : null,
        via: typeof payload.via === 'string' ? payload.via : null,
        reason: typeof payload.tier2_reason === 'string' ? payload.tier2_reason : null,
        score: typeof payload.score === 'number' ? payload.score : null,
        at: time ? `${time[1]}T${time[2]}Z` : null,
      },
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
  const byRecord = new Map<string, ResolutionOutcome[]>();
  for (const { rawRecordId, outcome } of events) {
    if (!runRawRecordIds.has(rawRecordId)) continue;
    const list = byRecord.get(rawRecordId) ?? [];
    list.push(outcome);
    byRecord.set(rawRecordId, list);
  }
  const out: Record<string, RecordResolution> = {};
  for (const [rawRecordId, outcomes] of byRecord) {
    // Stable sort keeps log order for equal (second-precision) timestamps.
    const sorted = [...outcomes].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
    out[rawRecordId] = {
      source: 'log',
      first: sorted[0],
      latest: sorted.length > 1 ? sorted[sorted.length - 1] : null,
      count: sorted.length,
    };
  }
  return out;
}
