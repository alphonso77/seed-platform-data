import { Router } from 'express';
import { z } from 'zod';
import { Platform } from '@/types';
import { PLATFORMS } from '@config/platforms';
import { runSeed } from '@commands/seed';
import { runClean } from '@commands/clean';
import { AppError } from '@/middleware/error-handler';

const router = Router();

const platformParam = z.enum(['stripe', 'hubspot', 'shopify']);

const seedBody = z.object({
  size: z.enum(['small', 'medium', 'large']),
  emailDomains: z.array(z.string()).default([]),
  useRandomDomains: z.boolean().default(false),
  dryRun: z.boolean().optional(),
  reuse: z.boolean().optional(),
});

const cleanBody = z.object({
  dryRun: z.boolean().optional(),
  orphans: z.boolean().optional(),
});

function parsePlatform(raw: string): Platform {
  const result = platformParam.safeParse(raw);
  if (!result.success) {
    throw new AppError(`Invalid platform: ${raw}. Must be one of: ${PLATFORMS.join(', ')}`, 400);
  }
  return result.data;
}

// POST /api/platforms/:platform/seed
router.post('/platforms/:platform/seed', async (req, res, next) => {
  try {
    const platform = parsePlatform(req.params.platform);
    const options = seedBody.parse(req.body);
    const result = await runSeed(platform, options);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/platforms/:platform/clean
router.post('/platforms/:platform/clean', async (req, res, next) => {
  try {
    const platform = parsePlatform(req.params.platform);
    const options = cleanBody.parse(req.body);
    const result = await runClean(platform, { platform, ...options });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
