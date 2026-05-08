import { Router } from 'express';
import { getContactsCacheStatus } from '@utils/dataset-cache';

const router = Router();

// GET /api/cache/contacts — always 200, exists:false when no cache file is present
router.get('/cache/contacts', async (_req, res, next) => {
  try {
    const status = await getContactsCacheStatus();
    if (!status) {
      res.json({ data: { exists: false } });
      return;
    }
    res.json({
      data: {
        exists: true,
        generatedAt: status.generatedAt,
        sourcePlatform: status.sourcePlatform,
        count: status.count,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
