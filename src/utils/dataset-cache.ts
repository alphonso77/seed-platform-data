import fs from 'fs/promises';
import path from 'path';
import { GeneratedContact, Platform, SeedOptions } from '@/types';
import { generateContacts } from '@generators/contacts';
import logger from '@utils/logger';

export interface ContactsCache {
  contacts: GeneratedContact[];
  generatedAt: string;
  sourcePlatform: Platform;
  count: number;
}

// SEED_CACHE_DIR env override exists for tests — keeps the cache off shared paths during the run.
function cacheDir(): string {
  return process.env.SEED_CACHE_DIR ?? path.resolve(process.cwd(), '.seed-cache');
}

function cacheFile(): string {
  return path.join(cacheDir(), 'last.json');
}

export async function readContactsCache(): Promise<ContactsCache | null> {
  try {
    const raw = await fs.readFile(cacheFile(), 'utf8');
    try {
      return JSON.parse(raw) as ContactsCache;
    } catch (parseError) {
      logger.warn(
        `[cache] Failed to parse contacts cache, falling back to fresh generation: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      );
      return null;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    logger.warn(
      `[cache] Failed to read contacts cache: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function writeContactsCache(payload: ContactsCache): Promise<void> {
  await fs.mkdir(cacheDir(), { recursive: true });
  await fs.writeFile(cacheFile(), JSON.stringify(payload, null, 2), 'utf8');
}

export async function getContactsCacheStatus(): Promise<Omit<ContactsCache, 'contacts'> | null> {
  try {
    await fs.stat(cacheFile());
  } catch {
    return null;
  }
  const cache = await readContactsCache();
  if (!cache) return null;
  return {
    generatedAt: cache.generatedAt,
    sourcePlatform: cache.sourcePlatform,
    count: cache.count,
  };
}

export async function loadOrGenerateContacts(
  count: number,
  options: SeedOptions,
  sourcePlatform: Platform,
): Promise<GeneratedContact[]> {
  if (options.reuse) {
    const cached = await readContactsCache();
    if (cached) {
      logger.info(
        `[cache] Reusing ${cached.count} contacts from previous seed (${cached.sourcePlatform}, ${cached.generatedAt})`,
      );
      return cached.contacts;
    }
    logger.warn('[cache] --reuse requested but no cache found — falling back to fresh generation');
  }

  const contacts = generateContacts(count, {
    emailDomains: options.emailDomains,
    useRandomDomains: options.useRandomDomains,
  });

  if (!options.dryRun) {
    await writeContactsCache({
      contacts,
      generatedAt: new Date().toISOString(),
      sourcePlatform,
      count: contacts.length,
    });
  }

  return contacts;
}
