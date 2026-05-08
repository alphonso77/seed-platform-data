import { expect } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  createRun,
  loadRun,
  loadAnswerKey,
  loadDirty,
  listRuns,
  newRunId,
  writeUploadResult,
  writeOiResult,
  writeReport,
  runDir,
} from '../../../src/simulation/run-store';
import { CanonicalPerson, DirtyDatasets, Report, UploadResult } from '../../../src/simulation/types';

function person(canonicalId: string): CanonicalPerson {
  return {
    canonicalId,
    firstName: 'F',
    lastName: 'L',
    email: `${canonicalId}@example.com`,
    phone: '555',
    company: 'Co',
    jobTitle: 'T',
    address: { street: '1 St', city: 'C', state: 'TX', zip: '0', country: 'US' },
  };
}

describe('simulation/run-store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `sim-run-${crypto.randomBytes(6).toString('hex')}`);
    process.env.SIMULATION_DIR = tmpDir;
  });

  afterEach(async () => {
    delete process.env.SIMULATION_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('newRunId is filesystem-safe (no colons or dots)', () => {
    const id = newRunId(new Date('2026-05-08T12:34:56.789Z'));
    expect(id).to.equal('2026-05-08T12-34-56-789Z');
  });

  it('createRun writes meta + answer-key + three dirty files and returns the summary', async () => {
    const runId = newRunId();
    const answerKey = [person('c1'), person('c2')];
    const dirty: DirtyDatasets = {
      stripe: [],
      hubspot: [],
      shopify: [],
    };

    const summary = await createRun({
      runId,
      options: { size: 'small', fragment: false, duplicate: false },
      answerKey,
      dirty,
    });

    expect(summary.runId).to.equal(runId);
    expect(summary.stage).to.equal('generated');
    expect(summary.counts.answerKey).to.equal(2);

    const dir = runDir(runId);
    const files = await fs.readdir(dir);
    expect(files).to.include.members([
      'meta.json',
      'answer-key.json',
      'stripe-dirty.json',
      'hubspot-dirty.json',
      'shopify-dirty.json',
    ]);

    const loaded = await loadRun(runId);
    expect(loaded?.counts.answerKey).to.equal(2);

    const loadedKey = await loadAnswerKey(runId);
    expect(loadedKey).to.have.lengthOf(2);

    const loadedDirty = await loadDirty(runId);
    expect(loadedDirty).to.deep.equal(dirty);
  });

  it('advances stage as each artifact is written', async () => {
    const runId = newRunId();
    await createRun({
      runId,
      options: { size: 'small', fragment: false, duplicate: false },
      answerKey: [person('c1')],
      dirty: { stripe: [], hubspot: [], shopify: [] },
    });

    const upload: UploadResult = {
      runId,
      uploadedAt: new Date().toISOString(),
      mappings: [],
      errors: [],
    };
    await writeUploadResult(runId, upload);
    expect((await loadRun(runId))?.stage).to.equal('uploaded');

    await writeOiResult(runId, 'header,row\n1,2\n');
    expect((await loadRun(runId))?.stage).to.equal('oi-uploaded');

    const report: Report = {
      runId,
      generatedAt: new Date().toISOString(),
      summary: {
        canonicalCount: 1,
        fullyMerged: 1,
        underMerged: 0,
        overMerged: 0,
        missing: 0,
        recordsTotal: 1,
        recordsPassed: 1,
        recordsFailed: 0,
        precision: 1,
        recall: 1,
      },
      canonicals: [],
      records: [],
    };
    await writeReport(runId, report, 'a,b\n');
    expect((await loadRun(runId))?.stage).to.equal('reported');
  });

  it('listRuns returns runs sorted newest first', async () => {
    const a = '2026-05-07T10-00-00-000Z';
    const b = '2026-05-08T10-00-00-000Z';
    for (const id of [a, b]) {
      await createRun({
        runId: id,
        options: { size: 'small', fragment: false, duplicate: false },
        answerKey: [],
        dirty: { stripe: [], hubspot: [], shopify: [] },
      });
    }
    const runs = await listRuns();
    expect(runs.map((r) => r.runId)).to.deep.equal([b, a]);
  });

  it('listRuns returns empty when SIMULATION_DIR does not exist', async () => {
    const runs = await listRuns();
    expect(runs).to.deep.equal([]);
  });
});
