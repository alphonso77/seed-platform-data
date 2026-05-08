import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import logger from '@utils/logger';

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  logger.error('Request error', { error: err.message, stack: err.stack });

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation Error',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // Safety errors (environment check failures)
  if (err.message.startsWith('SAFETY:')) {
    res.status(403).json({
      error: err.message,
      code: 'SAFETY_CHECK_FAILED',
    });
    return;
  }

  res.status(500).json({
    error: 'Internal Server Error',
  });
}
