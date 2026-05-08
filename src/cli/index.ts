#!/usr/bin/env node

import { Command } from 'commander';
import { loadEnv } from '@config/env';
import { Platform, DatasetSize } from '@/types';
import { PLATFORMS } from '@config/platforms';
import { runSeed } from '@commands/seed';
import { runClean } from '@commands/clean';
import { runStatus } from '@commands/status';
import { runValidate } from '@commands/validate';
import {
  formatSeedResult,
  formatCleanResult,
  formatEnvironmentCheck,
  formatStatus,
} from '@cli/formatters';
import { interactiveMenu } from '@cli/menu';

loadEnv();

const program = new Command();

program
  .name('seed-platform-data')
  .description('Seed realistic test data into HubSpot, Stripe, and Shopify sandboxes')
  .version('1.0.0');

function validatePlatform(value: string): Platform {
  if (!PLATFORMS.includes(value as Platform)) {
    throw new Error(`Invalid platform "${value}". Must be one of: ${PLATFORMS.join(', ')}`);
  }
  return value as Platform;
}

program
  .command('seed <platform>')
  .description('Seed test data into a platform')
  .option('-s, --size <size>', 'Dataset size (small, medium, large)', 'small')
  .option('-d, --domains <domains>', 'Comma-separated email domains')
  .option('-r, --random-domains', 'Use random *.example.com domains', false)
  .option('--dry-run', 'Preview without creating data', false)
  .option('--reuse', 'Reuse contacts from the previous seed run (if cached)', false)
  .action(async (platformStr: string, opts) => {
    const platform = validatePlatform(platformStr);
    const size = opts.size as DatasetSize;
    const emailDomains = opts.domains
      ? opts.domains.split(',').map((d: string) => d.trim())
      : [];

    const result = await runSeed(platform, {
      size,
      emailDomains,
      useRandomDomains: opts.randomDomains,
      dryRun: opts.dryRun,
      reuse: opts.reuse,
    });
    console.log(formatSeedResult(result));
  });

program
  .command('clean <platform>')
  .description('Remove seeded data from a platform')
  .option('--dry-run', 'Preview without deleting data', false)
  .option('--orphans', 'Recover orphaned records by name (HubSpot deals only)', false)
  .action(async (platformStr: string, opts) => {
    const platform = validatePlatform(platformStr);
    const result = await runClean(platform, { platform, dryRun: opts.dryRun, orphans: opts.orphans });
    console.log(formatCleanResult(result));
  });

program
  .command('status [platform]')
  .description('Check platform connection status')
  .action(async (platformStr?: string) => {
    if (platformStr) {
      const platform = validatePlatform(platformStr);
      const status = await runStatus(platform);
      console.log(formatStatus(platform, status));
    } else {
      for (const platform of PLATFORMS) {
        try {
          const status = await runStatus(platform);
          console.log(formatStatus(platform, status));
        } catch {
          console.log(formatStatus(platform, { connected: false, environment: 'error' }));
        }
      }
    }
  });

program
  .command('validate <platform>')
  .description('Validate platform environment safety')
  .action(async (platformStr: string) => {
    const platform = validatePlatform(platformStr);
    const check = await runValidate(platform);
    console.log(formatEnvironmentCheck(check));
    process.exitCode = check.isSandbox ? 0 : 1;
  });

program
  .command('interactive')
  .description('Launch interactive menu')
  .action(async () => {
    await interactiveMenu();
  });

// Default to interactive menu if no command given
if (process.argv.length <= 2) {
  interactiveMenu().catch(console.error);
} else {
  program.parseAsync().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
