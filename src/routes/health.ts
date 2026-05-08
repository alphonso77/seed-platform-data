import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    data: {
      status: 'ok',
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

export default router;
