import { expect } from 'chai';
import { parseResolutionLog, pickResolutions } from '../../../src/simulation/resolution-log';

const ORPHAN = '0b1338da-0b1a-4c3f-814a-4f60f48ca477';
const event = (time: string, payload: Record<string, unknown>) =>
  `${time} [fratellisoftware] \u001b[32minfo\u001b[39m: oi.resolution.resolved ${JSON.stringify(payload)}`;

// The orphan from run 2026-10-12T19-06-07-407Z: created with no_candidates,
// then re-resolved twice by the resync as a Tier 1 self-match.
const LOG = [
  event('2026-10-12 19:06:53', { raw_record_id: ORPHAN, dna_record_id: 'e170', tier: 2, action: 'created', tier2_reason: 'no_candidates' }),
  '2026-10-12 19:06:53 [fratellisoftware] debug: oi.resolution.job_completed {"raw_record_id":"x"}',
  event('2026-10-12 19:21:53', { raw_record_id: ORPHAN, dna_record_id: 'e170', tier: 1, action: 'merged', via: 'email' }),
  JSON.stringify({
    message: event('2026-10-12 19:36:53', { raw_record_id: ORPHAN, dna_record_id: 'e170', tier: 1, action: 'merged', via: 'email' }),
    timestamp: '2026-10-12T19:37:02.05Z',
  }),
  event('2026-10-12 19:06:53', { raw_record_id: 'sib', tier: 2, action: 'review_queued', score: 0.718 }),
].join('\n');

describe('simulation/resolution-log', () => {
  it('parses plain and --json lines, strips ANSI, and skips other events', () => {
    const events = parseResolutionLog(LOG);
    expect(events).to.have.length(4);
    expect(events[0].outcome).to.deep.equal({
      tier: 2, action: 'created', via: null, reason: 'no_candidates', score: null,
      at: '2026-10-12T19:06:53Z',
    });
    expect(events[2].outcome.at).to.equal('2026-10-12T19:36:53Z');
    expect(events[3].outcome.score).to.equal(0.718);
  });

  it('takes the earliest event as the placing resolution and the last as current state', () => {
    // Log order shuffled: the resync line comes first.
    const lines = LOG.split('\n');
    const shuffled = [lines[2], lines[0], lines[3], lines[4]].join('\n');
    const picked = pickResolutions(parseResolutionLog(shuffled), new Set([ORPHAN, 'sib']));
    expect(picked[ORPHAN].first.action).to.equal('created');
    expect(picked[ORPHAN].first.reason).to.equal('no_candidates');
    expect(picked[ORPHAN].latest?.action).to.equal('merged');
    expect(picked[ORPHAN].latest?.at).to.equal('2026-10-12T19:36:53Z');
    expect(picked[ORPHAN].count).to.equal(3);
    expect(picked.sib.first.action).to.equal('review_queued');
    expect(picked.sib.latest).to.be.null;
  });

  it('ignores events for raw records outside the run', () => {
    const picked = pickResolutions(parseResolutionLog(LOG), new Set(['sib']));
    expect(Object.keys(picked)).to.deep.equal(['sib']);
  });
});
