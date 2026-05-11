import { Platform } from '@/types';
import { assertSandbox } from '@utils/safety';
import logger from '@utils/logger';
import { generateAnswerKey } from '@/simulation/answer-key';
import { generateDirtyDatasets } from '@/simulation/dirty';
import {
  createRun,
  listRuns,
  loadAnswerKey,
  loadDirty,
  loadReport,
  loadRun,
  loadUploadResult,
  newRunId,
  readOiResult,
  writeReport,
  writeUploadResult,
} from '@/simulation/run-store';
import { parseOiResultCsv } from '@/simulation/csv-parser';
import { generateReport, reportToCsv } from '@/simulation/report';
import {
  Report,
  SimulationRunOptions,
  SimulationRunSummary,
  UploadMappingEntry,
  UploadResult,
} from '@/simulation/types';
import { createUploader } from '@/simulation/uploaders/index';

const ALL_PLATFORMS: Platform[] = ['stripe', 'hubspot', 'shopify'];

export async function runGenerate(
  options: SimulationRunOptions,
): Promise<SimulationRunSummary> {
  logger.info('[Simulation] Generating run', options);
  const runId = newRunId();
  const answerKey = generateAnswerKey(options.size);
  const dirty = generateDirtyDatasets(answerKey, {
    fragment: options.fragment,
    duplicate: options.duplicate,
    fuzzy: options.fuzzy,
    platforms: options.platforms,
  });
  const summary = await createRun({ runId, options, answerKey, dirty });
  logger.info('[Simulation] Run generated', { runId, counts: summary.counts });
  return summary;
}

export async function runUpload(runId: string): Promise<UploadResult> {
  const meta = await loadRun(runId);
  if (!meta) throw new SimulationNotFoundError(runId);

  const dirty = await loadDirty(runId);
  if (!dirty) throw new SimulationNotFoundError(runId);

  const selectedPlatforms = meta.options.platforms?.length ? meta.options.platforms : ALL_PLATFORMS;
  const skipped = ALL_PLATFORMS.filter((p) => !selectedPlatforms.includes(p));
  if (skipped.length > 0) {
    logger.info('[Simulation] Skipping platforms (not selected)', { runId, skipped });
  }

  logger.info('[Simulation] Validating sandboxes for upload', { runId, platforms: selectedPlatforms });
  const uploaders = selectedPlatforms.map((platform) => ({ platform, uploader: createUploader(platform) }));
  for (const { uploader } of uploaders) {
    const check = await uploader.validateEnvironment();
    assertSandbox(check);
  }

  const allMappings: UploadMappingEntry[] = [];
  const allErrors: string[] = [];

  for (const { platform, uploader } of uploaders) {
    logger.info('[Simulation] Uploading to platform', { platform, runId });
    const records = dirty[platform];
    const { mappings, errors } = await uploader.upload(records, runId);
    allMappings.push(...mappings);
    allErrors.push(...errors);
  }

  const result: UploadResult = {
    runId,
    uploadedAt: new Date().toISOString(),
    mappings: allMappings,
    errors: allErrors,
  };
  await writeUploadResult(runId, result);
  logger.info('[Simulation] Upload complete', {
    runId,
    mappings: allMappings.length,
    errors: allErrors.length,
  });
  return result;
}

export async function runReport(runId: string): Promise<Report> {
  const meta = await loadRun(runId);
  if (!meta) throw new SimulationNotFoundError(runId);

  const [answerKey, uploadResult, oiCsv] = await Promise.all([
    loadAnswerKey(runId),
    loadUploadResult(runId),
    readOiResult(runId),
  ]);
  if (!answerKey) throw new SimulationStateError(runId, 'answer key missing');
  if (!uploadResult) throw new SimulationStateError(runId, 'upload-result missing — upload step has not run');
  if (!oiCsv) throw new SimulationStateError(runId, 'OI result CSV not uploaded yet');

  const oiRows = parseOiResultCsv(oiCsv);
  const report = generateReport({
    runId,
    answerKey,
    uploadMapping: uploadResult.mappings,
    oiRows,
  });

  await writeReport(runId, report, reportToCsv(report));
  logger.info('[Simulation] Report generated', { runId, summary: report.summary });
  return report;
}

export async function runListRuns(): Promise<SimulationRunSummary[]> {
  return listRuns();
}

export async function runGetRun(runId: string): Promise<{
  summary: SimulationRunSummary;
  upload: UploadResult | null;
  report: Report | null;
}> {
  const summary = await loadRun(runId);
  if (!summary) throw new SimulationNotFoundError(runId);
  const [upload, report] = await Promise.all([loadUploadResult(runId), loadReport(runId)]);
  return { summary, upload, report };
}

export class SimulationNotFoundError extends Error {
  constructor(public runId: string) {
    super(`Simulation run ${runId} not found`);
    this.name = 'SimulationNotFoundError';
  }
}

export class SimulationStateError extends Error {
  constructor(public runId: string, public reason: string) {
    super(`Simulation run ${runId}: ${reason}`);
    this.name = 'SimulationStateError';
  }
}
