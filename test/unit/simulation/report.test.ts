import { expect } from 'chai';
import { generateReport } from '../../../src/simulation/report';
import {
  CanonicalPerson,
  OiResultRow,
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
    rawPayload: {},
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
});
