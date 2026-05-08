import { expect } from 'chai';
import sinon from 'sinon';
import { HubSpotSeeder } from '../../src/seeders/hubspot-seeder';
import { resetEnv } from '../../src/config/env';

interface SearchResponse {
  results: { id: string }[];
  paging?: { next?: { after: string } };
}

const emptyPage: SearchResponse = { results: [], paging: undefined };

describe('HubSpotSeeder.clean', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnv();
    sinon.restore();
  });

  function makeSeeder(): { seeder: HubSpotSeeder; client: any; apiRequest: sinon.SinonStub } {
    const seeder = new HubSpotSeeder({ platform: 'hubspot', accessToken: 'test-token' });
    sinon.stub(seeder, 'validateEnvironment').resolves({
      platform: 'hubspot',
      isSandbox: true,
      reason: 'test',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (seeder as any).client;
    // Default apiRequest stub: property-existence preflight checks return ok:true.
    // Tests that need a missing property override behavior via withArgs / callsFake.
    const apiRequest = sinon.stub(client, 'apiRequest').resolves({ ok: true, json: async () => ({}) });
    return { seeder, client, apiRequest };
  }

  it('does not call the property-deletion API after clean', async () => {
    const { seeder, client, apiRequest } = makeSeeder();
    const dealsPage: SearchResponse = { results: [{ id: 'd1' }], paging: undefined };
    sinon.stub(client.crm.deals.searchApi, 'doSearch').resolves(dealsPage);
    sinon.stub(client.crm.companies.searchApi, 'doSearch').resolves(emptyPage);
    sinon.stub(client.crm.contacts.searchApi, 'doSearch').resolves(emptyPage);
    sinon.stub(client.crm.deals.batchApi, 'archive').resolves();

    const result = await seeder.clean({ platform: 'hubspot' });

    expect(result.deleted.deals).to.equal(1);
    const propertyDeletes = apiRequest.getCalls().filter((call) => {
      const arg = call.args[0] as { method?: string; path?: string };
      return arg?.method === 'DELETE' && (arg?.path ?? '').includes('/crm/v3/properties/');
    });
    expect(propertyDeletes).to.have.lengthOf(0);
  });

  it('triggers the dealname search path when orphans is true', async () => {
    const { seeder, client } = makeSeeder();
    const dealsSearch = sinon.stub(client.crm.deals.searchApi, 'doSearch').resolves(emptyPage);
    sinon.stub(client.crm.companies.searchApi, 'doSearch').resolves(emptyPage);
    sinon.stub(client.crm.contacts.searchApi, 'doSearch').resolves(emptyPage);

    await seeder.clean({ platform: 'hubspot', orphans: true });

    const dealnameCalls = dealsSearch.getCalls().filter((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filter = (call.args[0] as any)?.filterGroups?.[0]?.filters?.[0];
      return filter?.propertyName === 'dealname' && filter?.value === 'Seed Order';
    });
    expect(dealnameCalls).to.have.lengthOf.at.least(1);
  });

  it('does not trigger the dealname search path when orphans is not set', async () => {
    const { seeder, client } = makeSeeder();
    const dealsSearch = sinon.stub(client.crm.deals.searchApi, 'doSearch').resolves(emptyPage);
    sinon.stub(client.crm.companies.searchApi, 'doSearch').resolves(emptyPage);
    sinon.stub(client.crm.contacts.searchApi, 'doSearch').resolves(emptyPage);

    await seeder.clean({ platform: 'hubspot' });

    const dealnameCalls = dealsSearch.getCalls().filter((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filter = (call.args[0] as any)?.filterGroups?.[0]?.filters?.[0];
      return filter?.propertyName === 'dealname';
    });
    expect(dealnameCalls).to.have.lengthOf(0);
  });

  it('archives orphan deals found by dealname using the batch archive API', async () => {
    const { seeder, client } = makeSeeder();
    const dealsSearch = sinon.stub(client.crm.deals.searchApi, 'doSearch');
    // First call (SEEDED_TAG) returns empty; second call (dealname) returns one deal.
    dealsSearch.onFirstCall().resolves(emptyPage);
    dealsSearch.onSecondCall().resolves({ results: [{ id: 'orphan-1' }], paging: undefined });
    sinon.stub(client.crm.companies.searchApi, 'doSearch').resolves(emptyPage);
    sinon.stub(client.crm.contacts.searchApi, 'doSearch').resolves(emptyPage);
    const archive = sinon.stub(client.crm.deals.basicApi, 'archive').resolves();
    const batchArchive = sinon.stub(client.crm.deals.batchApi, 'archive').resolves();

    const result = await seeder.clean({ platform: 'hubspot', orphans: true });

    expect(archive.called).to.be.false;
    expect(batchArchive.calledOnce).to.be.true;
    expect(batchArchive.firstCall.args[0]).to.deep.equal({ inputs: [{ id: 'orphan-1' }] });
    expect(result.deleted.deals).to.equal(1);
  });

  it('uses the batch archive API for tagged deals (not per-record)', async () => {
    const { seeder, client } = makeSeeder();
    sinon.stub(client.crm.deals.searchApi, 'doSearch').resolves({
      results: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }],
      paging: undefined,
    });
    sinon.stub(client.crm.companies.searchApi, 'doSearch').resolves(emptyPage);
    sinon.stub(client.crm.contacts.searchApi, 'doSearch').resolves(emptyPage);
    const perRecordArchive = sinon.stub(client.crm.deals.basicApi, 'archive').resolves();
    const batchArchive = sinon.stub(client.crm.deals.batchApi, 'archive').resolves();

    const result = await seeder.clean({ platform: 'hubspot' });

    expect(perRecordArchive.called).to.be.false;
    expect(batchArchive.calledOnce).to.be.true;
    expect(batchArchive.firstCall.args[0]).to.deep.equal({
      inputs: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }],
    });
    expect(result.deleted.deals).to.equal(3);
  });

  it('skips the batch archive call when a search page is empty', async () => {
    const { seeder, client } = makeSeeder();
    sinon.stub(client.crm.deals.searchApi, 'doSearch').resolves(emptyPage);
    sinon.stub(client.crm.companies.searchApi, 'doSearch').resolves(emptyPage);
    sinon.stub(client.crm.contacts.searchApi, 'doSearch').resolves(emptyPage);
    const dealsArchive = sinon.stub(client.crm.deals.batchApi, 'archive').resolves();
    const companiesArchive = sinon.stub(client.crm.companies.batchApi, 'archive').resolves();
    const contactsArchive = sinon.stub(client.crm.contacts.batchApi, 'archive').resolves();

    await seeder.clean({ platform: 'hubspot' });

    expect(dealsArchive.called).to.be.false;
    expect(companiesArchive.called).to.be.false;
    expect(contactsArchive.called).to.be.false;
  });

  it('skips the deals search and warns when seed_platform_seeded is missing on deals', async () => {
    const { seeder, client, apiRequest } = makeSeeder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiRequest.callsFake(async (req: any) => {
      if (req?.method === 'GET' && req?.path === '/crm/v3/properties/deals/seed_platform_seeded') {
        return { ok: false, status: 404 };
      }
      return { ok: true, json: async () => ({}) };
    });
    const dealsSearch = sinon.stub(client.crm.deals.searchApi, 'doSearch').resolves(emptyPage);
    sinon.stub(client.crm.companies.searchApi, 'doSearch').resolves(emptyPage);
    sinon.stub(client.crm.contacts.searchApi, 'doSearch').resolves(emptyPage);

    const result = await seeder.clean({ platform: 'hubspot' });

    expect(dealsSearch.called).to.be.false;
    expect(result.deleted.deals).to.equal(0);
    expect(result.errors.some((e) => /^Deals:/.test(e))).to.be.false;
  });

  it('still runs orphan recovery when seed_platform_seeded is missing on deals', async () => {
    const { seeder, client, apiRequest } = makeSeeder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiRequest.callsFake(async (req: any) => {
      if (req?.method === 'GET' && req?.path === '/crm/v3/properties/deals/seed_platform_seeded') {
        return { ok: false, status: 404 };
      }
      return { ok: true, json: async () => ({}) };
    });
    const dealsSearch = sinon.stub(client.crm.deals.searchApi, 'doSearch').resolves({
      results: [{ id: 'orphan-1' }],
      paging: undefined,
    });
    sinon.stub(client.crm.companies.searchApi, 'doSearch').resolves(emptyPage);
    sinon.stub(client.crm.contacts.searchApi, 'doSearch').resolves(emptyPage);
    const batchArchive = sinon.stub(client.crm.deals.batchApi, 'archive').resolves();

    const result = await seeder.clean({ platform: 'hubspot', orphans: true });

    // Only the orphan path runs (the SEEDED_TAG path was skipped due to missing property).
    expect(dealsSearch.callCount).to.equal(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter = (dealsSearch.firstCall.args[0] as any)?.filterGroups?.[0]?.filters?.[0];
    expect(filter?.propertyName).to.equal('dealname');
    expect(batchArchive.calledOnce).to.be.true;
    expect(result.deleted.deals).to.equal(1);
    expect(result.errors).to.have.lengthOf(0);
  });
});

