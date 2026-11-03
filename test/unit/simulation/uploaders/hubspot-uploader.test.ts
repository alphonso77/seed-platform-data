import { expect } from 'chai';
import sinon from 'sinon';
import { HubSpotUploader } from '../../../../src/simulation/uploaders/hubspot-uploader';
import { DirtyContact } from '../../../../src/simulation/types';
import { SEEDED_TAG, SIMULATION_RUN_ID_TAG } from '../../../../src/types';

function record(overrides: Partial<DirtyContact> = {}): DirtyContact {
  return {
    canonicalId: 'canon-1',
    internalId: 'int-1',
    tier: 'canonical',
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

  it('creates one contact per record and maps each to its person', async () => {
    const { uploader, client } = makeUploader();
    const create = sinon.stub(client.crm.contacts.basicApi, 'create');
    create.onFirstCall().resolves({ id: '111' } as never);
    create.onSecondCall().resolves({ id: '222' } as never);

    const records = [
      record({ canonicalId: 'c-A', internalId: 'i-A' }),
      record({ canonicalId: 'c-B', internalId: 'i-B', email: 'b@example.com' }),
    ];
    const { mappings, errors } = await uploader.upload(records, 'run-1');
    expect(errors).to.be.empty;
    expect(mappings).to.have.deep.members([
      { canonicalId: 'c-A', internalId: 'i-A', platform: 'hubspot', externalId: '111' },
      { canonicalId: 'c-B', internalId: 'i-B', platform: 'hubspot', externalId: '222' },
    ]);
    const props = create.firstCall.args[0].properties;
    expect(props[SEEDED_TAG]).to.equal('true');
    expect(props[SIMULATION_RUN_ID_TAG]).to.equal('run-1');
    expect(props.email).to.equal('ada@example.com');
  });

  it('writes no answer-key value into the contact (FS-361)', async () => {
    const { uploader, client } = makeUploader();
    const create = sinon.stub(client.crm.contacts.basicApi, 'create').resolves({ id: '111' } as never);
    await uploader.upload([record({ canonicalId: 'c-A', internalId: 'i-A' })], 'run-1');
    const sent = JSON.stringify(create.firstCall.args[0]);
    expect(sent).to.not.include('c-A');
    expect(sent).to.not.include('i-A');
  });

  it('omits null fields rather than sending null property values', async () => {
    const { uploader, client } = makeUploader();
    const create = sinon.stub(client.crm.contacts.basicApi, 'create').resolves({ id: '111' } as never);
    await uploader.upload([record({ phone: null, address: null })], 'run-2');
    const props = create.firstCall.args[0].properties;
    expect(props).to.not.have.property('phone');
    expect(props).to.not.have.property('city');
    expect(props).to.have.property('email');
  });

  it('records an error for a failed create and keeps going', async () => {
    const { uploader, client } = makeUploader();
    const create = sinon.stub(client.crm.contacts.basicApi, 'create');
    create.callsFake(async (input: { properties: Record<string, string> }) => {
      if (input.properties.email === 'b@example.com') throw new Error('email already exists');
      return { id: 'a1' } as never;
    });
    const records = [
      record({ canonicalId: 'c-A', internalId: 'i-A' }),
      record({ canonicalId: 'c-B', internalId: 'i-B', email: 'b@example.com' }),
    ];
    const { mappings, errors } = await uploader.upload(records, 'run-3');
    expect(create.callCount).to.equal(2);
    expect(mappings).to.deep.equal([
      { canonicalId: 'c-A', internalId: 'i-A', platform: 'hubspot', externalId: 'a1' },
    ]);
    expect(errors).to.have.lengthOf(1);
    expect(errors[0]).to.match(/i-B/);
  });
});
