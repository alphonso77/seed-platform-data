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
  loadOiEnrichment,
  loadReport,
  loadRun,
  loadUploadResult,
  newRunId,
  readOiResult,
  writeOiEnrichment,
  writeReport,
  writeUploadResult,
} from '@/simulation/run-store';
import { parseOiResultCsv } from '@/simulation/csv-parser';
import { fetchOiDatabaseSnapshot } from '@/simulation/oi-db';
import { parseResolutionLog, pickResolutions } from '@/simulation/resolution-log';
import { generateReport, reportToCsv } from '@/simulation/report';
import {
  OiEnrichment,
  RecordResolution,
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
  const enrichment = await loadOiEnrichment(runId);
  const report = generateReport({
    runId,
    answerKey,
    uploadMapping: uploadResult.mappings,
    oiRows,
    reviewQueue: enrichment?.reviewQueue ?? undefined,
    resolutions: enrichment?.resolutions ?? undefined,
  });

  await writeReport(runId, report, reportToCsv(report));
  logger.info('[Simulation] Report generated', { runId, summary: report.summary });
  return report;
}

export interface EnrichOptions {
  /** Dev OI Postgres URL, injected per invocation (never read from `.env`). */
  databaseUrl?: string;
  /** Saved `railway logs ... --filter oi.resolution.resolved` output. */
  resolutionLog?: string;
}

/**
 * Fetch OI-side data the CSV doesn't carry (review-queue rows, per-record
 * resolution outcomes), persist it as `oi-enrichment.json`, and regenerate
 * the report. Resolutions come from the DB columns when present, with the
 * worker-log import filling any record the DB has no outcome for.
 */
export async function runEnrich(runId: string, options: EnrichOptions): Promise<Report> {
  const meta = await loadRun(runId);
  if (!meta) throw new SimulationNotFoundError(runId);
  const oiCsv = await readOiResult(runId);
  if (!oiCsv) throw new SimulationStateError(runId, 'OI result CSV not uploaded yet');
  if (!options.databaseUrl && !options.resolutionLog) {
    throw new SimulationStateError(runId, 'nothing to enrich from: pass a database URL and/or a resolution log');
  }

  const oiRows = parseOiResultCsv(oiCsv);
  const orgIds = Array.from(new Set(oiRows.map((r) => r.orgId)));
  if (orgIds.length !== 1) {
    throw new SimulationStateError(runId, `OI CSV must cover exactly one org (found ${orgIds.length})`);
  }

  let reviewQueue: OiEnrichment['reviewQueue'] = null;
  let resolutions: Record<string, RecordResolution> | null = null;
  if (options.databaseUrl) {
    const snapshot = await fetchOiDatabaseSnapshot(options.databaseUrl, {
      orgId: orgIds[0],
      rawRecordIds: oiRows.map((r) => r.rawRecordId),
      dnaRecordIds: Array.from(new Set(oiRows.map((r) => r.dnaRecordId).filter((d): d is string => d != null))),
    });
    reviewQueue = snapshot.reviewQueue;
    resolutions = snapshot.resolutions;
  }
  if (options.resolutionLog) {
    const fromLog = pickResolutions(
      parseResolutionLog(options.resolutionLog),
      new Set(oiRows.map((r) => r.rawRecordId)),
    );
    resolutions = { ...fromLog, ...(resolutions ?? {}) };
  }

  await writeOiEnrichment(runId, { fetchedAt: new Date().toISOString(), reviewQueue, resolutions });
  logger.info('[Simulation] OI enrichment saved', {
    runId,
    reviewQueueRows: reviewQueue?.length ?? null,
    resolutions: resolutions ? Object.keys(resolutions).length : null,
  });
  return runReport(runId);
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