describe('HubSpotSeeder.seed', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetEnv();
    sinon.restore();
  });

  function makeSeeder(): { seeder: HubSpotSeeder; client: any } {
    const seeder = new HubSpotSeeder({ platform: 'hubspot', accessToken: 'test-token' });
    sinon.stub(seeder, 'validateEnvironment').resolves({
      platform: 'hubspot',
      isSandbox: true,
      reason: 'test',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (seeder as any).client;
    // ensureCustomProperties uses apiRequest GET — returning ok:true short-circuits the create path.
    sinon.stub(client, 'apiRequest').resolves({ ok: true, json: async () => ({}) });
    return { seeder, client };
  }

  it('uses batch creates for contacts, companies, and deals (happy path)', async () => {
    const { seeder, client } = makeSeeder();
    const contactsBatch = sinon
      .stub(client.crm.contacts.batchApi, 'create')
      .callsFake(async ({ inputs }: { inputs: unknown[] }) => ({
        results: inputs.map((_, i) => ({ id: `c${i}` })),
      }));
    const companiesBatch = sinon
      .stub(client.crm.companies.batchApi, 'create')
      .callsFake(async ({ inputs }: { inputs: unknown[] }) => ({
        results: inputs.map((_, i) => ({ id: `co${i}` })),
      }));
    const dealsBatch = sinon
      .stub(client.crm.deals.batchApi, 'create')
      .callsFake(async ({ inputs }: { inputs: unknown[] }) => ({
        results: inputs.map((_, i) => ({ id: `d${i}` })),
      }));
    const contactsBasic = sinon.stub(client.crm.contacts.basicApi, 'create');
    const companiesBasic = sinon.stub(client.crm.companies.basicApi, 'create');
    const dealsBasic = sinon.stub(client.crm.deals.basicApi, 'create');

    const result = await seeder.seed({ platform: 'hubspot', size: 'small' });

    expect(contactsBatch.called).to.be.true;
    expect(companiesBatch.called).to.be.true;
    expect(dealsBatch.called).to.be.true;
    // No fallback to per-record on the happy path.
    expect(contactsBasic.called).to.be.false;
    expect(companiesBasic.called).to.be.false;
    expect(dealsBasic.called).to.be.false;
    expect(result.created.contacts).to.equal(25);
    expect(result.created.orders).to.equal(10);
    expect(result.errors).to.have.lengthOf(0);
  });

  it('chunks input into batches of 100', async () => {
    const { seeder, client } = makeSeeder();
    const contactsBatch = sinon
      .stub(client.crm.contacts.batchApi, 'create')
      .callsFake(async ({ inputs }: { inputs: unknown[] }) => ({
        results: inputs.map((_, i) => ({ id: `c${i}` })),
      }));
    sinon
      .stub(client.crm.companies.batchApi, 'create')
      .callsFake(async ({ inputs }: { inputs: unknown[] }) => ({
        results: inputs.map((_, i) => ({ id: `co${i}` })),
      }));
    sinon
      .stub(client.crm.deals.batchApi, 'create')
      .callsFake(async ({ inputs }: { inputs: unknown[] }) => ({
        results: inputs.map((_, i) => ({ id: `d${i}` })),
      }));

    // medium = 250 contacts → ceil(250/100) = 3 batches
    await seeder.seed({ platform: 'hubspot', size: 'medium' });

    expect(contactsBatch.callCount).to.equal(3);
    const sizes = contactsBatch.getCalls().map((call) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((call.args[0] as any).inputs as unknown[]).length;
    });
    expect(sizes).to.deep.equal([100, 100, 50]);
  });

  it('falls back to per-record creates when the contacts batch fails', async () => {
    const { seeder, client } = makeSeeder();
    sinon.stub(client.crm.contacts.batchApi, 'create').rejects(new Error('batch failure'));
    const perRecordCreate = sinon
      .stub(client.crm.contacts.basicApi, 'create')
      .resolves({ id: 'c-fallback' });
    sinon
      .stub(client.crm.companies.batchApi, 'create')
      .callsFake(async ({ inputs }: { inputs: unknown[] }) => ({
        results: inputs.map((_, i) => ({ id: `co${i}` })),
      }));
    sinon
      .stub(client.crm.deals.batchApi, 'create')
      .callsFake(async ({ inputs }: { inputs: unknown[] }) => ({
        results: inputs.map((_, i) => ({ id: `d${i}` })),
      }));

    const result = await seeder.seed({ platform: 'hubspot', size: 'small' });

    // 25 contacts in one batch — when the batch fails, all 25 are retried per-record.
    expect(perRecordCreate.callCount).to.equal(25);
    expect(result.created.contacts).to.equal(25);
    expect(result.errors).to.have.lengthOf(0);
  });

  it('records per-record errors into the errors array when fallback creates also fail', async () => {
    const { seeder, client } = makeSeeder();
    sinon.stub(client.crm.contacts.batchApi, 'create').rejects(new Error('batch failure'));
    sinon.stub(client.crm.contacts.basicApi, 'create').rejects(new Error('record failure'));
    sinon
      .stub(client.crm.companies.batchApi, 'create')
      .callsFake(async ({ inputs }: { inputs: unknown[] }) => ({
        results: inputs.map((_, i) => ({ id: `co${i}` })),
      }));
    sinon
      .stub(client.crm.deals.batchApi, 'create')
      .callsFake(async ({ inputs }: { inputs: unknown[] }) => ({
        results: inputs.map((_, i) => ({ id: `d${i}` })),
      }));

    const result = await seeder.seed({ platform: 'hubspot', size: 'small' });

    expect(result.created.contacts).to.equal(0);
    expect(result.errors).to.have.lengthOf(25);
    expect(result.errors[0]).to.match(/^Contact .+: record failure$/);
  });
});
