import { expect } from 'chai';
import { assertDevOiDatabaseUrl, OiDatabaseRefusedError } from '../../../src/simulation/oi-db';

describe('simulation/oi-db assertDevOiDatabaseUrl', () => {
  it('accepts the allowlisted dev proxy host and port', () => {
    expect(() => assertDevOiDatabaseUrl('postgresql://u:secret@shinkansen.proxy.rlwy.net:29513/railway')).not.to.throw();
  });

  it('refuses the same proxy domain on another port (another Railway database)', () => {
    expect(() => assertDevOiDatabaseUrl('postgresql://u:secret@shinkansen.proxy.rlwy.net:40000/railway'))
      .to.throw(OiDatabaseRefusedError, /not in the dev allowlist/);
  });

  it('refuses query parameters, which pg would let override the allowlisted host/port', () => {
    expect(() => assertDevOiDatabaseUrl(
      'postgresql://u:secret@shinkansen.proxy.rlwy.net:29513/railway?host=prod.example.com&port=5432',
    )).to.throw(OiDatabaseRefusedError);
    expect(() => assertDevOiDatabaseUrl('postgresql://u:secret@shinkansen.proxy.rlwy.net:29513/railway?host=prod.example.com'))
      .to.throw(OiDatabaseRefusedError);
    expect(() => assertDevOiDatabaseUrl('postgresql://u:secret@shinkansen.proxy.rlwy.net:29513/railway?sslmode=require'))
      .to.throw(OiDatabaseRefusedError, /query parameters/);
  });

  it('refuses internal hosts and non-postgres URLs', () => {
    expect(() => assertDevOiDatabaseUrl('postgresql://u:secret@postgres.railway.internal:5432/railway'))
      .to.throw(OiDatabaseRefusedError);
    expect(() => assertDevOiDatabaseUrl('https://shinkansen.proxy.rlwy.net:29513/')).to.throw(OiDatabaseRefusedError);
    expect(() => assertDevOiDatabaseUrl('not a url')).to.throw(OiDatabaseRefusedError);
  });

  it('never echoes the password in the refusal message', () => {
    try {
      assertDevOiDatabaseUrl('postgresql://u:hunter2@prod.example.com:5432/railway');
      expect.fail('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.to.contain('hunter2');
    }
  });
});
