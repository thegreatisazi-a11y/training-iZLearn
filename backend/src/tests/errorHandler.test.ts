import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { AppError } from '../utils/response';
import { errorHandler, notFoundHandler } from '../middlewares/errorHandler.middleware';

function buildApp() {
  const app = express();
  app.get('/app-error', (_req, _res, next) => next(AppError.forbidden('no access')));
  app.get('/zod', (_req, _res, next) => {
    const parsed = z.object({ a: z.string() }).safeParse({});
    next(parsed.success ? undefined : parsed.error);
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('error handler mapping', () => {
  it('maps AppError to its status + code', async () => {
    const res = await request(buildApp()).get('/app-error');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('maps ZodError to 400 VALIDATION_ERROR', async () => {
    const res = await request(buildApp()).get('/zod');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(buildApp()).get('/nope');
    expect(res.status).toBe(404);
  });
});
