import { faker } from '@faker-js/faker';
import { GeneratedContact } from '@/types';
import { generateEmail, resetEmailTracker } from '@generators/emails';

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
      phone: faker.phone.number({ style: 'national' }),
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
