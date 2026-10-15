import { expect } from 'chai';
import { generateReport, reportToCsv } from '../../../src/simulation/report';
import {
  CanonicalPerson,
  OiResultRow,
  ReviewQueueEdge,
  UploadMappingEntry,
} from '../../../src/simulation/types';

function person(canonicalId: string): CanonicalPerson {
  return {
    canonicalId,
    firstName: `First-${canonicalId}`,
    lastName: 'Last',
    email: `${canonicalId}@example.com`,
    phone: '555-0100',
    company: 'Co',
    jobTitle: 'Tester',
    address: { street: '1 St', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
  };
}

function mapping(
  canonicalId: string,
  internalId: string,
  platform: 'stripe' | 'hubspot' | 'shopify',
  externalId: string,
): UploadMappingEntry {
  return { canonicalId, internalId, platform, externalId };
}

function oiRow(
  rawRecordId: string,
  dnaRecordId: string | null,
  platform: string,
  externalId: string,
  rawPayload: Record<string, unknown> = {},
): OiResultRow {
  return {
    rawRecordId,
    dnaRecordId,
    orgId: 'org',
    sourcePlatform: platform,
    sourceObjectType: 'customers',
    sourceRecordId: externalId,
    ingestedAt: null,
    lastModifiedAt: null,
    resolvedAt: null,
    rawPayload,
  };
}

function queueEdge(
  rawRecordId: string,
  candidateDnaRecordId: string | null,
  status: ReviewQueueEdge['status'],
): ReviewQueueEdge {
  return {
    queueId: `q-${rawRecordId}`,
    rawRecordId,
    candidateDnaRecordId,
    score: 0.718,
    markerBreakdown: { name: 0.958 },
    status,
    suggestedAt: '2026-10-12T19:06:56.000Z',
    decidedAt: status === 'pending' ? null : '2026-10-12T19:07:13.000Z',
  };
}

describe('simulation/report', () => {
  it('marks a canonical fully_merged when all of its records share one dna_record_id', () => {
    const answerKey = [person('c1')];
    const upload: UploadMappingEntry[] = [
      mapping('c1', 'i1', 'stripe', 'cus_1'),
      mapping('c1', 'i2', 'hubspot', 'hs_1'),
    ];
    const oi: OiResultRow[] = [
      oiRow('r1', 'd-shared', 'stripe', 'cus_1'),
      oiRow('r2', 'd-shared', 'hubspot', 'hs_1'),
    ];

    const report = generateReport({ runId: 'run', answerKey, uploadMapping: upload, oiRows: oi });
    expect(report.canonicals[0].mergeStatus).to.equal('fully_merged');
    expect(report.records.every((r) => r.pass)).to.be.true;
    expect(report.summary.fullyMerged).to.equal(1);
    expect(report.summary.recordsPassed).to.equal(2);
    expect(report.summary.precision).to.equal(1);
    expect(report.summary.recall).to.equal(1);
  });

  it('marks a canonical under_merged when its records have multiple dna_record_ids', () => {
    const answerKey = [person('c1')];
    const upload = [
      mapping('c1', 'i1', 'stripe', 'cus_1'),
      mapping('c1', 'i2', 'hubspot', 'hs_1'),
    ];
    const oi = [
      oiRow('r1', 'd-a', 'stripe', 'cus_1'),
      oiRow('r2', 'd-b', 'hubspot', 'hs_1'),
    ];

    const report = generateReport({ runId: 'run', answerKey, uploadMapping: upload, oiRows: oi });
    expect(report.canonicals[0].mergeStatus).to.equal('under_merged');
    expect(report.records.every((r) => !r.pass)).to.be.true;
    expect(report.summary.recall).to.be.lessThan(1);
  });

  it('marks both canonicals over_merged when OI bundles records from different canonicals', () => {
    const answerKey = [person('c1'), person('c2')];
    const upload = [
      mapping('c1', 'i1', 'stripe', 'cus_1'),
      mapping('c2', 'i2', 'stripe', 'cus_2'),
    ];
    const oi = [
      oiRow('r1', 'd-merged', 'stripe', 'cus_1'),
      oiRow('r2', 'd-merged', 'stripe', 'cus_2'),
    ];

    const report = generateReport({ runId: 'run', answerKey, uploadMapping: upload, oiRows: oi });
    expect(report.canonicals.map((c) => c.mergeStatus)).to.deep.equal(['over_merged', 'over_merged']);
    expect(report.records.every((r) => !r.pass)).to.be.true;
    expect(report.summary.precision).to.be.lessThan(1);
  });

  it('marks a canonical missing when OI dropped one of its records', () => {
    const answerKey = [person('c1')];
    const upload = [
      mapping('c1', 'i1', 'stripe', 'cus_1'),
      mapping('c1', 'i2', 'hubspot', 'hs_1'),
    ];
    const oi = [oiRow('r1', 'd-only', 'stripe', 'cus_1')];

    const report = generateReport({ runId: 'run', answerKey, uploadMapping: upload, oiRows: oi });
    expect(report.canonicals[0].mergeStatus).to.equal('missing');
    expect(report.summary.missing).to.equal(1);
  });

  it('ignores OI rows we never uploaded', () => {
    const answerKey = [person('c1')];
    const upload = [mapping('c1', 'i1', 'stripe', 'cus_1')];
    const oi = [
      oiRow('r1', 'd-1', 'stripe', 'cus_1'),
      oiRow('r2', 'd-other', 'stripe', 'cus_unknown'),
    ];

    const report = generateReport({ runId: 'run', answerKey, uploadMapping: upload, oiRows: oi });
    expect(report.canonicals[0].mergeStatus).to.equal('fully_merged');
  });

  it('populates dnaBreakdown with grouped records and markers for an under_merged canonical (FS-7 cross-marker)', () => {
    const answerKey = [person('c1')];
    const upload = [
      mapping('c1', 'i1', 'stripe', 'cus_1'),
      mapping('c1', 'i2', 'hubspot', 'hs_2'),
      mapping('c1', 'i3', 'hubspot', 'hs_3'),
    ];
    const oi = [
      oiRow('r1', 'dna-1', 'stripe', 'cus_1', { email: 'a@x.com' }),
      oiRow('r2', 'dna-2', 'hubspot', 'hs_2', {
        properties: { email: 'b@x.com', phone: '+15551234' },
      }),
      oiRow('r3', 'dna-1', 'hubspot', 'hs_3', {
        properties: { email: 'a@x.com', phone: '+15551234' },
      }),
    ];

    const report = generateReport({ runId: 'run', answerKey, uploadMapping: upload, oiRows: oi });
    const c = report.canonicals[0];
    expect(c.mergeStatus).to.equal('under_merged');
    expect(c.dnaRecordIds).to.have.length(2);
    expect(c.dnaBreakdown).to.exist;
    const breakdown = c.dnaBreakdown!;
    expect(breakdown).to.have.length(2);

    const groupByDna = new Map(breakdown.map((g) => [g.dnaRecordId, g]));
    const dna1 = groupByDna.get('dna-1')!;
    const dna2 = groupByDna.get('dna-2')!;
    expect(dna1.records).to.have.length(2);
    expect(dna2.records).to.have.length(1);

    const dna1ByExternal = new Map(dna1.records.map((r) => [r.externalId, r]));
    expect(dna1ByExternal.get('cus_1')).to.deep.include({
      platform: 'stripe',
      email: 'a@x.com',
      phone: null,
    });
    expect(dna1ByExternal.get('hs_3')).to.deep.include({
      platform: 'hubspot',
      email: 'a@x.com',
      phone: '+15551234',
    });
    expect(dna2.records[0]).to.deep.include({
      platform: 'hubspot',
      externalId: 'hs_2',
      email: 'b@x.com',
      phone: '+15551234',
    });
  });

  it('populates dnaBreakdown for over_merged canonicals', () => {
    const answerKey = [person('c1'), person('c2')];
    const upload = [
      mapping('c1', 'i1', 'stripe', 'cus_1'),
      mapping('c2', 'i2', 'stripe', 'cus_2'),
    ];
    const oi = [
      oiRow('r1', 'd-merged', 'stripe', 'cus_1', { email: 'c1@x.com', phone: '+15550001' }),
      oiRow('r2', 'd-merged', 'stripe', 'cus_2', { email: 'c2@x.com', phone: '+15550002' }),
    ];

    const report = generateReport({ runId: 'run', answerKey, uploadMapping: upload, oiRows: oi });
    expect(report.canonicals.map((c) => c.mergeStatus)).to.deep.equal(['over_merged', 'over_merged']);
    for (const c of report.canonicals) {
      expect(c.dnaBreakdown).to.exist;
      expect(c.dnaBreakdown!).to.have.length(1);
      expect(c.dnaBreakdown![0].dnaRecordId).to.equal('d-merged');
      expect(c.dnaBreakdown![0].records).to.have.length(1);
    }
  });

  it('omits dnaBreakdown for fully_merged canonicals', () => {
    const answerKey = [person('c1')];
    const upload = [
      mapping('c1', 'i1', 'stripe', 'cus_1'),
      mapping('c1', 'i2', 'hubspot', 'hs_1'),
    ];
    const oi = [
      oiRow('r1', 'd-shared', 'stripe', 'cus_1', { email: 'c1@x.com' }),
      oiRow('r2', 'd-shared', 'hubspot', 'hs_1', { properties: { email: 'c1@x.com' } }),
    ];

    const report = generateReport({ runId: 'run', answerKey, uploadMapping: upload, oiRows: oi });
    expect(report.canonicals[0].mergeStatus).to.equal('fully_merged');
    expect(report.canonicals[0].dnaBreakdown).to.be.undefined;
  });

  it('computes pairwise precision and recall correctly for a mixed scenario', () => {
    // c1: 2 records, properly merged. c2: 2 records, split across 2 dna ids (recall miss).
    const answerKey = [person('c1'), person('c2')];
    const upload = [
      mapping('c1', 'i1', 'stripe', 'cus_1'),
      mapping('c1', 'i2', 'hubspot', 'hs_1'),
      mapping('c2', 'i3', 'stripe', 'cus_2'),
      mapping('c2', 'i4', 'hubspot', 'hs_2'),
    ];
    const oi = [
      oiRow('r1', 'd-c1', 'stripe', 'cus_1'),
      oiRow('r2', 'd-c1', 'hubspot', 'hs_1'),
      oiRow('r3', 'd-c2a', 'stripe', 'cus_2'),
      oiRow('r4', 'd-c2b', 'hubspot', 'hs_2'),
    ];

    const report = generateReport({ runId: 'run', answerKey, uploadMapping: upload, oiRows: oi });
    // pairs (i1,i2) — same canonical, same dna → TP
    // pairs (i3,i4) — same canonical, diff dna → FN
    // pairs across canonicals — none share a dna → no FPs
    // precision = 1 / 1 = 1; recall = 1 / (1+1) = 0.5
    expect(report.summary.precision).to.equal(1);
    expect(report.summary.recall).to.equal(0.5);
  });

  describe('review queue (deferred_review)', () => {
    // Mireille shape: three records merged in d-main, the fuzzy orphan alone
    // in d-orphan. The queue row hangs off a sibling (r1) scored against the
    // orphan's DNA.
    const answerKey = [person('c1')];
    const upload = [
      mapping('c1', 'i1', 'stripe', 'cus_1'),
      mapping('c1', 'i2', 'hubspot', 'hs_1'),
      mapping('c1', 'i3', 'stripe', 'cus_fuzzy'),
    ];
    const oi = [
      oiRow('r1', 'd-main', 'stripe', 'cus_1'),
      oiRow('r2', 'd-main', 'hubspot', 'hs_1'),
      oiRow('r3', 'd-orphan', 'stripe', 'cus_fuzzy'),
    ];

    it('grades a split joined by a pending queue row as deferred_review, with the row attached', () => {
      const edge = queueEdge('r1', 'd-orphan', 'pending');
      const report = generateReport({ runId: 'run', answerKey, uploadMapping: upload, oiRows: oi, reviewQueue: [edge] });
      expect(report.canonicals[0].mergeStatus).to.equal('deferred_review');
      expect(report.canonicals[0].reviewPairs).to.deep.equal([edge]);
      expect(report.summary.deferredReview).to.equal(1);
      expect(report.summary.underMerged).to.equal(0);
      expect(report.summary.recordsFailed).to.equal(0);
      expect(report.summary.recordsDeferred).to.equal(3);
      expect(report.summary.reviewQueueChecked).to.be.true;
      expect(report.summary.recall).to.be.below(1);
      expect(report.summary.recallWithDeferred).to.equal(1);
      expect(reportToCsv(report)).to.contain(',deferred_review,deferred');
    });

    it('matches the queue row in the other direction (orphan raw record scored against the main DNA)', () => {
      const report = generateReport({
        runId: 'run', answerKey, uploadMapping: upload, oiRows: oi,
        reviewQueue: [queueEdge('r3', 'd-main', 'approved')],
      });
      expect(report.canonicals[0].mergeStatus).to.equal('deferred_review');
    });

    it('keeps a split under_merged when its only queue row was rejected, but still lists the row', () => {
      const edge = queueEdge('r1', 'd-orphan', 'rejected');
      const report = generateReport({ runId: 'run', answerKey, uploadMapping: upload, oiRows: oi, reviewQueue: [edge] });
      expect(report.canonicals[0].mergeStatus).to.equal('under_merged');
      expect(report.canonicals[0].reviewPairs).to.deep.equal([edge]);
      expect(report.summary.recallWithDeferred).to.equal(report.summary.recall);
    });

    it('keeps a three-way split under_merged when the queue joins only two of the DNAs', () => {
      const report = generateReport({
        runId: 'run',
        answerKey,
        uploadMapping: upload,
        oiRows: [oi[0], oiRow('r2', 'd-third', 'hubspot', 'hs_1'), oi[2]],
        reviewQueue: [queueEdge('r1', 'd-orphan', 'pending')],
      });
      expect(report.canonicals[0].mergeStatus).to.equal('under_merged');
    });

    it('ignores queue rows linking to DNAs of other canonicals', () => {
      const report = generateReport({
        runId: 'run', answerKey, uploadMapping: upload, oiRows: oi,
        reviewQueue: [queueEdge('r1', 'd-someone-else', 'pending')],
      });
      expect(report.canonicals[0].mergeStatus).to.equal('under_merged');
      expect(report.canonicals[0].reviewPairs).to.be.undefined;
    });

    it('does not join unrelated splits through pending rows whose candidate DNA is null', () => {
      // Two people, each split; each has a pending row whose candidate DNA was
      // deleted. Unioning on null would make both "deferred".
      const report = generateReport({
        runId: 'run',
        answerKey: [person('c1'), person('c2')],
        uploadMapping: [
          mapping('c1', 'i1', 'stripe', 'cus_1'),
          mapping('c1', 'i2', 'hubspot', 'hs_1'),
          mapping('c2', 'i3', 'stripe', 'cus_2'),
          mapping('c2', 'i4', 'hubspot', 'hs_2'),
        ],
        oiRows: [
          oiRow('r1', 'd-1a', 'stripe', 'cus_1'),
          oiRow('r2', 'd-1b', 'hubspot', 'hs_1'),
          oiRow('r3', 'd-2a', 'stripe', 'cus_2'),
          oiRow('r4', 'd-2b', 'hubspot', 'hs_2'),
        ],
        reviewQueue: [
          queueEdge('r1', null, 'pending'),
          queueEdge('r2', null, 'pending'),
          queueEdge('r3', null, 'pending'),
          queueEdge('r4', null, 'pending'),
        ],
      });
      expect(report.canonicals.map((c) => c.mergeStatus)).to.deep.equal(['under_merged', 'under_merged']);
      expect(report.summary.deferredReview).to.equal(0);
      expect(report.canonicals.every((c) => c.reviewPairs === undefined)).to.be.true;
      expect(report.summary.recallWithDeferred).to.equal(report.summary.recall);
    });

    it('reports reviewQueueChecked false when no queue data was supplied', () => {
      const report = generateReport({ runId: 'run', answerKey, uploadMapping: upload, oiRows: oi });
      expect(report.canonicals[0].mergeStatus).to.equal('under_merged');
      expect(report.summary.reviewQueueChecked).to.be.false;
      expect(report.summary.deferredReview).to.equal(0);
    });
  });
});
