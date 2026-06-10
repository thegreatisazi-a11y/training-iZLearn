import { Request, Response } from 'express';
import { asyncHandler } from '../utils/response';
import { prisma } from '../config/prisma';
import { redis } from '../config/redis';
import { verifyAuditTrigger } from '../middlewares/auditTrail.middleware';

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [System]
 *     summary: System health (DB, Redis, and the audit immutability trigger)
 *     responses:
 *       200: { description: Healthy }
 *       503: { description: Degraded }
 */
export const health = asyncHandler(async (_req: Request, res: Response) => {
  let db = false;
  let redisOk = false;
  let auditTrigger = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  try {
    redisOk = (await redis.ping()) === 'PONG';
  } catch {
    redisOk = false;
  }
  try {
    auditTrigger = await verifyAuditTrigger(prisma);
  } catch {
    auditTrigger = false;
  }

  const ok = db && redisOk && auditTrigger;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    checks: { database: db, redis: redisOk, auditImmutabilityTrigger: auditTrigger },
    timestamp: new Date().toISOString(),
  });
});
