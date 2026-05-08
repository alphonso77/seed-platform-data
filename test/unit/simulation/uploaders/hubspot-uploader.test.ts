import { expect } from 'chai';
import sinon from 'sinon';
import { HubSpotUploader } from '../../../../src/simulation/uploaders/hubspot-uploader';
import { DirtyContact } from '../../../../src/simulation/types';
import {
  SEEDED_TAG,
  SIMULATION_RUN_ID_TAG,
  CANONICAL_ID_TAG,
} from '../../../../src/types';

function record(overrides: Partial<DirtyContact> = {}): DirtyContact {
  return {
    canonicalId: 'canon-1',
    internalId: 'int-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '(415) 555-1212',
    company: 'Analytical Engines',
    jobTitle: 'Mathematician',
    address: {
      street: '1 Augusta Lane',
      city: 'London',
      state: null,
      zip: '11111',
      country: 'GB',
    },
    ...overrides,
  };
}

interface HubSpotClientStub {
  apiRequest: sinon.SinonStub;
  crm: {
    contacts: {
      batchApi: { create: sinon.SinonStub };
      basicApi: { create: sinon.SinonStub };
    };
  };
}

function makeUploader(): { uploader: HubSpotUploader; client: HubSpotClientStub } {
  const uploader = new HubSpotUploader({ platform: 'hubspot', accessToken: 'pat-na2-xxx' });
  const client = (uploader as unknown as { client: HubSpotClientStub }).client;
  // Pretend every property already exists so ensureCustomProperties is a no-op.
  sinon.stub(client, 'apiRequest').resolves({ ok: true } as never);
  return { uploader, client };
}

describe('HubSpotUploader.upload', () => {
  afterEach(() => sinon.restore());

  it('stamps the simulation tags as contact properties and returns mappings in input order', async () => {
    const { uploader, client } = makeUploader();
    const create = sinon
      .stub(client.crm.contacts.batchApi, 'create')
      .resolves({ results: [{ id: '111' }, { id: '222' }] } as never);

    const records = [
      record({ canonicalId: 'c-A', internalId: 'i-A' }),
      record({ canonicalId: 'c-B', internalId: 'i-B', email: 'b@example.com' }),
    ];
    const { mappings, errors } = await uploader.upload(records, 'run-1');
    expect(errors).to.be.empty;
    expect(mappings).to.deep.equal([
      { canonicalId: 'c-A', internalId: 'i-A', platform: 'hubspot', externalId: '111' },
      { canonicalId: 'c-B', internalId: 'i-B', platform: 'hubspot', externalId: '222' },
    ]);

    const inputs = create.firstCall.args[0].inputs;
    expect(inputs[0].properties[SEEDED_TAG]).to.equal('true');
    expect(inputs[0].properties[SIMULATION_RUN_ID_TAG]).to.equal('run-1');
    expect(inputs[0].properties[CANONICAL_ID_TAG]).to.equal('c-A');
    expect(inputs[0].properties.email).to.equal('ada@example.com');
    expect(inputs[1].properties.email).to.equal('b@example.com');
  });

  it('omits null fields rather than sending null property values', async () => {
    const { uploader, client } = makeUploader();
    const create = sinon
      .stub(client.crm.contacts.batchApi, 'create')
      .resolves({ results: [{ id: '111' }] } as never);

    await uploader.upload([record({ phone: null, address: null })], 'run-2');
    const props = create.firstCall.args[0].inputs[0].properties;
    expect(props).to.not.have.property('phone');
    expect(props).to.not.have.property('city');
    expect(props).to.have.property('email');
  });

  it('falls back to per-record create when the batch fails', async () => {
    const { uploader, client } = makeUploader();
    sinon
      .stub(client.crm.contacts.batchApi, 'create')
      .rejects(new Error('batch dedup conflict'));
    const basic = sinon
      .stub(client.crm.contacts.basicApi, 'create')
      .onFirstCall()
      .resolves({ id: 'a1' } as never)
      .onSecondCall()
      .rejects(new Error('email already exists'));

    const records = [
      record({ canonicalId: 'c-A', internalId: 'i-A' }),
      record({ canonicalId: 'c-B', internalId: 'i-B' }),
    ];
    const { mappings, errors } = await uploader.upload(records, 'run-3');
    expect(basic.callCount).to.equal(2);
    expect(mappings).to.deep.equal([
      { canonicalId: 'c-A', internalId: 'i-A', platform: 'hubspot', externalId: 'a1' },
    ]);
    expect(errors).to.have.lengthOf(1);
    expect(errors[0]).to.match(/i-B/);
  });
});
