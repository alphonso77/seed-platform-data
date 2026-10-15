import fs from 'fs/promises';
import path from 'path';
import logger from '@utils/logger';
import {
  CanonicalPerson,
  DirtyDatasets,
  OiEnrichment,
  Report,
  SimulationRunOptions,
  SimulationRunSummary,
  RunStage,
  UploadResult,
} from '@/simulation/types';

export type ArtifactName =
  | 'meta.json'
  | 'answer-key.json'
  | 'stripe-dirty.json'
  | 'hubspot-dirty.json'
  | 'shopify-dirty.json'
  | 'upload-result.json'
  | 'oi-result.csv'
  | 'oi-enrichment.json'
  | 'report.json'
  | 'report.csv';

interface RunMeta {
  runId: string;
  createdAt: string;
  options: SimulationRunOptions;
  stage: RunStage;
  counts: SimulationRunSummary['counts'];
}

function rootDir(): string {
  return process.env.SIMULATION_DIR ?? path.resolve(process.cwd(), 'simulation-runs');
}

export function runDir(runId: string): string {
  return path.join(rootDir(), runId);
}

export function newRunId(now: Date = new Date()): string {
  // Filesystem-safe ISO: replace : and . with -
  return now.toISOString().replace(/[:.]/g, '-');
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

export interface CreateRunInput {
  runId: string;
  options: SimulationRunOptions;
  answerKey: CanonicalPerson[];
  dirty: DirtyDatasets;
}

export async function createRun(input: CreateRunInput): Promise<SimulationRunSummary> {
  const dir = runDir(input.runId);
  await fs.mkdir(dir, { recursive: true });

  const meta: RunMeta = {
    runId: input.runId,
    createdAt: new Date().toISOString(),
    options: input.options,
    stage: 'generated',
    counts: {
      answerKey: input.answerKey.length,
      stripe: input.dirty.stripe.length,
      hubspot: input.dirty.hubspot.length,
      shopify: input.dirty.shopify.length,
    },
  };

  await writeJson(path.join(dir, 'meta.json'), meta);
  await writeJson(path.join(dir, 'answer-key.json'), input.answerKey);
  await writeJson(path.join(dir, 'stripe-dirty.json'), input.dirty.stripe);
  await writeJson(path.join(dir, 'hubspot-dirty.json'), input.dirty.hubspot);
  await writeJson(path.join(dir, 'shopify-dirty.json'), input.dirty.shopify);

  return meta;
}

export async function loadRun(runId: string): Promise<SimulationRunSummary | null> {
  return readJson<RunMeta>(path.join(runDir(runId), 'meta.json'));
}

export async function loadAnswerKey(runId: string): Promise<CanonicalPerson[] | null> {
  return readJson<CanonicalPerson[]>(path.join(runDir(runId), 'answer-key.json'));
}

export async function loadDirty(runId: string): Promise<DirtyDatasets | null> {
  const [stripe, hubspot, shopify] = await Promise.all([
    readJson<DirtyDatasets['stripe']>(path.join(runDir(runId), 'stripe-dirty.json')),
    readJson<DirtyDatasets['hubspot']>(path.join(runDir(runId), 'hubspot-dirty.json')),
    readJson<DirtyDatasets['shopify']>(path.join(runDir(runId), 'shopify-dirty.json')),
  ]);
  if (!stripe || !hubspot || !shopify) return null;
  return { stripe, hubspot, shopify };
}

export async function loadUploadResult(runId: string): Promise<UploadResult | null> {
  return readJson<UploadResult>(path.join(runDir(runId), 'upload-result.json'));
}

export async function loadReport(runId: string): Promise<Report | null> {
  return readJson<Report>(path.join(runDir(runId), 'report.json'));
}

export async function writeUploadResult(runId: string, result: UploadResult): Promise<void> {
  await writeJson(path.join(runDir(runId), 'upload-result.json'), result);
  await advanceStage(runId, 'uploaded');
}

export async function writeOiResult(runId: string, csv: Buffer | string): Promise<void> {
  const dir = runDir(runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'oi-result.csv'), csv);
  await advanceStage(runId, 'oi-uploaded');
}

export async function readOiResult(runId: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(runDir(runId), 'oi-result.csv'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function loadOiEnrichment(runId: string): Promise<OiEnrichment | null> {
  return readJson<OiEnrichment>(path.join(runDir(runId), 'oi-enrichment.json'));
}

export async function writeOiEnrichment(runId: string, enrichment: OiEnrichment): Promise<void> {
  await writeJson(path.join(runDir(runId), 'oi-enrichment.json'), enrichment);
}

export async function writeReport(runId: string, report: Report, csv: string): Promise<void> {
  const dir = runDir(runId);
  await writeJson(path.join(dir, 'report.json'), report);
  await fs.writeFile(path.join(dir, 'report.csv'), csv, 'utf8');
  await advanceStage(runId, 'reported');
}

async function advanceStage(runId: string, stage: RunStage): Promise<void> {
  const metaPath = path.join(runDir(runId), 'meta.json');
  const meta = await readJson<RunMeta>(metaPath);
  if (!meta) {
    logger.warn(`[simulation] advanceStage called for unknown run ${runId}`);
    return;
  }
  if (stageRank(stage) <= stageRank(meta.stage)) return;
  await writeJson(metaPath, { ...meta, stage });
}

function stageRank(stage: RunStage): number {
  switch (stage) {
    case 'generated':
      return 1;
    case 'uploaded':
      return 2;
    case 'oi-uploaded':
      return 3;
    case 'reported':
      return 4;
  }
}

export async function listRuns(): Promise<SimulationRunSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(rootDir());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const results: SimulationRunSummary[] = [];
  for (const entry of entries) {
    const meta = await readJson<RunMeta>(path.join(rootDir(), entry, 'meta.json'));
    if (meta) results.push(meta);
  }
  // Newest first — runIds are ISO timestamps so they sort lexicographically.
  results.sort((a, b) => b.runId.localeCompare(a.runId));
  return results;
}
