import { Router } from 'express';
import { z } from 'zod';
import { Platform } from '@/types';
import { PLATFORMS, PLATFORM_LABELS } from '@config/platforms';
import { runStatus } from '@commands/status';
import { runValidate } from '@commands/validate';
import { AppError } from '@/middleware/error-handler';

const router = Router();

const platformParam = z.enum(['stripe', 'hubspot', 'shopify']);

function parsePlatform(raw: string): Platform {
  const result = platformParam.safeParse(raw);
  if (!result.success) {
    throw new AppError(`Invalid platform: ${raw}. Must be one of: ${PLATFORMS.join(', ')}`, 400);
  }
  return result.data;
}

// GET /api/platforms — list all platforms with connection status
router.get('/platforms', async (_req, res, next) => {
  try {
    const results = await Promise.allSettled(
      PLATFORMS.map(async (platform) => {
        try {
          const status = await runStatus(platform);
          return { platform, label: PLATFORM_LABELS[platform], ...status };
        } catch {
          return { platform, label: PLATFORM_LABELS[platform], connected: false, environment: 'unknown' };
        }
      })
    );

    const data = results.map((r) => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/platforms/:platform/status
router.get('/platforms/:platform/status', async (req, res, next) => {
  try {
    const platform = parsePlatform(req.params.platform);
    const status = await runStatus(platform);
    res.json({ data: status });
  } catch (err) {
    next(err);
  }
});

// POST /api/platforms/:platform/validate
router.post('/platforms/:platform/validate', async (req, res, next) => {
  try {
    const platform = parsePlatform(req.params.platform);
    const result = await runValidate(platform);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
