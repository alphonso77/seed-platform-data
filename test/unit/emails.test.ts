import { expect } from 'chai';
import { generateEmail, generateEmails, resetEmailTracker } from '../../src/generators/emails';

describe('Email Generator', () => {
  beforeEach(() => {
    resetEmailTracker();
  });

  describe('generateEmail', () => {
    it('should generate email with custom domain', () => {
      const email = generateEmail('John', 'Doe', { domains: ['test.com'], domainIndex: 0 });
      expect(email).to.equal('john.doe@test.com');
    });

    it('should use random domains with example.com', () => {
      const email = generateEmail('Jane', 'Smith', { useRandomDomains: true });
      expect(email).to.match(/jane\.smith@[a-f0-9]{8}\.example\.com/);
    });

    it('should fallback to example.com when no domains provided', () => {
      const email = generateEmail('Bob', 'Jones', {});
      expect(email).to.equal('bob.jones@example.com');
    });

    it('should handle collision avoidance', () => {
      const email1 = generateEmail('John', 'Doe', { domains: ['test.com'], domainIndex: 0 });
      const email2 = generateEmail('John', 'Doe', { domains: ['test.com'], domainIndex: 0 });
      expect(email1).to.equal('john.doe@test.com');
      expect(email2).to.not.equal(email1);
      expect(email2).to.match(/john\.doe\d+@test\.com/);
    });

    it('guarantees uniqueness across many same-name collisions', () => {
      const count = 500;
      const seen = new Set<string>();
      for (let i = 0; i < count; i++) {
        seen.add(generateEmail('John', 'Doe', { domains: ['test.com'], domainIndex: 0 }));
      }
      expect(seen.size).to.equal(count);
    });

    it('should sanitize names', () => {
      const email = generateEmail("O'Brien", 'Mc-Donald', { domains: ['test.com'] });
      expect(email).to.equal('obrien.mcdonald@test.com');
    });
  });

  describe('generateEmails', () => {
    it('should distribute contacts across domains round-robin', () => {
      const contacts = [
        { firstName: 'Alice', lastName: 'One' },
        { firstName: 'Bob', lastName: 'Two' },
        { firstName: 'Carol', lastName: 'Three' },
      ];
      const emails = generateEmails(contacts, { domains: ['a.com', 'b.com'] });
      expect(emails[0]).to.equal('alice.one@a.com');
      expect(emails[1]).to.equal('bob.two@b.com');
      expect(emails[2]).to.equal('carol.three@a.com');
    });
  });
});
