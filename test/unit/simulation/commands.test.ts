import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  runGenerate,
  runUpload,
  runReport,
  runListRuns,
  runGetRun,
  SimulationNotFoundError,
  SimulationStateError,
} from '../../../src/commands/simulate';
import { resetEnv } from '../../../src/config/env';
import { StripeUploader } from '../../../src/simulation/uploaders/stripe-uploader';
import { HubSpotUploader } from '../../../src/simulation/uploaders/hubspot-uploader';
import { ShopifyUploader } from '../../../src/simulation/uploaders/shopify-uploader';
import { runDir } from '../../../src/simulation/run-store';
import { UploadMappingEntry } from '../../../src/simulation/types';

const SANDBOX_ENV: EnvOverrides = {
  STRIPE_SECRET_KEY: 'sk_test_abc',
  HUBSPOT_ACCESS_TOKEN: 'pat-na2-xxx',
  SHOPIFY_ACCESS_TOKEN: 'shpat_xxx',
  SHOPIFY_STORE_DOMAIN: 'dev-store.myshopify.com',
  SKIP_SANDBOX_CHECK_STRIPE: 'true',
  SKIP_SANDBOX_CHECK_HUBSPOT: 'true',
  SKIP_SANDBOX_CHECK_SHOPIFY: 'true',
};

interface EnvOverrides {
  [key: string]: string;
}

