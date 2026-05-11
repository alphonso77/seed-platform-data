import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { AppError } from '@/middleware/error-handler';
import {
  runGenerate,
  runGetRun,
  runListRuns,
  runReport,
  runUpload,
  SimulationNotFoundError,
  SimulationStateError,
} from '@commands/simulate';
import { ArtifactName, runDir, writeOiResult } from '@/simulation/run-store';
import { OiCsvParseError } from '@/simulation/csv-parser';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const generateBody = z.object({
  size: z.enum(['small', 'medium', 'large']),
  fragment: z.boolean().default(false),
  duplicate: z.boolean().default(false),
  fuzzy: z.boolean().default(false),
  platforms: z.array(z.enum(['stripe', 'hubspot', 'shopify'])).min(1).optional(),
});

// runIds are filesystem-safe ISO timestamps (e.g. 2026-05-08T12-34-56-789Z).
// Reject anything with separators or path bits.
const runIdSchema = z.string().regex(/^[A-Za-z0-9T:.-]+$/);

const ALLOWED_ARTIFACTS: ArtifactName[] = [
  'meta.json',
  'answer-key.json',
  'stripe-dirty.json',
  'hubspot-dirty.json',
  'shopify-dirty.json',
  'upload-result.json',
  'oi-result.csv',
  'report.json',
  'report.csv',
];

function parseRunId(raw: string): string {
  const result = runIdSchema.safeParse(raw);
  if (!result.success) throw new AppError(`Invalid runId: ${raw}`, 400);
  return result.data;
}

function rewrapNotFound(err: unknown): never {
  if (err instanceof SimulationNotFoundError) {
    throw new AppError(err.message, 404, 'SIMULATION_NOT_FOUND');
  }
  if (err instanceof SimulationStateError) {
    throw new AppError(err.message, 409, 'SIMULATION_STATE');
  }
  if (err instanceof OiCsvParseError) {
    throw new AppError(err.message, 400, 'OI_CSV_PARSE_ERROR');
  }
  throw err;
}

// POST /api/simulation/runs — generate
router.post('/simulation/runs', async (req, res, next) => {
  try {
    const options = generateBody.parse(req.body);
    const summary = await runGenerate(options);
    res.json({ data: summary });
  } catch (err) {
    next(err);
  }
});

// GET /api/simulation/runs — list past runs
router.get('/simulation/runs', async (_req, res, next) => {
  try {
    const data = await runListRuns();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/simulation/runs/:runId — fetch a single run state
router.get('/simulation/runs/:runId', async (req, res, next) => {
  try {
    const runId = parseRunId(req.params.runId);
    const data = await runGetRun(runId).catch(rewrapNotFound);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// POST /api/simulation/runs/:runId/upload — push dirty data to all 3 platforms
router.post('/simulation/runs/:runId/upload', async (req, res, next) => {
  try {
    const runId = parseRunId(req.params.runId);
    const data = await runUpload(runId).catch(rewrapNotFound);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// POST /api/simulation/runs/:runId/oi-result — multipart CSV upload
router.post(
  '/simulation/runs/:runId/oi-result',
  upload.single('file'),
  async (req, res, next) => {
    try {
      const runId = parseRunId(String(req.params.runId));
      if (!req.file) throw new AppError('No file uploaded (expected field "file")', 400);
      await writeOiResult(runId, req.file.buffer);
      res.json({ data: { runId, fileName: req.file.originalname, size: req.file.size } });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/simulation/runs/:runId/report — compute pass/fail report
router.post('/simulation/runs/:runId/report', async (req, res, next) => {
  try {
    const runId = parseRunId(req.params.runId);
    const data = await runReport(runId).catch(rewrapNotFound);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/simulation/runs/:runId/artifacts/:artifact — download an artifact
router.get('/simulation/runs/:runId/artifacts/:artifact', async (req, res, next) => {
  try {
    const runId = parseRunId(req.params.runId);
    const artifact = req.params.artifact as ArtifactName;
    if (!ALLOWED_ARTIFACTS.includes(artifact)) {
      throw new AppError(`Unknown artifact: ${artifact}`, 400);
    }
    const filePath = path.join(runDir(runId), artifact);
    res.sendFile(filePath, (err) => {
      if (err) next(new AppError(`Artifact not found: ${artifact}`, 404, 'ARTIFACT_NOT_FOUND'));
    });
  } catch (err) {
    next(err);
  }
});

export default router;
