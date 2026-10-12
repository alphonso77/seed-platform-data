import { faker } from '@faker-js/faker';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { GeneratedContact } from '@/types';
import { generateEmail, resetEmailTracker } from '@generators/emails';

// Uses the full ("max") metadata: the default "min" metadata only checks
// length, so NANP numbers in territories (e.g. American Samoa, +1 684) passed
// as valid and Shopify then rejected them with `"phone": ["is invalid"]`.
export function generateValidUSPhone(): string {
  for (let i = 0; i < 25; i++) {
    const candidate = faker.phone.number({ style: 'national' });
    const parsed = parsePhoneNumberFromString(candidate, 'US');
    if (parsed?.isValid() && parsed.country === 'US') return parsed.format('E.164');
  }
  return '+12015550123';
}

export function generateContacts(
  count: number,
  options: { emailDomains?: string[]; useRandomDomains?: boolean }
): GeneratedContact[] {
  resetEmailTracker();
  const contacts: GeneratedContact[] = [];

  for (let i = 0; i < count; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = generateEmail(firstName, lastName, {
      domains: options.emailDomains,
      domainIndex: i,
      useRandomDomains: options.useRandomDomains,
    });

    contacts.push({
      firstName,
      lastName,
      email,
      phone: generateValidUSPhone(),
      company: faker.company.name(),
      jobTitle: faker.person.jobTitle(),
      address: {
        street: faker.location.streetAddress(),
        city: faker.location.city(),
        state: faker.location.state({ abbreviated: true }),
        zip: faker.location.zipCode(),
        country: 'US',
      },
    });
  }

  return contacts;
}
