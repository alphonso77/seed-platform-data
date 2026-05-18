import { faker } from '@faker-js/faker';
import { v4 as uuidv4 } from 'uuid';

const usedEmails = new Set<string>();

export function resetEmailTracker(): void {
  usedEmails.clear();
}

function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function generateEmail(
  firstName: string,
  lastName: string,
  options: { domains?: string[]; domainIndex?: number; useRandomDomains?: boolean }
): string {
  const first = sanitize(firstName);
  const last = sanitize(lastName);

  let domain: string;
  if (options.useRandomDomains) {
    const uuid8 = uuidv4().slice(0, 8);
    domain = `${uuid8}.example.com`;
  } else if (options.domains && options.domains.length > 0) {
    const idx = options.domainIndex !== undefined ? options.domainIndex % options.domains.length : 0;
    domain = options.domains[idx];
  } else {
    domain = 'example.com';
  }

  let email = `${first}.${last}@${domain}`;

  // Loop until the candidate is unique. The previous one-shot suffix had only
  // 900 buckets, so on runs with ~250+ canonicals two records with the same
  // sanitized name pair could pick the same suffix → identical email → e.g.
  // Shopify rejects the second with 422 "email has already been taken".
  while (usedEmails.has(email)) {
    const suffix = faker.number.int({ min: 100, max: 999999 });
    email = `${first}.${last}${suffix}@${domain}`;
  }

  usedEmails.add(email);
  return email;
}

export function generateEmails(
  contacts: Array<{ firstName: string; lastName: string }>,
  options: { domains?: string[]; useRandomDomains?: boolean }
): string[] {
  return contacts.map((c, i) =>
    generateEmail(c.firstName, c.lastName, {
      domains: options.domains,
      domainIndex: i,
      useRandomDomains: options.useRandomDomains,
    })
  );
}
