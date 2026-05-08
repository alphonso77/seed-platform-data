import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  readContactsCache,
  writeContactsCache,
  getContactsCacheStatus,
  loadOrGenerateContacts,
  ContactsCache,
} from '../../src/utils/dataset-cache';
import { GeneratedContact, SeedOptions } from '../../src/types';
import logger from '../../src/utils/logger';

function makeContact(i: number): GeneratedContact {
  return {
    firstName: `First${i}`,
    lastName: `Last${i}`,
    email: `user${i}@example.com`,
    phone: '555-0100',
    company: `Co${i}`,
    jobTitle: 'Tester',
    address: { street: '1 St', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
  };
}

describe('dataset-cache', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `seed-cache-test-${crypto.randomBytes(6).toString('hex')}`);
    process.env.SEED_CACHE_DIR = tmpDir;
  });

  afterEach(async () => {
    delete process.env.SEED_CACHE_DIR;
    sinon.restore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('readContactsCache', () => {
    it('returns null when the cache file is missing', async () => {
      const result = await readContactsCache();
      expect(result).to.be.null;
    });

    it('returns null and logs a warn on malformed JSON', async () => {
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'last.json'), '{ this is not valid json', 'utf8');
      const warn = sinon.stub(logger, 'warn');

      const result = await readContactsCache();

      expect(result).to.be.null;
      expect(warn.calledOnce).to.be.true;
      expect(warn.firstCall.args[0]).to.match(/parse/i);
    });

    it('returns parsed cache when file is valid', async () => {
      const payload: ContactsCache = {
        contacts: [makeContact(0), makeContact(1)],
        generatedAt: '2026-05-07T19:00:00.000Z',
        sourcePlatform: 'hubspot',
        count: 2,
      };
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'last.json'), JSON.stringify(payload), 'utf8');

      const result = await readContactsCache();
      expect(result).to.deep.equal(payload);
    });
  });

  describe('writeContactsCache', () => {
    it('creates the cache directory if missing and writes correct JSON', async () => {
      const payload: ContactsCache = {
        contacts: [makeContact(0)],
        generatedAt: '2026-05-07T19:00:00.000Z',
        sourcePlatform: 'stripe',
        count: 1,
      };

      await writeContactsCache(payload);

      const raw = await fs.readFile(path.join(tmpDir, 'last.json'), 'utf8');
      expect(JSON.parse(raw)).to.deep.equal(payload);
    });
  });

  describe('getContactsCacheStatus', () => {
    it('returns null when no cache file exists', async () => {
      const result = await getContactsCacheStatus();
      expect(result).to.be.null;
    });

    it('returns metadata (without contacts) when cache exists', async () => {
      await writeContactsCache({
        contacts: [makeContact(0), makeContact(1), makeContact(2)],
        generatedAt: '2026-05-07T19:00:00.000Z',
        sourcePlatform: 'shopify',
        count: 3,
      });

      const result = await getContactsCacheStatus();
      expect(result).to.deep.equal({
        generatedAt: '2026-05-07T19:00:00.000Z',
        sourcePlatform: 'shopify',
        count: 3,
      });
    });
  });

  describe('loadOrGenerateContacts', () => {
    const baseOptions: SeedOptions = {
      size: 'small',
      emailDomains: [],
      useRandomDomains: true,
    };

    it('returns cached contacts when reuse=true and cache exists (no fresh generation)', async () => {
      const cached = [makeContact(100), makeContact(101)];
      await writeContactsCache({
        contacts: cached,
        generatedAt: '2026-05-07T19:00:00.000Z',
        sourcePlatform: 'hubspot',
        count: cached.length,
      });

      const result = await loadOrGenerateContacts(25, { ...baseOptions, reuse: true }, 'stripe');

      expect(result).to.deep.equal(cached);
      // Cache file should be untouched (still contains original sourcePlatform 'hubspot')
      const onDisk = JSON.parse(await fs.readFile(path.join(tmpDir, 'last.json'), 'utf8'));
      expect(onDisk.sourcePlatform).to.equal('hubspot');
    });

    it('falls through to fresh generation and writes cache when reuse=true but cache is missing', async () => {
      const warn = sinon.stub(logger, 'warn');

      const result = await loadOrGenerateContacts(5, { ...baseOptions, reuse: true }, 'stripe');

      expect(result).to.have.lengthOf(5);
      // Warn was logged about the fallback
      const warnedFallback = warn.getCalls().some((c) => /reuse/i.test(String(c.args[0])));
      expect(warnedFallback).to.be.true;
      // Cache was written
      const onDisk = JSON.parse(await fs.readFile(path.join(tmpDir, 'last.json'), 'utf8')) as ContactsCache;
      expect(onDisk.count).to.equal(5);
      expect(onDisk.sourcePlatform).to.equal('stripe');
      expect(onDisk.contacts).to.have.lengthOf(5);
    });

    it('always generates and writes cache when reuse=false', async () => {
      // Pre-existing cache should be overwritten with fresh generation.
      await writeContactsCache({
        contacts: [makeContact(999)],
        generatedAt: '2020-01-01T00:00:00.000Z',
        sourcePlatform: 'hubspot',
        count: 1,
      });

      const result = await loadOrGenerateContacts(3, { ...baseOptions, reuse: false }, 'shopify');

      expect(result).to.have.lengthOf(3);
      const onDisk = JSON.parse(await fs.readFile(path.join(tmpDir, 'last.json'), 'utf8')) as ContactsCache;
      expect(onDisk.count).to.equal(3);
      expect(onDisk.sourcePlatform).to.equal('shopify');
      // Old cached contact must be gone.
      expect(onDisk.contacts.find((c) => c.firstName === 'First999')).to.be.undefined;
    });

    it('does NOT write cache on dry run', async () => {
      const result = await loadOrGenerateContacts(
        4,
        { ...baseOptions, dryRun: true },
        'hubspot',
      );

      expect(result).to.have.lengthOf(4);
      // Confirm no file was created.
      let exists = true;
      try {
        await fs.access(path.join(tmpDir, 'last.json'));
      } catch {
        exists = false;
      }
      expect(exists).to.be.false;
    });
  });
});
