import { v4 as uuidv4 } from 'uuid';
import { DatasetSize } from '@/types';
import { DATASET_SIZES } from '@config/datasets';
import { generateContacts } from '@generators/contacts';
import { CanonicalPerson } from '@/simulation/types';

export interface AnswerKeyOptions {
  emailDomains?: string[];
  useRandomDomains?: boolean;
}

export function generateAnswerKey(
  size: DatasetSize,
  options: AnswerKeyOptions = {},
): CanonicalPerson[] {
  const count = DATASET_SIZES[size].contacts;
  const contacts = generateContacts(count, {
    emailDomains: options.emailDomains,
    useRandomDomains: options.useRandomDomains ?? true,
  });
  return contacts.map((contact) => ({ ...contact, canonicalId: uuidv4() }));
}
