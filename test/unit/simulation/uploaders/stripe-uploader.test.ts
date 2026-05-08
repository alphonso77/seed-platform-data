import { expect } from 'chai';
import sinon from 'sinon';
import { StripeUploader } from '../../../../src/simulation/uploaders/stripe-uploader';
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

interface StripeStub {
  customers: { create: sinon.SinonStub };
  balance: { retrieve: sinon.SinonStub };
}

function makeUploader(): { uploader: StripeUploader; stripe: StripeStub } {
  const uploader = new StripeUploader({ platform: 'stripe', apiKey: 'sk_test_abc' });
  const stripe = (uploader as unknown as { stripe: StripeStub }).stripe;
  return { uploader, stripe };
}

describe('StripeUploader.upload', () => {
  afterEach(() => sinon.restore());

  it('stamps SEEDED_TAG, simulation_run_id, and canonical_id in metadata', async () => {
    const { uploader, stripe } = makeUploader();
    const create = sinon
      .stub(stripe.customers, 'create')
      .resolves({ id: 'cus_x' } as never);

    const { mappings, errors } = await uploader.upload([record()], 'run-A');
    expect(errors).to.be.empty;
    expect(mappings).to.deep.equal([
      { canonicalId: 'canon-1', internalId: 'int-1', platform: 'stripe', externalId: 'cus_x' },
    ]);

    const params = create.firstCall.args[0];
    expect(params.metadata?.[SEEDED_TAG]).to.equal('true');
    expect(params.metadata?.[SIMULATION_RUN_ID_TAG]).to.equal('run-A');
    expect(params.metadata?.[CANONICAL_ID_TAG]).to.equal('canon-1');
    expect(params.email).to.equal('ada@example.com');
    expect(params.phone).to.equal('(415) 555-1212');
  });

  it('omits email/phone when the dirty record has them null (fragmentation)', async () => {
    const { uploader, stripe } = makeUploader();
    const create = sinon.stub(stripe.customers, 'create').resolves({ id: 'cus_y' } as never);

    await uploader.upload([record({ email: null })], 'run-B');
    const params = create.firstCall.args[0];
    expect(params.email).to.be.undefined;
    expect(params.phone).to.equal('(415) 555-1212');
  });

  it('captures per-record errors and continues uploading the rest', async () => {
    const { uploader, stripe } = makeUploader();
    sinon
      .stub(stripe.customers, 'create')
      .onFirstCall()
      .rejects(new Error('rate limited'))
      .onSecondCall()
      .resolves({ id: 'cus_ok' } as never);

    const { mappings, errors } = await uploader.upload(
      [record({ internalId: 'int-fail' }), record({ internalId: 'int-ok' })],
      'run-C',
    );
    expect(mappings).to.have.lengthOf(1);
    expect(mappings[0].internalId).to.equal('int-ok');
    expect(errors).to.have.lengthOf(1);
    expect(errors[0]).to.match(/int-fail/);
    expect(errors[0]).to.match(/rate limited/);
  });
});
