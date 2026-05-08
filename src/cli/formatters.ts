import chalk from 'chalk';
import Table from 'cli-table3';
import { SeedResult, CleanResult, EnvironmentCheck } from '@/types';
import { PLATFORM_LABELS } from '@config/platforms';

export function formatSeedResult(result: SeedResult): string {
  const table = new Table({
    head: [chalk.cyan('Entity'), chalk.cyan('Count')],
    style: { head: [] },
  });

  for (const [entity, count] of Object.entries(result.created)) {
    table.push([entity, count.toString()]);
  }

  const lines = [
    '',
    chalk.green.bold(`Seed complete for ${PLATFORM_LABELS[result.platform]}`),
    `Size: ${result.size} | Duration: ${(result.duration / 1000).toFixed(1)}s`,
    '',
    table.toString(),
  ];

  if (result.errors.length > 0) {
    lines.push('');
    lines.push(chalk.yellow(`${result.errors.length} error(s):`));
    result.errors.slice(0, 5).forEach((e) => lines.push(chalk.yellow(`  - ${e}`)));
    if (result.errors.length > 5) {
      lines.push(chalk.yellow(`  ... and ${result.errors.length - 5} more`));
    }
  }

  return lines.join('\n');
}

export function formatCleanResult(result: CleanResult): string {
  const table = new Table({
    head: [chalk.cyan('Entity'), chalk.cyan('Deleted')],
    style: { head: [] },
  });

  for (const [entity, count] of Object.entries(result.deleted)) {
    table.push([entity, count.toString()]);
  }

  const lines = [
    '',
    chalk.green.bold(`Clean complete for ${PLATFORM_LABELS[result.platform]}`),
    `Duration: ${(result.duration / 1000).toFixed(1)}s`,
    '',
    table.toString(),
  ];

  if (result.errors.length > 0) {
    lines.push('');
    lines.push(chalk.yellow(`${result.errors.length} error(s):`));
    result.errors.slice(0, 5).forEach((e) => lines.push(chalk.yellow(`  - ${e}`)));
  }

  return lines.join('\n');
}

export function formatEnvironmentCheck(check: EnvironmentCheck): string {
  const status = check.isSandbox
    ? chalk.green.bold('SAFE')
    : chalk.red.bold('BLOCKED');

  return [
    '',
    `${PLATFORM_LABELS[check.platform]} Environment: ${status}`,
    `Reason: ${check.reason}`,
    check.details ? `Details: ${JSON.stringify(check.details, null, 2)}` : '',
  ].filter(Boolean).join('\n');
}

export function formatStatus(platform: string, status: { connected: boolean; environment: string }): string {
  const indicator = status.connected
    ? chalk.green('connected')
    : chalk.red('disconnected');

  return `${platform}: ${indicator} (${status.environment})`;
}
