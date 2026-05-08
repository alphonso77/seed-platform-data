import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import { getEnv } from '@config/env';
import { errorHandler } from '@/middleware/error-handler';
import logger from '@utils/logger';
import healthRoutes from '@routes/health';
import platformRoutes from '@routes/platforms';
import seedRoutes from '@routes/seed';
import cacheRoutes from '@routes/cache';

const app = express();

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(morgan('dev', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// API routes
app.use('/api', healthRoutes);
app.use('/api', platformRoutes);
app.use('/api', seedRoutes);
app.use('/api', cacheRoutes);

// Serve frontend static files in production
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.get('*', (_req, res, next) => {
  // Only serve index.html for non-API routes
  if (_req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// Error handler (must be last)
app.use(errorHandler);

const env = getEnv();
app.listen(env.PORT, () => {
  logger.info(`Seed Platform Data server running on http://localhost:${env.PORT}`);
});

export default app;
