import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/response';
import { logger } from '../config/logger';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` },
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE', message: `A record with this ${(err.meta?.target as string[])?.join(', ') ?? 'value'} already exists.` },
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Record not found.' } });
    }
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  // The DB immutability trigger raises a check_violation — surface it clearly.
  if (typeof message === 'string' && message.includes('Immutable record')) {
    logger.error('Attempt to mutate an immutable record was blocked by the DB trigger.', { message });
    return res.status(403).json({
      success: false,
      error: { code: 'IMMUTABLE', message: 'This record is immutable and cannot be modified or deleted (21 CFR Part 11).' },
    });
  }

  logger.error('Unhandled error', { message, stack: err instanceof Error ? err.stack : undefined });
  return res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
}
