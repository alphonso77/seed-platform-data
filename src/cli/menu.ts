import inquirer from 'inquirer';
import { Platform, DatasetSize, SeedOptions } from '@/types';
import { PLATFORMS, PLATFORM_LABELS } from '@config/platforms';
import { DATASET_SIZES } from '@config/datasets';
import { runSeed } from '@commands/seed';
import { runClean } from '@commands/clean';
import { runStatus } from '@commands/status';
import { runValidate } from '@commands/validate';
import { getContactsCacheStatus } from '@utils/dataset-cache';
import {
  formatSeedResult,
  formatCleanResult,
  formatEnvironmentCheck,
  formatStatus,
} from '@cli/formatters';

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return iso;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

async function selectPlatform(): Promise<Platform> {
  const { platform } = await inquirer.prompt([
    {
      type: 'list',
      name: 'platform',
      message: 'Select a platform:',
      choices: PLATFORMS.map((p) => ({ name: PLATFORM_LABELS[p], value: p })),
    },
  ]);
  return platform;
}

async function selectAction(): Promise<string> {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Seed data', value: 'seed' },
        { name: 'Clean seeded data', value: 'clean' },
        { name: 'Check connection status', value: 'status' },
        { name: 'Validate environment safety', value: 'validate' },
        { name: 'Exit', value: 'exit' },
      ],
    },
  ]);
  return action;
}

async function configureSeed(): Promise<{ size: DatasetSize; emailDomains: string[]; useRandomDomains: boolean; dryRun: boolean; reuse: boolean }> {
  const cacheStatus = await getContactsCacheStatus();
  let reuse = false;
  if (cacheStatus) {
    const ans = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'reuse',
        message: `Reuse ${cacheStatus.count} contacts from previous seed (${cacheStatus.sourcePlatform}, ${relativeTime(cacheStatus.generatedAt)})?`,
        default: false,
      },
    ]);
    reuse = ans.reuse;
  }

  const { size } = await inquirer.prompt([
    {
      type: 'list',
      name: 'size',
      message: 'Dataset size:',
      choices: Object.entries(DATASET_SIZES).map(([key, val]) => ({
        name: `${key} (${val.contacts} contacts, ${val.products} products, ${val.orders} orders)`,
        value: key,
      })),
    },
  ]);

  const { domainMode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'domainMode',
      message: 'Email domain strategy:',
      choices: [
        { name: 'Random domains (*.example.com)', value: 'random' },
        { name: 'Custom domains', value: 'custom' },
        { name: 'Use defaults from env', value: 'default' },
      ],
    },
  ]);

  let emailDomains: string[] = [];
  let useRandomDomains = false;

  if (domainMode === 'random') {
    useRandomDomains = true;
  } else if (domainMode === 'custom') {
    const { domains } = await inquirer.prompt([
      {
        type: 'input',
        name: 'domains',
        message: 'Enter comma-separated domains:',
        validate: (input: string) => input.trim().length > 0 || 'Please enter at least one domain',
      },
    ]);
    emailDomains = domains.split(',').map((d: string) => d.trim());
  }

  const { dryRun } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'dryRun',
      message: 'Dry run (preview only)?',
      default: false,
    },
  ]);

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Proceed with ${size} seed${dryRun ? ' (dry run)' : ''}?`,
      default: true,
    },
  ]);

  if (!confirm) {
    throw new Error('Cancelled by user');
  }

  return { size, emailDomains, useRandomDomains, dryRun, reuse };
}

export async function interactiveMenu(): Promise<void> {
  console.log('\n🌱 Seed Platform Data — Interactive Menu\n');

  while (true) {
    const action = await selectAction();

    if (action === 'exit') {
      console.log('Goodbye!');
      break;
    }

    const platform = await selectPlatform();

    try {
      switch (action) {
        case 'seed': {
          const seedConfig = await configureSeed();
          const seedOptions: SeedOptions = {
            size: seedConfig.size,
            emailDomains: seedConfig.emailDomains,
            useRandomDomains: seedConfig.useRandomDomains,
            dryRun: seedConfig.dryRun,
            reuse: seedConfig.reuse,
          };
          const result = await runSeed(platform, seedOptions);
          console.log(formatSeedResult(result));
          break;
        }
        case 'clean': {
          const { dryRun } = await inquirer.prompt([
            { type: 'confirm', name: 'dryRun', message: 'Dry run?', default: false },
          ]);
          let orphans = false;
          if (platform === 'hubspot') {
            const ans = await inquirer.prompt([
              { type: 'confirm', name: 'orphans', message: 'Recover orphaned deals by name (HubSpot only)?', default: false },
            ]);
            orphans = ans.orphans;
          }
          const { confirm } = await inquirer.prompt([
            { type: 'confirm', name: 'confirm', message: `Clean all seeded data from ${PLATFORM_LABELS[platform]}?`, default: false },
          ]);
          if (!confirm) break;
          const cleanResult = await runClean(platform, { platform, dryRun, orphans });
          console.log(formatCleanResult(cleanResult));
          break;
        }
        case 'status': {
          const status = await runStatus(platform);
          console.log(formatStatus(PLATFORM_LABELS[platform], status));
          break;
        }
        case 'validate': {
          const envCheck = await runValidate(platform);
          console.log(formatEnvironmentCheck(envCheck));
          break;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Cancelled by user') {
        console.log('Cancelled.\n');
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log('');
  }
}