describe('commands/simulate', () => {
  let tmpDir: string;
  const originalEnv = process.env;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `sim-cmd-${crypto.randomBytes(6).toString('hex')}`);
    process.env = { ...originalEnv, ...SANDBOX_ENV, SIMULATION_DIR: tmpDir };
    resetEnv();
  });

  afterEach(async () => {
    process.env = originalEnv;
    resetEnv();
    sinon.restore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('runGenerate', () => {
    it('persists a run with answer key, dirty datasets, and meta', async () => {
      const summary = await runGenerate({ size: 'small', fragment: false, duplicate: false });
      expect(summary.stage).to.equal('generated');
      expect(summary.counts.answerKey).to.equal(25);
      expect(summary.counts.stripe).to.equal(25);

      const dir = runDir(summary.runId);
      const files = await fs.readdir(dir);
      expect(files).to.include.members([
        'meta.json',
        'answer-key.json',
        'stripe-dirty.json',
        'hubspot-dirty.json',
        'shopify-dirty.json',
      ]);
    });
  });

  describe('runUpload', () => {
    it('uploads to all 3 platforms and writes upload-result.json', async () => {
      const summary = await runGenerate({ size: 'small', fragment: false, duplicate: false });

      const stripeMappings: UploadMappingEntry[] = [];
      const hubspotMappings: UploadMappingEntry[] = [];
      const shopifyMappings: UploadMappingEntry[] = [];

      sinon.stub(StripeUploader.prototype, 'validateEnvironment').resolves({
        platform: 'stripe', isSandbox: true, reason: 'test',
      });
      sinon.stub(HubSpotUploader.prototype, 'validateEnvironment').resolves({
        platform: 'hubspot', isSandbox: true, reason: 'test',
      });
      sinon.stub(ShopifyUploader.prototype, 'validateEnvironment').resolves({
        platform: 'shopify', isSandbox: true, reason: 'test',
      });

      const stripeUploadStub = sinon.stub(StripeUploader.prototype, 'upload').callsFake(async (records) => {
        records.forEach((r, i) => stripeMappings.push({
          canonicalId: r.canonicalId, internalId: r.internalId, platform: 'stripe', externalId: `cus_${i}`,
        }));
        return { mappings: stripeMappings.slice(), errors: [] };
      });
      const hubspotUploadStub = sinon.stub(HubSpotUploader.prototype, 'upload').callsFake(async (records) => {
        records.forEach((r, i) => hubspotMappings.push({
          canonicalId: r.canonicalId, internalId: r.internalId, platform: 'hubspot', externalId: `${i + 1000}`,
        }));
        return { mappings: hubspotMappings.slice(), errors: [] };
      });
      const shopifyUploadStub = sinon.stub(ShopifyUploader.prototype, 'upload').callsFake(async (records) => {
        records.forEach((r, i) => shopifyMappings.push({
          canonicalId: r.canonicalId, internalId: r.internalId, platform: 'shopify', externalId: `${i + 9000}`,
        }));
        return { mappings: shopifyMappings.slice(), errors: [] };
      });

      const result = await runUpload(summary.runId);
      expect(stripeUploadStub.calledOnce).to.be.true;
      expect(hubspotUploadStub.calledOnce).to.be.true;
      expect(shopifyUploadStub.calledOnce).to.be.true;
      expect(result.mappings).to.have.lengthOf(75); // 25 per platform
      expect(result.errors).to.be.empty;

      const reloaded = await runGetRun(summary.runId);
      expect(reloaded.summary.stage).to.equal('uploaded');
      expect(reloaded.upload?.mappings).to.have.lengthOf(75);
    });

    it('throws SimulationNotFoundError when runId does not exist', async () => {
      try {
        await runUpload('does-not-exist');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(SimulationNotFoundError);
      }
    });
  });

  describe('runReport', () => {
    it('produces a fully_merged report when OI groups every record correctly', async () => {
      const summary = await runGenerate({ size: 'small', fragment: false, duplicate: false });

      // Synthesize an upload-result + OI CSV manually to bypass the upload step.
      const answerKeyJson = await fs.readFile(path.join(runDir(summary.runId), 'answer-key.json'), 'utf8');
      const stripeJson = await fs.readFile(path.join(runDir(summary.runId), 'stripe-dirty.json'), 'utf8');
      const stripeDirty = JSON.parse(stripeJson) as Array<{ canonicalId: string; internalId: string }>;
      const answerKey = JSON.parse(answerKeyJson) as Array<{ canonicalId: string }>;

      const mappings: UploadMappingEntry[] = stripeDirty.map((r, i) => ({
        canonicalId: r.canonicalId,
        internalId: r.internalId,
        platform: 'stripe',
        externalId: `cus_${i}`,
      }));

      await fs.writeFile(
        path.join(runDir(summary.runId), 'upload-result.json'),
        JSON.stringify({
          runId: summary.runId,
          uploadedAt: new Date().toISOString(),
          mappings,
          errors: [],
        }),
      );

      const csvLines = [
        'raw_record_id,dna_record_id,org_id,source_platform,source_object_type,source_record_id,ingested_at,last_modified_at,resolved_at,raw_payload',
        ...mappings.map((m, i) => `r${i},dna-${m.canonicalId},org,stripe,customers,${m.externalId},,,,"{}"`),
      ];
      await fs.writeFile(path.join(runDir(summary.runId), 'oi-result.csv'), csvLines.join('\n'));

      const report = await runReport(summary.runId);
      expect(report.summary.canonicalCount).to.equal(answerKey.length);
      expect(report.summary.fullyMerged).to.equal(answerKey.length);
      expect(report.summary.recordsPassed).to.equal(mappings.length);
    });

    it('throws SimulationStateError when OI CSV not uploaded yet', async () => {
      const summary = await runGenerate({ size: 'small', fragment: false, duplicate: false });
      // Write a stub upload-result so we get past that check.
      await fs.writeFile(
        path.join(runDir(summary.runId), 'upload-result.json'),
        JSON.stringify({ runId: summary.runId, uploadedAt: 'x', mappings: [], errors: [] }),
      );
      try {
        await runReport(summary.runId);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(SimulationStateError);
      }
    });
  });

  describe('runListRuns', () => {
    it('returns the list of all generated runs newest-first', async () => {
      const a = await runGenerate({ size: 'small', fragment: false, duplicate: false });
      // Force a different runId by waiting a bit so the ISO timestamp differs.
      await new Promise((r) => setTimeout(r, 5));
      const b = await runGenerate({ size: 'small', fragment: false, duplicate: false });
      const runs = await runListRuns();
      expect(runs.map((r) => r.runId)).to.deep.equal([b.runId, a.runId]);
    });
  });
});
